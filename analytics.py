"""Deterministic apartment comparisons; not an appraisal or lending decision.

All monetary input and output values are Korean won. Unknown values remain None.
The only public entry point is ``analyze(records, area_band, neighborhood,
assumptions)``; it returns the JSON-compatible contract documented in docs/API.md.
This module uses no network, storage, third-party libraries, or current-market
assumptions. User-condition scores are transparent arithmetic heuristics.
"""

from __future__ import annotations

import math
from collections import defaultdict
from datetime import date
from statistics import median
from typing import Any


DEFAULT_ASSUMPTIONS = {
    "budget_krw": 1_500_000_000,
    "equity_krw": 700_000_000,
    "loan_rate_pct": 4.5,
    "loan_years": 30,
    "vacancy_pct": 5,
    "annual_cost_krw": 2_400_000,
}
MAX_RECORDS = 5_000
_KINDS = {"sale", "jeonse", "monthly"}
_AREA_BANDS = {"all", "small", "medium", "large"}
_ASSUMPTION_LIMITS = {
    "budget_krw": (1_000_000, 1_000_000_000_000, True),
    "equity_krw": (0, 1_000_000_000_000, True),
    "loan_rate_pct": (0, 30, False),
    "loan_years": (1, 50, True),
    "vacancy_pct": (0, 100, False),
    "annual_cost_krw": (0, 10_000_000_000, True),
}


def _number(value: Any, label: str, minimum: float, maximum: float,
            *, integer: bool = False, nullable: bool = False) -> int | float | None:
    if value is None and nullable:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label}: 숫자를 입력해 주세요.")
    if not minimum <= value <= maximum or not math.isfinite(value):
        raise ValueError(f"{label}: {minimum:g}~{maximum:g} 범위의 유한한 숫자가 필요합니다.")
    if integer and int(value) != value:
        raise ValueError(f"{label}: 정수 단위로 입력해 주세요.")
    return int(value) if integer else float(value)


def _text(value: Any, label: str, *, default: str = "", limit: int = 200) -> str:
    if value is None:
        return default
    if not isinstance(value, str) or len(value) > limit:
        raise ValueError(f"{label}: {limit}자 이내의 문자열이 필요합니다.")
    return value.strip()


def _assumptions(values: dict[str, Any] | None) -> dict[str, int | float]:
    if values is None:
        values = {}
    if not isinstance(values, dict):
        raise ValueError("자금 가정은 객체 형식이어야 합니다.")
    if set(values) - set(DEFAULT_ASSUMPTIONS):
        raise ValueError("지원하지 않는 자금 가정 항목이 있습니다.")
    result = {}
    for key, default in DEFAULT_ASSUMPTIONS.items():
        minimum, maximum, integer = _ASSUMPTION_LIMITS[key]
        result[key] = _number(values.get(key, default), key, minimum, maximum,
                              integer=integer)
    return result


def _validated_records(records: Any) -> list[dict[str, Any]]:
    if not isinstance(records, list) or len(records) > MAX_RECORDS:
        raise ValueError(f"거래 자료는 최대 {MAX_RECORDS:,}개 행의 배열이어야 합니다.")
    result = []
    for index, source in enumerate(records, 1):
        label = f"거래 {index}행"
        if not isinstance(source, dict):
            raise ValueError(f"{label}: 객체 형식이 필요합니다.")
        kind = source.get("kind")
        if not isinstance(kind, str) or kind not in _KINDS:
            raise ValueError(f"{label}: sale, jeonse, monthly 중 거래 유형을 지정해 주세요.")
        canceled = source.get("canceled", False)
        if not isinstance(canceled, bool):
            raise ValueError(f"{label}: 해제 여부는 true/false여야 합니다.")
        raw_date = source.get("contract_date")
        if not isinstance(raw_date, str):
            raise ValueError(f"{label}: 계약일은 YYYY-MM-DD 형식이어야 합니다.")
        try:
            parsed_date = date.fromisoformat(raw_date)
        except ValueError as exc:
            raise ValueError(f"{label}: 올바른 계약일을 입력해 주세요.") from exc
        if parsed_date.isoformat() != raw_date:
            raise ValueError(f"{label}: 계약일은 YYYY-MM-DD 형식이어야 합니다.")
        area = _number(source.get("area_m2"), f"{label} 전용면적", 0.01, 2_000)
        price = _number(source.get("price_krw"), f"{label} 매매가", 1,
                        10_000_000_000_000, integer=True, nullable=True)
        deposit = _number(source.get("deposit_krw"), f"{label} 보증금", 0,
                          10_000_000_000_000, integer=True, nullable=True)
        rent = _number(source.get("monthly_rent_krw"), f"{label} 월세", 0,
                       1_000_000_000, integer=True, nullable=True)
        floor = _number(source.get("floor"), f"{label} 층", -20, 300,
                        integer=True, nullable=True)
        row = {
            "kind": kind, "canceled": canceled, "contract_date": raw_date,
            "area_m2": area, "price_krw": price, "deposit_krw": deposit,
            "monthly_rent_krw": rent, "floor": floor,
            "apartment": _text(source.get("apartment"), f"{label} 단지명",
                               default="단지명 미상") or "단지명 미상",
            "neighborhood": _text(source.get("neighborhood"), f"{label} 법정동"),
        }
        result.append(row)
    return result


def _in_area(area: float, band: str) -> bool:
    return (band == "all" or (band == "small" and area <= 60)
            or (band == "medium" and 60 < area <= 85)
            or (band == "large" and area > 85))


def _median(values: list[int | float]) -> int | None:
    return round(median(values)) if values else None


def _payment(principal: int | float, annual_rate: int | float,
             years: int | float) -> int:
    if principal <= 0:
        return 0
    installments = int(years * 12)
    if annual_rate == 0:
        return round(principal / installments)
    monthly_rate = annual_rate / 1_200
    # Stable annuity calculation, including very small positive rates.
    denominator = -math.expm1(-installments * math.log1p(monthly_rate))
    return round(principal * monthly_rate / denominator)


def _won(value: int | float) -> str:
    return f"{round(value / 10_000):,}만원"


def analyze(records: list[dict[str, Any]], area_band: str = "all",
            neighborhood: str = "", assumptions: dict[str, Any] | None = None
            ) -> dict[str, Any]:
    """Validate and summarize reported transactions with explicit uncertainty.

    Invalid numeric types/values raise ValueError. Unknown essential monetary
    observations are excluded and counted in warnings rather than imputed as 0.
    ``budget_share`` counts filtered sale contracts at or below the user budget;
    it is a historic sample share, not the share of available listings.
    """
    if not isinstance(area_band, str) or area_band not in _AREA_BANDS:
        raise ValueError("면적 구간은 all, small, medium, large 중 하나여야 합니다.")
    neighborhood = _text(neighborhood, "동 이름", limit=100)
    settings = _assumptions(assumptions)
    rows = _validated_records(records)
    warnings = []
    canceled_count = sum(row["canceled"] for row in rows)
    filtered = [row for row in rows if not row["canceled"]
                and _in_area(row["area_m2"], area_band)
                and (not neighborhood or row["neighborhood"] == neighborhood)]
    usable = []
    missing_count = 0
    for row in filtered:
        essential = {"sale": row["price_krw"], "jeonse": row["deposit_krw"],
                     "monthly": row["monthly_rent_krw"]}[row["kind"]]
        if essential is None or essential <= 0:
            missing_count += 1
        else:
            usable.append(row)
    filtered = usable
    by_kind = {kind: [row for row in filtered if row["kind"] == kind]
               for kind in ("sale", "jeonse", "monthly")}
    sales = [row["price_krw"] for row in by_kind["sale"]]
    jeonse = [row["deposit_krw"] for row in by_kind["jeonse"]]
    rents = [row["monthly_rent_krw"] for row in by_kind["monthly"]]
    monthly_deposits = [row["deposit_krw"] for row in by_kind["monthly"]
                        if row["deposit_krw"] is not None]
    counts = {kind: len(by_kind[kind]) for kind in by_kind}
    counts["total"] = len(filtered)
    medians = {
        "sale_krw": _median(sales), "jeonse_krw": _median(jeonse),
        "monthly_rent_krw": _median(rents),
        "monthly_deposit_krw": _median(monthly_deposits),
        "price_per_m2_krw": _median([row["price_krw"] / row["area_m2"]
                                      for row in by_kind["sale"]]),
    }
    if canceled_count:
        warnings.append(f"해제된 거래 {canceled_count:,}건은 모든 분석에서 제외했습니다.")
    if missing_count:
        warnings.append(f"필수 금액이 없거나 유효하지 않은 거래 {missing_count:,}건을 제외했습니다. 0원으로 보정하지 않았습니다.")
    if not filtered:
        warnings.append("선택한 동·면적 조건에 맞는 유효 거래가 없습니다. 조건을 넓혀 주세요.")
    elif len(sales) < 5:
        warnings.append("매매 표본이 5건 미만이라 조건 적합도 점수를 계산하지 않습니다.")
    if 0 < len(jeonse) < 5 or 0 < len(rents) < 5:
        warnings.append("임대 유형별 표본이 5건 미만이면 중위값이 일부 거래에 크게 영향을 받을 수 있습니다.")

    months: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in filtered:
        months[row["contract_date"][:7]].append(row)
    trend = []
    for month, observations in sorted(months.items()):
        sale_values = [r["price_krw"] for r in observations if r["kind"] == "sale"]
        jeonse_values = [r["deposit_krw"] for r in observations if r["kind"] == "jeonse"]
        trend.append({"month": month, "sale_krw": _median(sale_values),
                      "jeonse_krw": _median(jeonse_values),
                      "sale_count": len(sale_values), "rent_count": len(jeonse_values)})

    groups: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in filtered:
        groups[(row["apartment"], row["neighborhood"])].append(row)
    apartments = []
    for (name, dong), observations in groups.items():
        sale_values = [r["price_krw"] for r in observations if r["kind"] == "sale"]
        apartments.append({
            "name": name, "neighborhood": dong,
            "area_m2": round(median([r["area_m2"] for r in observations]), 2),
            "sale_krw": _median(sale_values), "sale_count": len(sale_values),
            "jeonse_krw": _median([r["deposit_krw"] for r in observations if r["kind"] == "jeonse"]),
            "monthly_rent_krw": _median([r["monthly_rent_krw"] for r in observations if r["kind"] == "monthly"]),
            "jeonse_count": sum(r["kind"] == "jeonse" for r in observations),
            "monthly_count": sum(r["kind"] == "monthly" for r in observations),
        })
    apartments.sort(key=lambda item: (-item["sale_count"], item["name"], item["neighborhood"]))
    if len(apartments) > 30:
        warnings.append(f"단지 비교는 매매 표본이 많은 상위 30개를 표시합니다. 전체 통계에는 {len(apartments):,}개 단지가 포함됩니다.")

    purchase = medians["sale_krw"]
    within_count = sum(value <= settings["budget_krw"] for value in sales)
    budget_share = {"within_count": within_count, "total": len(sales),
                    "percent": round(100 * within_count / len(sales), 1) if sales else None}
    reasons = []
    components = []
    confidence = "insufficient" if len(sales) < 5 else "limited" if len(sales) < 20 else "good"
    score = None
    label = "자료 부족 · 조건을 넓혀 보세요"
    if purchase is not None:
        budget_points = round(60 * min(1, settings["budget_krw"] / purchase))
        funding_points = round(40 * min(1, settings["equity_krw"] / purchase))
        components = [
            {"label": "예산 적합", "score": budget_points if len(sales) >= 5 else None,
             "max_score": 60, "detail": "60 × min(1, 입력 예산 ÷ 매매 중위값)"},
            {"label": "자기자금 여력", "score": funding_points if len(sales) >= 5 else None,
             "max_score": 40, "detail": "40 × min(1, 입력 자기자금 ÷ 매매 중위값)"},
        ]
        if purchase > settings["budget_krw"]:
            reasons.append(f"매매 중위값이 입력 예산보다 {_won(purchase - settings['budget_krw'])} 높습니다.")
        else:
            reasons.append(f"매매 중위값은 입력 예산 안에 있습니다. 예산 차이는 {_won(settings['budget_krw'] - purchase)}입니다.")
        reasons.append(f"필터에 맞는 과거 매매 {len(sales):,}건 중 {within_count:,}건이 입력 예산 이하입니다.")
        if len(sales) >= 5:
            score = budget_points + funding_points
            label = ("예산 조정 검토" if purchase > settings["budget_krw"] else
                     "자금 여유가 비교적 있는 편" if score >= 85 else
                     "추가 자금 조건 확인" if score >= 65 else "자금 부담 점검 필요")
    if len(sales) < 5:
        reasons.append("매매 표본 5건 이상일 때만 점수를 표시합니다.")
    reasons.append("점수는 입력 자금과 거래 중위값의 비교이며, 투자수익·가격상승·대출승인 가능성을 예측하지 않습니다.")
    fit = {"score": score, "label": label, "reasons": reasons,
           "components": components, "confidence": confidence}

    loan = max(purchase - settings["equity_krw"], 0) if purchase is not None else None
    interest = round(loan * settings["loan_rate_pct"] / 1_200) if loan is not None else None
    cashflow = None
    if loan is not None and medians["monthly_rent_krw"] is not None:
        # Use unrounded interest for arithmetic; round only the displayed output.
        cashflow = round(medians["monthly_rent_krw"] * (1 - settings["vacancy_pct"] / 100)
                         - loan * settings["loan_rate_pct"] / 1_200
                         - settings["annual_cost_krw"] / 12)
    scenario = {
        "purchase_krw": purchase, "loan_krw": loan,
        "monthly_payment_krw": _payment(loan, settings["loan_rate_pct"], settings["loan_years"]) if loan is not None else None,
        "monthly_interest_krw": interest,
        "stress_payment_krw": _payment(loan, settings["loan_rate_pct"] + 2, settings["loan_years"]) if loan is not None else None,
        "monthly_cashflow_krw": cashflow,
        "jeonse_return_gap_krw": round(medians["jeonse_krw"] * 0.1) if medians["jeonse_krw"] is not None else None,
        "notes": [
            f"대출 가정은 매매 중위값 − 자기자금(최소 0원)입니다. 실제 대출 한도·승인·규제를 반영하지 않습니다.",
            f"월 상환액은 {settings['loan_years']}년 원리금균등상환입니다. 금리 부담 비교는 입력 금리 +2%p를 적용합니다.",
            f"월 임대 현금흐름은 월세 중위값 × (1 − 공실률 {settings['vacancy_pct']:g}%) − 월 이자 − 연 운영비 {_won(settings['annual_cost_krw'])} ÷ 12입니다. 원금상환과 세금은 제외합니다.",
            "매매·전세·월세 중위값은 서로 다른 거래 표본입니다. 같은 세대의 수익률이 아니며 보증금으로 대출을 줄이지 않습니다.",
            "보증금 10% 감소 시 반환할 추가 자금만 가정합니다. 보증금 자체는 수익이 아니라 반환 의무가 있는 자금입니다.",
            "취득세·중개보수·등기비용·대규모 수선비·보유세 등은 별도 확인이 필요하며 초기 자기자금 계산에 포함되지 않습니다.",
        ],
    }
    return {
        "counts": counts, "medians": medians, "trend": trend,
        "apartments": apartments[:30], "fit": fit, "scenario": scenario,
        "budget_share": budget_share, "warnings": warnings,
        "methodology": [
            "금액은 선택 지역·동·면적·기간의 신고 거래 중위값입니다. 현재 매물 호가·감정가격·공식 가격지수가 아닙니다.",
            "소형은 전용 60㎡ 이하, 중형은 60㎡ 초과~85㎡ 이하, 대형은 85㎡ 초과입니다. 모든 금액은 원 단위로 계산합니다.",
            "해제 거래와 필수 금액이 없는 행은 제외합니다. 알 수 없는 값을 0으로 대체하지 않습니다.",
            "월별 중위값은 거래된 단지·면적·층의 구성 변화에 영향을 받습니다. 같은 주택의 가격변화나 수익률로 해석하지 마세요.",
            "단지 비교는 같은 단지명·동의 거래를 묶은 값으로, 면적·층이 같은 개별 세대 비교가 아닙니다.",
            "조건 적합도 = 예산 적합 60점 + 자기자금 여력 40점의 공개된 가정식입니다. 거래 표본 5건 미만이면 점수를 표시하지 않습니다.",
            "자료 충실도는 매매 표본 수만 표시합니다(5건 미만: 부족, 5~19건: 제한적, 20건 이상: 충분). 자료의 정확도·미래 예측 신뢰도를 보증하지 않습니다.",
            "예산 이하 비율은 선택한 과거 매매 중 예산 이하 거래의 비율이며, 현재 구매 가능한 매물 비율이 아닙니다.",
        ],
    }
