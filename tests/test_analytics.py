"""Behavioral checks for property statistics and explicitly hypothetical cash flows."""

import copy
import math
import unittest

from analytics import analyze


def transaction(kind="sale", amount=500_000_000, **changes):
    row = {
        "id": "fixture-1", "region_code": "11680", "district": "강남구",
        "neighborhood": "청담동", "apartment": "검산용 가상 아파트",
        "area_m2": 84.0, "floor": 3, "contract_date": "2026-09-15",
        "kind": kind, "price_krw": amount if kind == "sale" else None,
        "deposit_krw": amount if kind != "sale" else None,
        "monthly_rent_krw": 1_000_000 if kind == "monthly" else None,
        "canceled": False,
    }
    row.update(changes)
    return row


def sales(prices=(400_000_000, 450_000_000, 500_000_000, 550_000_000, 600_000_000)):
    return [transaction(amount=price, id=f"sale-{i}") for i, price in enumerate(prices)]


class MarketStatisticsTests(unittest.TestCase):
    def test_medians_use_real_values_and_budget_share_counts_transactions(self):
        rows = sales() + [transaction("jeonse", 250_000_000), transaction("monthly", 100_000_000)]
        result = analyze(rows, assumptions={"budget_krw": 500_000_000})
        self.assertEqual(result["counts"], {"sale": 5, "jeonse": 1, "monthly": 1, "total": 7})
        self.assertEqual(result["medians"]["sale_krw"], 500_000_000)
        self.assertEqual(result["medians"]["jeonse_krw"], 250_000_000)
        self.assertEqual(result["medians"]["monthly_rent_krw"], 1_000_000)
        self.assertEqual(result["budget_share"]["within_count"], 3)
        self.assertEqual(result["budget_share"]["total"], 5)
        self.assertEqual(result["budget_share"]["percent"], 60)

    def test_cancellation_cannot_inflate_counts_or_change_median(self):
        result = analyze(sales() + [transaction(amount=1, canceled=True)])
        self.assertEqual(result["counts"]["sale"], 5)
        self.assertEqual(result["medians"]["sale_krw"], 500_000_000)

    def test_missing_price_is_not_a_zero_price_transaction(self):
        result = analyze(sales() + [transaction(amount=None)])
        self.assertEqual(result["counts"]["sale"], 5)
        self.assertEqual(result["medians"]["sale_krw"], 500_000_000)
        self.assertTrue(result["warnings"])

    def test_area_boundaries_do_not_overlap(self):
        rows = [transaction(area_m2=value, id=str(value)) for value in (60, 60.01, 85, 85.01)]
        self.assertEqual(analyze(rows, area_band="small")["counts"]["sale"], 1)
        self.assertEqual(analyze(rows, area_band="medium")["counts"]["sale"], 2)
        self.assertEqual(analyze(rows, area_band="large")["counts"]["sale"], 1)

    def test_neighborhood_filter_is_exact(self):
        rows = sales() + [transaction(neighborhood="역삼동", amount=100_000_000)]
        result = analyze(rows, neighborhood="청담동")
        self.assertEqual(result["counts"]["sale"], 5)
        self.assertEqual(result["medians"]["sale_krw"], 500_000_000)
        empty = analyze(rows, neighborhood="없는동")
        self.assertEqual(empty["counts"]["total"], 0)
        self.assertIsNone(empty["medians"]["sale_krw"])

    def test_sparse_or_empty_market_has_no_fit_score(self):
        for rows in ([], sales()[:4]):
            with self.subTest(size=len(rows)):
                result = analyze(rows)
                self.assertIsNone(result["fit"]["score"])
                self.assertEqual(result["fit"]["confidence"], "insufficient")
        self.assertIsNotNone(analyze(sales())["fit"]["score"])

    def test_identical_transactions_remain_distinct(self):
        rows = [transaction(id=f"legitimate-{i}") for i in range(5)]
        self.assertEqual(analyze(rows)["counts"]["sale"], 5)

    def test_analysis_does_not_mutate_input(self):
        rows = sales()
        snapshot = copy.deepcopy(rows)
        analyze(rows, assumptions={"budget_krw": 500_000_000})
        self.assertEqual(rows, snapshot)


class ScenarioTests(unittest.TestCase):
    def setUp(self):
        self.rows = sales() + [transaction("jeonse", 250_000_000), transaction("monthly", 100_000_000)]
        self.assumptions = {"budget_krw": 600_000_000, "equity_krw": 300_000_000,
                            "loan_rate_pct": 5, "loan_years": 30, "vacancy_pct": 5,
                            "annual_cost_krw": 2_400_000}

    def test_known_loan_and_regional_cashflow_example(self):
        result = analyze(self.rows, assumptions=self.assumptions)
        scenario = result["scenario"]
        self.assertEqual(scenario["purchase_krw"], 500_000_000)
        self.assertEqual(scenario["loan_krw"], 200_000_000)
        self.assertAlmostEqual(scenario["monthly_payment_krw"], 1_073_643.25, delta=1)
        self.assertAlmostEqual(scenario["monthly_interest_krw"], 833_333.33, delta=1)
        self.assertAlmostEqual(scenario["stress_payment_krw"], 1_330_604.99, delta=1)
        # Vacancy-adjusted 950,000 rent - 833,333 interest - 200,000 operating cost.
        self.assertAlmostEqual(scenario["monthly_cashflow_krw"], -83_333.33, delta=1)
        # A 10% deposit decline is a separate liquidity scenario, not rent income.
        self.assertEqual(scenario["jeonse_return_gap_krw"], 25_000_000)
        self.assertTrue(scenario["notes"])

    def test_zero_interest_amortizes_principal_without_division_by_zero(self):
        self.assumptions["loan_rate_pct"] = 0
        scenario = analyze(self.rows, assumptions=self.assumptions)["scenario"]
        self.assertAlmostEqual(scenario["monthly_payment_krw"], 555_555.56, delta=1)
        self.assertEqual(scenario["monthly_interest_krw"], 0)
        self.assertGreater(scenario["stress_payment_krw"], scenario["monthly_payment_krw"])

    def test_equity_above_purchase_produces_no_negative_loan(self):
        self.assumptions["equity_krw"] = 600_000_000
        scenario = analyze(self.rows, assumptions=self.assumptions)["scenario"]
        self.assertEqual(scenario["loan_krw"], 0)
        self.assertEqual(scenario["monthly_payment_krw"], 0)
        self.assertEqual(scenario["stress_payment_krw"], 0)

    def test_missing_rent_never_implies_zero_rent_or_a_computed_return(self):
        scenario = analyze(sales(), assumptions=self.assumptions)["scenario"]
        self.assertIsNone(scenario["monthly_cashflow_krw"])
        self.assertIsNone(scenario["jeonse_return_gap_krw"])

    def test_regional_rental_deposit_is_not_used_as_acquisition_financing(self):
        changed = copy.deepcopy(self.rows)
        changed[-1]["deposit_krw"] = 400_000_000
        self.assertEqual(analyze(changed, assumptions=self.assumptions)["scenario"]["loan_krw"], 200_000_000)


class ValidationTests(unittest.TestCase):
    def test_invalid_assumptions_are_rejected(self):
        cases = [("budget_krw", 0), ("budget_krw", -1), ("budget_krw", True),
                 ("equity_krw", -1), ("loan_rate_pct", math.nan),
                 ("loan_rate_pct", math.inf), ("loan_rate_pct", -1),
                 ("loan_years", 0), ("vacancy_pct", 101), ("annual_cost_krw", -1)]
        for key, value in cases:
            with self.subTest(key=key, value=value):
                with self.assertRaises(ValueError):
                    analyze(sales(), assumptions={key: value})

    def test_invalid_record_numbers_cannot_become_valid_transaction_stats(self):
        for value in (0, -1, math.nan, math.inf, True):
            with self.subTest(value=value):
                try:
                    result = analyze(sales() + [transaction(amount=value)])
                except ValueError:
                    continue  # Rejecting the entire request is also safe.
                self.assertEqual(result["counts"]["sale"], 5)
                self.assertEqual(result["medians"]["sale_krw"], 500_000_000)
                self.assertTrue(result["warnings"])

    def test_unknown_area_band_is_rejected(self):
        with self.assertRaises(ValueError):
            analyze(sales(), area_band="huge")

    def test_record_limit_is_enforced(self):
        with self.assertRaises(ValueError):
            analyze([transaction()] * 5001)


if __name__ == "__main__":
    unittest.main()
