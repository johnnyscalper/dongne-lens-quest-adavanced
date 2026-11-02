"""Official XML contract tests using synthetic fixtures, never a live API key."""

import datetime as dt
import io
import time
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

import molit


REGION = {"code": "11680", "name": "서울특별시 강남구", "aliases": ["청담동"]}


def item_xml(kind="sale", **fields):
    values = {"dealYear": "2026", "dealMonth": "9", "dealDay": "15",
              "aptNm": "검산용 가상 아파트", "umdNm": "청담동", "floor": "3",
              "excluUseAr": "84.95"}
    values.update({"dealAmount": "50,000"} if kind == "sale"
                  else {"deposit": "10,000", "monthlyRent": "100"})
    values.update(fields)
    return "<item>" + "".join(f"<{key}>{value}</{key}>" for key, value in values.items()) + "</item>"


def response_xml(items, total=None, code="000"):
    total = len(items) if total is None else total
    return (f"<response><header><resultCode>{code}</resultCode><resultMsg>OK</resultMsg></header>"
            f"<body><items>{''.join(items)}</items><totalCount>{total}</totalCount></body></response>").encode()


class XmlNormalizationTests(unittest.TestCase):
    def test_sale_money_is_converted_from_manwon_to_krw(self):
        records, total, invalid = molit.parse_response(response_xml([item_xml()]), "sale", REGION, "202609")
        self.assertEqual((total, invalid), (1, 0))
        self.assertEqual(records[0]["price_krw"], 500_000_000)
        self.assertEqual(records[0]["area_m2"], 84.95)
        self.assertEqual(records[0]["contract_date"], "2026-09-15")
        self.assertFalse(records[0]["canceled"])

    def test_rent_classification_and_units_preserve_zero_monthly_rent(self):
        payload = response_xml([item_xml("rent"), item_xml("rent", deposit="30,000", monthlyRent="0")])
        rows, _, invalid = molit.parse_response(payload, "rent", REGION, "202609")
        self.assertEqual(invalid, 0)
        self.assertEqual(rows[0]["kind"], "monthly")
        self.assertEqual(rows[0]["deposit_krw"], 100_000_000)
        self.assertEqual(rows[0]["monthly_rent_krw"], 1_000_000)
        self.assertEqual(rows[1]["kind"], "jeonse")
        self.assertEqual(rows[1]["deposit_krw"], 300_000_000)
        self.assertEqual(rows[1]["monthly_rent_krw"], 0)

    def test_cancellation_flag_or_date_marks_transaction(self):
        payload = response_xml([item_xml(cdealType="Y"), item_xml(cdealDay="2026-09-20"), item_xml(cdealDay="-")])
        rows, _, _ = molit.parse_response(payload, "sale", REGION, "202609")
        self.assertEqual([row["canceled"] for row in rows], [True, True, False])

    def test_missing_or_bad_amount_and_unexpected_month_are_skipped(self):
        items = [item_xml(dealAmount=""), item_xml(dealAmount="NaN"), item_xml(dealAmount="-1"),
                 item_xml(dealAmount="0"), item_xml(dealMonth="8"), item_xml()]
        rows, total, invalid = molit.parse_response(response_xml(items), "sale", REGION, "202609")
        self.assertEqual((len(rows), total, invalid), (1, 6, 5))

    def test_identical_reported_transactions_are_not_deduplicated(self):
        rows, _, _ = molit.parse_response(response_xml([item_xml(), item_xml()]), "sale", REGION, "202609")
        self.assertEqual(len(rows), 2)
        self.assertNotEqual(rows[0]["id"], rows[1]["id"])

    def test_api_errors_and_unsafe_xml_are_not_empty_successes(self):
        payloads = [response_xml([], code="30"), b"<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>BAD KEY</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>",
                    b'<!DOCTYPE response [<!ENTITY x "x">]><response/>', b"not XML", b"<response/>"]
        for payload in payloads:
            with self.subTest(payload=payload[:80]):
                with self.assertRaises(molit.MolitError):
                    molit.parse_response(payload, "sale", REGION, "202609")


class BoundedFetchTests(unittest.TestCase):
    def test_pagination_collects_all_pages_and_encodes_key_once(self):
        payloads = [response_xml([item_xml(), item_xml()], total=3), response_xml([item_xml()], total=3)]
        calls = []

        def fake_open(request, timeout):
            calls.append(parse_qs(urlsplit(request.full_url).query))
            self.assertGreater(timeout, 0)
            return io.BytesIO(payloads[len(calls) - 1])

        with patch.object(molit, "PAGE_SIZE", 2), patch.object(molit.urllib.request, "urlopen", side_effect=fake_open):
            result = molit._fetch_month(REGION, "202609", "sale", "fixture%2Fkey%2B", time.monotonic() + 10)
        self.assertEqual(len(result["records"]), 3)
        self.assertFalse(result["truncated"])
        self.assertEqual([call["pageNo"] for call in calls], [["1"], ["2"]])
        self.assertEqual(calls[0]["serviceKey"], ["fixture/key+"])

    def test_max_pages_is_reported_as_truncation(self):
        payload = response_xml([item_xml()], total=100)
        with patch.object(molit, "PAGE_SIZE", 1), patch.object(molit, "MAX_PAGES", 2), \
             patch.object(molit.urllib.request, "urlopen", side_effect=lambda *args, **kwargs: io.BytesIO(payload)) as opener:
            result = molit._fetch_month(REGION, "202609", "sale", "synthetic-key", time.monotonic() + 10)
        self.assertEqual(opener.call_count, 2)
        self.assertTrue(result["truncated"])

    def test_partial_live_query_is_explicitly_incomplete(self):
        def fake_month(region, month, kind, key, deadline):
            if month == "202609" and kind == "rent":
                raise molit.MolitError("synthetic upstream outage")
            return {"records": [], "invalid": 0, "truncated": False}

        with patch.object(molit, "_fetch_month", side_effect=fake_month):
            result = molit.fetch_market(REGION, 3, today=dt.date(2026, 9, 20), service_key="synthetic-key")
        self.assertEqual(result["mode"], "live")
        self.assertTrue(result["coverage"]["partial"])
        self.assertEqual(result["coverage"]["successful_queries"], 5)
        self.assertEqual(result["coverage"]["successful_months"], 2)
        self.assertTrue(result["warnings"])

    def test_total_failure_never_returns_demo_records(self):
        with patch.object(molit, "_fetch_month", side_effect=molit.MolitError("synthetic failure")):
            with self.assertRaises(molit.MolitError):
                molit.fetch_market(REGION, 3, today=dt.date(2026, 9, 20), service_key="synthetic-key")

    def test_missing_key_is_reported_without_attempting_network(self):
        with patch.object(molit.urllib.request, "urlopen") as opener:
            with self.assertRaises(molit.MolitError) as caught:
                molit.fetch_market(REGION, 3, service_key="")
        self.assertEqual(caught.exception.code, "KEY_REQUIRED")
        opener.assert_not_called()

    def test_month_window_crosses_calendar_year_correctly(self):
        self.assertEqual(molit.month_window(3, dt.date(2026, 1, 2)), ["202511", "202512", "202601"])
        self.assertEqual(molit.period_for(3, dt.date(2026, 1, 2)), {"start": "2025-11-01", "end": "2026-01-02"})


if __name__ == "__main__":
    unittest.main()
