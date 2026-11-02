"""Keep the installation-free experience equivalent to the Python calculations.

Node is a development/CI dependency only. A Python-only app installation can
still run its server suite; these cross-runtime checks are then skipped.
"""
from __future__ import annotations

import copy
import json
import shutil
import subprocess
import unittest
from datetime import date
from pathlib import Path

from analytics import analyze
from demo import generate_demo_records
from insights import build_insights, demo_mix

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
REGIONS = json.loads((ROOT / "data/regions.json").read_text())
PERIOD = {"start": "2026-01-01", "end": "2026-06-30"}


def row(price=500_000_000, when="2026-02-15", **changes):
    result = {
        "id": f"fixture-{price}-{when}", "region_code": "11680",
        "district": "강남구", "neighborhood": "청담동", "apartment": "가상 작은집",
        "area_m2": 59.8, "floor": 5, "contract_date": when,
        "kind": "sale", "price_krw": price, "deposit_krw": None,
        "monthly_rent_krw": None, "canceled": False,
    }
    result.update(changes)
    return result


def composition_rows():
    result = []
    for month, counts in ((2, (8, 2)), (5, (2, 8))):
        for index, count in enumerate(counts):
            for day in range(1, count + 1):
                result.append(row(
                    (500_000_000, 1_000_000_000)[index], f"2026-{month:02d}-{day:02d}",
                    id=f"mix-{month}-{index}-{day}",
                    apartment=("가상 작은집", "가상 넓은집")[index],
                    area_m2=(59.8, 84.9)[index],
                ))
    return result


@unittest.skipUnless(NODE, "Node is needed only for browser-engine development checks")
class LocalEngineParityTests(unittest.TestCase):
    maxDiff = 2500

    def run_local(self, cases, now="2026-11-02T03:00:00Z"):
        completed = subprocess.run(
            [NODE, str(ROOT / "tests/local_engine_runner.cjs")],
            input=json.dumps({"cases": cases, "now": now}, ensure_ascii=False, allow_nan=False),
            capture_output=True, text=True, timeout=30, cwd=ROOT,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        values = json.loads(completed.stdout)
        self.assertEqual(len(values), len(cases))
        return values

    def assert_parity(self, cases):
        for case, result in zip(cases, self.run_local(cases)):
            with self.subTest(action=case["action"], options=case.get("options"), size=len(case.get("records", []))):
                self.assertTrue(result["ok"], result)
                if case["action"] == "analyze":
                    expected = analyze(case["records"], **case.get("options", {}))
                elif case["action"] == "insights":
                    expected = build_insights(case["records"], **case.get("options", {}))
                else:
                    expected = demo_mix()
                self.assertEqual(result["value"], expected)

    @staticmethod
    def api_case(url, payload=None, **extra):
        options = {} if payload is None else {
            "method": "POST", "headers": {"Content-Type": "application/json"},
            "body": json.dumps(payload, ensure_ascii=False, allow_nan=False),
        }
        return {"action": "api", "url": url, "options": options, **extra}

    def test_full_analysis_payloads_across_area_bands_and_calendar_windows(self):
        cases = []
        for region in (REGIONS[0], REGIONS[3], REGIONS[-3]):
            for months in (3, 12):
                records = generate_demo_records(region, months, date(2026, 1, 1))
                for band in ("all", "small", "medium", "large"):
                    cases.append({"action": "analyze", "records": records, "options": {"area_band": band}})
        self.assert_parity(cases)

    def test_analysis_missing_cancelled_and_even_median_rounding(self):
        base = [row(500_000_000 + offset, area_m2=area, id=str(offset))
                for offset, area in enumerate((60, 60.01, 85, 85.01, 84.9, 59.8))]
        base += [row(kind="monthly", price=None, deposit_krw=0, monthly_rent_krw=1_000_001),
                 row(kind="jeonse", price=None, deposit_krw=300_000_001, monthly_rent_krw=0),
                 row(9_000_000_000, canceled=True), row(None)]
        snapshots = copy.deepcopy(base)
        self.assert_parity([{"action": "analyze", "records": records, "options": options}
                            for records, options in ((base, {}), (base[:4], {}), ([], {}),
                                                     (base, {"neighborhood": "없는동"}))])
        self.assertEqual(base, snapshots)

    def test_finance_zero_interest_all_equity_and_high_rate_scenarios(self):
        records = [row(500_000_000 + i * 25_000_000) for i in range(5)]
        records += [row(kind="monthly", price=None, deposit_krw=100_000_000, monthly_rent_krw=1_000_000)]
        assumptions = [
            {"equity_krw": 0, "loan_rate_pct": 0, "loan_years": 1},
            {"equity_krw": 1_000_000_000, "vacancy_pct": 100},
            {"budget_krw": 500_000_000, "equity_krw": 250_000_000, "loan_rate_pct": 30, "loan_years": 50},
            {"equity_krw": 333_333_333, "loan_rate_pct": 4.15, "annual_cost_krw": 2_400_001},
        ]
        self.assert_parity([{"action": "analyze", "records": records, "options": {"assumptions": item}}
                            for item in assumptions])

    def test_composition_example_and_fixed_baseline_weighting(self):
        records = composition_rows()
        uneven = [row(500_000_000, apartment="A") for _ in range(6)]
        uneven += [row(1_000_000_000, apartment="B") for _ in range(2)]
        uneven += [row(550_000_000, "2026-05-15", apartment="A") for _ in range(2)]
        uneven += [row(900_000_000, "2026-05-15", apartment="B") for _ in range(6)]
        self.assert_parity([{"action": "insights", "records": rows, "options": {"period": PERIOD}}
                            for rows in (records, uneven)] + [{"action": "example"}])
        # Independent hand-calculated anchors prevent two implementations from
        # agreeing on the wrong statistic.
        results = self.run_local([{"action": "insights", "records": rows, "options": {"period": PERIOD}}
                                  for rows in (records, uneven)])
        self.assertEqual(results[0]["value"]["mix"]["raw_change_pct"], 100)
        self.assertEqual(results[0]["value"]["mix"]["matched_change_pct"], 0)
        self.assertEqual(results[1]["value"]["mix"]["matched_change_pct"], 2)

    def test_insights_odd_months_leap_day_filters_and_exclusions(self):
        rows = composition_rows() + [row(None), row(9_000_000_000, canceled=True),
                                     row(9_000_000_000, "2027-01-01", apartment="outside")]
        cases = [{"action": "insights", "records": rows, "options": options} for options in (
            {"period": PERIOD}, {"period": PERIOD, "area_band": "small"},
            {"period": PERIOD, "neighborhood": "없는동"},
            {"period": {"start": "2026-01-12", "end": "2026-03-17"}},
        )]
        cases += [{"action": "insights", "records": [row(when=when) for when in dates], "options": {}}
                  for dates in (("2024-02-29", "2024-03-01"), ("2026-02-01",), ())]
        self.assert_parity(cases)

    def test_candidate_ids_and_order_match_for_unicode_and_quoted_names(self):
        rows = []
        for index, name in enumerate(("한글 아파트", "O'Brien", '집 "A"', "둘'\"다", "🍀 집", "공백\u00a0집")):
            for when in ("2026-02-01", "2026-02-02", "2026-05-01", "2026-05-02"):
                rows.append(row(400_000_000 + index * 70_000_000, when, apartment=name, area_m2=59.8 + index * 5))
        self.assert_parity([{"action": "insights", "records": rows, "options": {"period": PERIOD}}])

    def test_invalid_engine_inputs_are_rejected_by_both_runtimes(self):
        cases = [
            {"action": "analyze", "records": [row(area_m2=True)]},
            {"action": "analyze", "records": [row()], "options": {"assumptions": {"budget_krw": True}}},
            {"action": "analyze", "records": [row()], "options": {"area_band": "unknown"}},
            {"action": "insights", "records": [row(when="2026-02-30")]},
            {"action": "insights", "records": [row()], "options": {"period": {"start": "2026-03-01", "end": "2026-02-01"}}},
        ]
        for case, result in zip(cases, self.run_local(cases)):
            with self.subTest(case=case):
                with self.assertRaises(ValueError):
                    (analyze if case["action"] == "analyze" else build_insights)(case["records"], **case.get("options", {}))
                self.assertFalse(result["ok"], result)

    def test_local_config_and_regions_explicitly_describe_demo_only(self):
        values = self.run_local([self.api_case("/api/config"), self.api_case("/api/regions"), self.api_case("/api/regions?q=성수")])
        self.assertTrue(all(value["ok"] for value in values), values)
        config = values[0]["value"]
        self.assertFalse(config["live_available"])
        self.assertTrue(config["local_only"])
        self.assertIn("가상", config["source_label"])
        self.assertEqual(values[1]["value"]["regions"], REGIONS)
        self.assertEqual([region["code"] for region in values[2]["value"]["regions"]], ["11200"])

    def test_every_district_demo_stays_inside_kst_period_with_unique_fictional_records(self):
        cases = [self.api_case(f"/api/market?region={region['code']}&months=3&mode=demo") for region in REGIONS]
        # UTC Dec31 is already Jan1 in Korea, including the year rollover.
        for region, result in zip(REGIONS, self.run_local(cases, now="2025-12-31T15:01:00Z")):
            with self.subTest(region=region["code"]):
                self.assertTrue(result["ok"], result)
                market = result["value"]
                self.assertEqual(market["period"], {"start": "2025-11-01", "end": "2026-01-01"})
                self.assertEqual(market["mode"], "demo")
                self.assertFalse(market["coverage"]["partial"])
                records = market["records"]
                self.assertEqual(len(records), len(region["neighborhoods"]) * 3 * 3 * 3)
                self.assertEqual(len({record["id"] for record in records}), len(records))
                for record in records:
                    date.fromisoformat(record["contract_date"])
                    self.assertTrue("2025-11-01" <= record["contract_date"] <= "2026-01-01")
                    self.assertTrue(record["apartment"].startswith("가상 "))
                    self.assertEqual(record["region_code"], region["code"])

    def test_overlapping_demo_windows_are_stable_and_repeated_requests_deterministic(self):
        values = self.run_local([self.api_case(f"/api/market?region=11680&months={months}") for months in (3, 6, 12, 3)])
        self.assertTrue(all(value["ok"] for value in values), values)
        self.assertEqual(values[0], values[3])
        short = {row["id"]: row for row in values[0]["value"]["records"]}
        for value in values[1:3]:
            long = {row["id"]: row for row in value["value"]["records"]}
            self.assertEqual({key: long[key] for key in short}, short)

    def test_local_post_routes_integrate_real_engines_without_network(self):
        records = generate_demo_records(REGIONS[3], 6, date(2026, 6, 30))
        payload = {"records": records, "area_band": "medium", "neighborhood": "", "period": PERIOD,
                   "assumptions": {"budget_krw": 1_200_000_000, "equity_krw": 700_000_000}}
        values = self.run_local([self.api_case(url, payload) for url in ("/api/analyze", "/api/insights")])
        self.assertTrue(all(value["ok"] for value in values), values)
        self.assertEqual(values[0]["value"], analyze(records, area_band="medium", assumptions=payload["assumptions"]))
        self.assertEqual(values[1]["value"], build_insights(records, area_band="medium", period=PERIOD))

    def test_local_api_rejects_live_external_invalid_and_cancelled_requests(self):
        cases = [self.api_case("/api/market?mode=live"), self.api_case("https://example.com/api/config"),
                 self.api_case("/api/market?months=4"), self.api_case("/api/market?months=3&months=6"),
                 self.api_case("/api/analyze", {"records": [row()], "assumptions": {"budget_krw": 0}}),
                 {"action": "api", "url": "/api/analyze", "options": {"method": "POST", "headers": {"Content-Type": "application/json"}, "body": "{"}},
                 self.api_case("/api/config", abort="before"), self.api_case("/api/config", abort="during")]
        values = self.run_local(cases)
        self.assertTrue(all(not value["ok"] for value in values), values)
        self.assertEqual(values[0]["status"], 503)
        self.assertIn("Replit", values[0]["message"])
        self.assertEqual([value["name"] for value in values[-2:]], ["AbortError", "AbortError"])


if __name__ == "__main__":
    unittest.main()
