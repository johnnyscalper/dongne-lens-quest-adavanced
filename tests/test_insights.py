"""Behavioral checks for the price-composition and blind-choice experiments.

Fixtures are deliberately synthetic. Expected values are hand-calculated, so
these checks do not reuse the implementation's aggregation helpers.
"""
from __future__ import annotations

import copy
import json
import math
import unittest

from insights import build_insights, demo_mix


PERIOD = {"start": "2026-01-01", "end": "2026-06-30"}


def sale(name="가상 A", price=500_000_000, when="2026-02-15", **changes):
    row = {
        "id": f"{name}-{price}-{when}", "region_code": "11680",
        "district": "강남구", "neighborhood": "청담동", "apartment": name,
        "kind": "sale", "price_krw": price, "deposit_krw": None,
        "monthly_rent_krw": None, "area_m2": 59.0, "floor": 5,
        "contract_date": when, "canceled": False,
    }
    row.update(changes)
    return row


def repeat(count, **changes):
    return [sale(**changes, id=f"fixture-{index}-{changes}")
            for index in range(count)]


def composition_rows():
    """Same 500m/1bn cohort prices, but expensive share grows 20% -> 80%."""
    return (repeat(8, name="가상 A", price=500_000_000, when="2026-02-15")
            + repeat(2, name="가상 B", price=1_000_000_000, when="2026-02-15", area_m2=84.0)
            + repeat(2, name="가상 A", price=500_000_000, when="2026-05-15")
            + repeat(8, name="가상 B", price=1_000_000_000, when="2026-05-15", area_m2=84.0))


class CompositionTests(unittest.TestCase):
    def test_composition_only_can_double_raw_median_without_matched_price_change(self):
        mix = build_insights(composition_rows(), period=PERIOD)["mix"]
        self.assertEqual(mix["status"], "ready")
        self.assertEqual(mix["raw_change_pct"], 100)
        self.assertEqual(mix["matched_change_pct"], 0)
        self.assertEqual(mix["matched_before_krw"], 600_000_000)
        self.assertEqual(mix["matched_after_krw"], 600_000_000)
        self.assertEqual(mix["mix_gap_pp"], 100)
        self.assertEqual(mix["matched_cohorts"], 2)
        self.assertEqual(mix["before"]["count"], 10)
        self.assertEqual(mix["after"]["count"], 10)
        self.assertEqual(mix["coverage_pct"], {"before": 100, "after": 100})

    def test_fixed_baseline_counts_weight_price_levels_not_percentage_returns(self):
        rows = (repeat(6, name="A", price=500_000_000)
                + repeat(2, name="B", price=1_000_000_000)
                + repeat(2, name="A", price=550_000_000, when="2026-05-15")
                + repeat(6, name="B", price=900_000_000, when="2026-05-15"))
        mix = build_insights(rows, period=PERIOD)["mix"]
        # Baseline 6:2 count weights give 625m -> 637.5m, hence +2%.
        # Mean cohort percentage return would instead be +5%, which is not
        # this method. Current-period weights would measure changed composition.
        self.assertEqual(mix["matched_before_krw"], 625_000_000)
        self.assertEqual(mix["matched_after_krw"], 637_500_000)
        self.assertAlmostEqual(mix["matched_change_pct"], 2, places=5)
        self.assertEqual(mix["raw_change_pct"], 80)

    def test_one_matched_cohort_is_insufficient_not_zero_percent(self):
        rows = [row for row in composition_rows() if row["apartment"] == "가상 A"]
        mix = build_insights(rows, period=PERIOD)["mix"]
        self.assertNotEqual(mix["status"], "ready")
        self.assertEqual(mix["matched_cohorts"], 1)
        self.assertIsNone(mix["matched_change_pct"])
        self.assertIsNone(mix["mix_gap_pp"])
        self.assertEqual(mix["raw_change_pct"], 0)

    def test_single_sale_in_each_period_does_not_qualify_a_cohort(self):
        rows = [sale(name=name, when=when) for name in ("A", "B")
                for when in ("2026-02-15", "2026-05-15")]
        mix = build_insights(rows, period=PERIOD)["mix"]
        self.assertNotEqual(mix["status"], "ready")
        self.assertEqual(mix["matched_cohorts"], 0)
        self.assertIsNone(mix["matched_change_pct"])

    def test_same_apartment_name_in_different_neighborhoods_is_not_merged(self):
        rows = [sale(name=name, when=when, neighborhood=dong)
                for name in ("A", "B") for dong in ("청담동", "대치동")
                for when in ("2026-02-15", "2026-05-15")]
        mix = build_insights(rows, period=PERIOD)["mix"]
        self.assertEqual(mix["matched_cohorts"], 0)
        self.assertIsNone(mix["matched_change_pct"])

    def test_identical_names_across_regions_do_not_create_false_matches(self):
        rows = [sale(name=name, when=when, region_code=region)
                for name in ("A", "B") for region in ("11680", "11200")
                for when in ("2026-02-15", "2026-05-15")]
        mix = build_insights(rows, period=PERIOD)["mix"]
        self.assertEqual(mix["matched_cohorts"], 0)
        self.assertIsNone(mix["matched_change_pct"])

    def test_canceled_missing_price_and_non_sale_rows_cannot_move_results(self):
        clean = build_insights(composition_rows(), period=PERIOD)["mix"]
        excluded = [sale(price=2_000_000_000, canceled=True), sale(price=None),
                    sale(kind="jeonse", price=None, deposit_krw=900_000_000),
                    sale(kind="monthly", price=None, deposit_krw=10_000_000,
                         monthly_rent_krw=1_000_000)]
        actual = build_insights(composition_rows() + excluded, period=PERIOD)["mix"]
        for key in ("raw_change_pct", "matched_change_pct", "matched_cohorts",
                    "matched_before_count", "matched_after_count", "before", "after"):
            self.assertEqual(actual[key], clean[key], key)

    def test_coverage_reports_unmatched_transactions_in_denominator(self):
        rows = composition_rows() + repeat(10, name="new-only", when="2026-05-15")
        mix = build_insights(rows, period=PERIOD)["mix"]
        self.assertEqual(mix["coverage_pct"], {"before": 100, "after": 50})
        self.assertEqual(mix["matched_after_count"], 10)
        self.assertEqual(mix["after"]["count"], 20)

    def test_empty_records_have_null_comparisons_and_no_candidates(self):
        result = build_insights([], period=PERIOD)
        self.assertIsNone(result["mix"]["raw_change_pct"])
        self.assertIsNone(result["mix"]["matched_change_pct"])
        self.assertEqual(result["blind"]["candidates"], [])
        json.dumps(result, allow_nan=False)

    def test_demonstrator_is_explicitly_fictional_and_has_known_result(self):
        mix = demo_mix()
        self.assertIs(mix["is_example"], True)
        self.assertEqual(mix["raw_change_pct"], 100)
        self.assertEqual(mix["matched_change_pct"], 0)


class WindowAndFilterTests(unittest.TestCase):
    def test_three_month_window_has_one_earlier_and_two_later_months(self):
        period = {"start": "2026-01-12", "end": "2026-03-17"}
        rows = [sale(when=d) for d in ("2026-01-11", "2026-01-12", "2026-01-31",
                                       "2026-02-01", "2026-03-17", "2026-03-18")]
        mix = build_insights(rows, period=period)["mix"]
        self.assertEqual(mix["before"]["start"], "2026-01-12")
        self.assertEqual(mix["before"]["end"], "2026-01-31")
        self.assertEqual(mix["after"]["start"], "2026-02-01")
        self.assertEqual(mix["after"]["end"], "2026-03-17")
        self.assertEqual(mix["before"]["count"], 2)
        self.assertEqual(mix["after"]["count"], 2)

    def test_dates_outside_explicit_window_do_not_leak_into_either_feature(self):
        rows = composition_rows()
        result = build_insights(rows + repeat(20, name="outside", price=9_000_000_000,
                                            when="2027-01-01"), period=PERIOD)
        self.assertEqual(result["mix"]["raw_change_pct"], 100)
        self.assertEqual(result["mix"]["after"]["count"], 10)
        self.assertNotIn("outside", [card["name"] for card in result["blind"]["candidates"]])

    def test_one_calendar_month_cannot_imply_two_comparison_windows(self):
        rows = repeat(2, name="A") + repeat(2, name="B")
        result = build_insights(rows, period={"start": "2026-02-01", "end": "2026-02-28"})
        self.assertNotEqual(result["mix"]["status"], "ready")
        self.assertIsNone(result["mix"]["raw_change_pct"])
        self.assertIsNone(result["mix"]["matched_change_pct"])
        self.assertEqual(len(result["blind"]["candidates"]), 2)

    def test_inferred_period_ignores_canceled_future_contract(self):
        rows = composition_rows()
        clean = build_insights(rows)["mix"]
        altered = build_insights(rows + [sale(when="2030-01-01", canceled=True)])["mix"]
        self.assertEqual(altered, clean)

    def test_exact_area_and_neighborhood_filters_apply_to_both_features(self):
        rows = composition_rows() + repeat(5, name="other dong", neighborhood="대치동")
        result = build_insights(rows, area_band="small", neighborhood="청담동", period=PERIOD)
        self.assertEqual(result["mix"]["before"]["count"], 8)
        self.assertEqual(result["mix"]["after"]["count"], 2)
        self.assertEqual(result["blind"]["eligible_cohorts"], 1)
        for card in result["blind"]["candidates"]:
            self.assertLessEqual(card["area_m2"], 60)
            self.assertEqual(card["neighborhood"], "청담동")

    def test_five_square_meter_buckets_remain_distinct(self):
        rows = []
        for area in (59.99, 60.0):
            rows += repeat(2, name="same building", area_m2=area)
            rows += repeat(2, name="same building", area_m2=area, when="2026-05-15")
        result = build_insights(rows, period=PERIOD)
        self.assertEqual(result["mix"]["matched_cohorts"], 2)
        self.assertEqual(result["blind"]["eligible_cohorts"], 2)


class BlindChoiceTests(unittest.TestCase):
    def test_candidates_are_observed_cohorts_with_exact_medians_and_counts(self):
        rows = composition_rows()
        result = build_insights(rows, period=PERIOD)["blind"]
        self.assertEqual(result["eligible_cohorts"], 2)
        self.assertEqual(len(result["candidates"]), 2)
        by_name = {card["name"]: card for card in result["candidates"]}
        self.assertEqual(by_name["가상 A"]["sale_krw"], 500_000_000)
        self.assertEqual(by_name["가상 A"]["area_m2"], 59.0)
        self.assertEqual(by_name["가상 B"]["sale_krw"], 1_000_000_000)
        self.assertEqual(by_name["가상 B"]["area_m2"], 84.0)
        for card in result["candidates"]:
            self.assertEqual(card["sale_count"], 10)
            self.assertEqual(card["first_date"], "2026-02-15")
            self.assertEqual(card["last_date"], "2026-05-15")
            self.assertEqual(card["neighborhood"], "청담동")
        self.assertEqual(len({card["id"] for card in result["candidates"]}), 2)

    def test_missing_names_and_single_observations_are_not_candidates(self):
        rows = composition_rows() + repeat(5, name=" ") + repeat(5, neighborhood="") + [sale(name="only once")]
        result = build_insights(rows, period=PERIOD)["blind"]
        self.assertEqual(result["eligible_cohorts"], 2)
        self.assertEqual({card["name"] for card in result["candidates"]}, {"가상 A", "가상 B"})

    def test_selection_is_deterministic_across_input_order_and_never_exceeds_three(self):
        rows = composition_rows()
        for index in range(8):
            rows += repeat(3, name=f"가상 additional {index}", price=(index + 4) * 100_000_000,
                           area_m2=40.0 + index * 5)
        first = build_insights(rows, period=PERIOD)["blind"]
        second = build_insights(list(reversed(rows)), period=PERIOD)["blind"]
        self.assertEqual(first, second)
        self.assertEqual(first["eligible_cohorts"], 10)
        self.assertEqual(len(first["candidates"]), 3)
        self.assertTrue(all(card["sale_count"] >= 2 for card in first["candidates"]))

    def test_input_is_unchanged(self):
        rows = composition_rows()
        snapshot = copy.deepcopy(rows)
        build_insights(rows, period=PERIOD)
        self.assertEqual(rows, snapshot)


class ValidationTests(unittest.TestCase):
    def test_invalid_price_types_and_nonfinite_values_are_rejected(self):
        for value in (0, -1, True, "500000000", math.nan, math.inf, -math.inf):
            with self.subTest(value=value), self.assertRaises(ValueError):
                build_insights([sale(price=value)], period=PERIOD)

    def test_invalid_areas_dates_and_cancellation_flags_are_rejected(self):
        for changes in ({"area_m2": 0}, {"area_m2": math.nan}, {"area_m2": True},
                        {"contract_date": "2026-02-30"}, {"contract_date": "20260101"},
                        {"canceled": "false"}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                build_insights([sale(**changes)], period=PERIOD)

    def test_invalid_period_and_filter_inputs_are_rejected(self):
        for period in ([], {"start": "2026-06-30", "end": "2026-01-01"},
                       {"start": "2026-01", "end": "2026-06"},
                       {"start": True, "end": "2026-06-30"}):
            with self.subTest(period=period), self.assertRaises(ValueError):
                build_insights(composition_rows(), period=period)
        for kwargs in ({"area_band": "unknown"}, {"area_band": []}, {"neighborhood": True}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                build_insights(composition_rows(), **kwargs)

    def test_record_limit_is_enforced(self):
        with self.assertRaises(ValueError):
            build_insights([sale()] * 5001, period=PERIOD)


if __name__ == "__main__":
    unittest.main()
