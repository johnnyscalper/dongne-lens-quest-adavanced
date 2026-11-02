"""Two small, evidence-bound experiments for Dongne Lens Quest.

All money is KRW. Comparisons describe observed contracts, not listings or
future returns. Only the Python standard library is used. No user choice is
stored here. ``build_insights`` returns JSON-compatible data; ``demo_mix`` is an
explicitly fictional teaching fixture, never a replacement for market data.
"""
from __future__ import annotations

import hashlib
from collections import defaultdict
from datetime import date, timedelta
from statistics import median
from typing import Any

from analytics import _in_area, _text, _validated_records

_AREA_BANDS = {"all", "small", "medium", "large"}
_MIN_PER_WINDOW = 2
_MIN_MATCHED_COHORTS = 2
_UNKNOWN_NAMES = {"", "단지명 미상", "미상"}
_MIX_LIMITATIONS = [
    "같은 동·단지·5㎡ 면적 구간을 비교합니다. 같은 세대의 반복 거래는 아닙니다.",
    "층·향·수리 상태·동 위치·정확한 면적 차이와 거래 시점은 보정하지 않았습니다.",
    "두 변화율의 차이는 거래 구성과 표본 선택의 영향을 살펴보는 단서이며, 구성 효과의 인과 추정치가 아닙니다.",
    "조회 마지막 달은 진행 중일 수 있고, 전후 기간의 길이와 표본 수가 다를 수 있습니다. 신고 지연·정정·해제도 반영 시점에 따라 달라집니다.",
]
_METHODOLOGY = (
    "조회 기간을 달 단위로 앞·뒤 두 구간으로 나눕니다. 홀수 개월이면 뒤 구간이 한 달 더 깁니다. "
    "전체 변화율=(뒤 구간 매매 중앙값/앞 구간 매매 중앙값−1)×100. "
    "동·단지·5㎡ 구간(하한 포함, 상한 제외)이 같고 각 구간에 2건 이상 있는 그룹만 매칭합니다. "
    "매칭 그룹이 2개 이상일 때 앞 구간 거래 건수를 고정 가중치로 사용해 "
    "동일 구성 변화율=(Σ(앞 건수×뒤 그룹 중앙값)/Σ(앞 건수×앞 그룹 중앙값)−1)×100을 계산합니다. "
    "두 지표는 모집단과 집계 방식이 다르므로 차이를 가격 착시의 확정적 크기로 해석하지 않습니다."
)


def _parse_date(value: Any, label: str) -> date:
    if not isinstance(value, str):
        raise ValueError(f"{label}: YYYY-MM-DD 형식의 날짜가 필요합니다.")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{label}: 올바른 날짜를 입력해 주세요.") from exc
    if parsed.isoformat() != value:
        raise ValueError(f"{label}: YYYY-MM-DD 형식의 날짜가 필요합니다.")
    return parsed


def _period(period: dict | None, rows: list[dict]) -> tuple[date | None, date | None]:
    if period is None:
        dates = [date.fromisoformat(row["contract_date"]) for row in rows]
        return (min(dates), max(dates)) if dates else (None, None)
    if not isinstance(period, dict) or set(period) != {"start", "end"}:
        raise ValueError("조회 기간은 start와 end 날짜가 있는 객체여야 합니다.")
    start = _parse_date(period["start"], "시작일")
    end = _parse_date(period["end"], "종료일")
    if start > end:
        raise ValueError("조회 시작일은 종료일보다 늦을 수 없습니다.")
    return start, end


def _windows(start: date | None, end: date | None) -> tuple:
    if start is None or end is None:
        return None, None, None, None
    month_count = (end.year - start.year) * 12 + end.month - start.month + 1
    before_months = month_count // 2
    if before_months == 0:
        # One calendar month cannot form two disjoint calendar-month samples.
        return None, None, start, end
    split_month = start.year * 12 + start.month - 1 + before_months
    year, zero_month = divmod(split_month, 12)
    split = date(year, zero_month + 1, 1)
    return start, split - timedelta(days=1), split, end


def _key(row: dict) -> tuple | None:
    if row["apartment"] in _UNKNOWN_NAMES or not row["neighborhood"]:
        return None
    # Keeping region identity prevents like-named apartments in separate
    # districts from merging when the pure function receives mixed regions.
    return (row.get("_region", ""), row["neighborhood"], row["apartment"],
            int(row["area_m2"] // 5) * 5)


def _id(key: tuple) -> str:
    return hashlib.sha256(repr(key).encode("utf-8")).hexdigest()[:16]


def _median(values: list) -> int | None:
    return round(median(values)) if values else None


def _change(before: int | float | None, after: int | float | None) -> float | None:
    return round((after / before - 1) * 100, 2) if before and after is not None else None


def _window_summary(start: date | None, end: date | None, rows: list) -> dict:
    return {"start": start.isoformat() if start else None,
            "end": end.isoformat() if end else None,
            "count": len(rows),
            "median_krw": _median([row["price_krw"] for row in rows])}


def _mix(rows: list[dict], start: date | None, end: date | None) -> dict:
    before_start, before_end, after_start, after_end = _windows(start, end)
    before = [r for r in rows if before_start and
              before_start.isoformat() <= r["contract_date"] <= before_end.isoformat()]
    after = [r for r in rows if after_start and
             after_start.isoformat() <= r["contract_date"] <= after_end.isoformat()]
    grouped_before: dict[tuple, list] = defaultdict(list)
    grouped_after: dict[tuple, list] = defaultdict(list)
    for row in before:
        if (key := _key(row)) is not None:
            grouped_before[key].append(row)
    for row in after:
        if (key := _key(row)) is not None:
            grouped_after[key].append(row)
    keys = sorted(key for key in grouped_before.keys() & grouped_after.keys()
                  if len(grouped_before[key]) >= _MIN_PER_WINDOW
                  and len(grouped_after[key]) >= _MIN_PER_WINDOW)
    matched_before_count = sum(len(grouped_before[key]) for key in keys)
    matched_after_count = sum(len(grouped_after[key]) for key in keys)
    cohorts = []
    for key in keys:
        _, dong, name, area = key
        old_median = median([r["price_krw"] for r in grouped_before[key]])
        new_median = median([r["price_krw"] for r in grouped_after[key]])
        cohorts.append({
            "id": _id(key), "name": name, "neighborhood": dong,
            "area_min_m2": area, "area_max_m2": area + 5,
            "before_count": len(grouped_before[key]),
            "after_count": len(grouped_after[key]),
            "before_median_krw": old_median, "after_median_krw": new_median,
            "change_pct": _change(old_median, new_median),
            "weight_pct": round(len(grouped_before[key]) / matched_before_count * 100, 4),
        })
    ready = len(keys) >= _MIN_MATCHED_COHORTS
    weighted_before = (sum(c["before_count"] * c["before_median_krw"] for c in cohorts)
                       / matched_before_count) if ready else None
    weighted_after = (sum(c["before_count"] * c["after_median_krw"] for c in cohorts)
                      / matched_before_count) if ready else None
    before_summary = _window_summary(before_start, before_end, before)
    after_summary = _window_summary(after_start, after_end, after)
    raw = _change(before_summary["median_krw"], after_summary["median_krw"])
    matched = _change(weighted_before, weighted_after)
    gap = round(raw - matched, 2) if raw is not None and matched is not None else None
    if not ready:
        explanation = "각 기간에 2건 이상 거래된 같은 동·단지·면적 그룹이 2개 이상 필요합니다. 조건을 넓히거나 조회 기간을 늘려 보세요."
    elif abs(gap) >= 3:
        explanation = "전체 거래와 구성을 고정한 비교가 다른 움직임을 보입니다. 어떤 집이 거래됐는지와 매칭 표본 비중을 함께 살펴보세요."
    else:
        explanation = "이번 표본에서는 두 변화율이 비슷합니다. 이것만으로 거래 구성의 영향이 없다고 단정할 수는 없습니다."
    return {
        "status": "ready" if ready else "insufficient", "label": "선택 지역 거래자료 비교",
        "is_example": False, "before": before_summary, "after": after_summary,
        "raw_change_pct": raw, "matched_change_pct": matched, "mix_gap_pp": gap,
        "matched_before_krw": round(weighted_before) if ready else None,
        "matched_after_krw": round(weighted_after) if ready else None,
        "matched_cohorts": len(keys), "matched_before_count": matched_before_count,
        "matched_after_count": matched_after_count,
        "coverage_pct": {
            "before": round(matched_before_count / len(before) * 100, 1) if before else None,
            "after": round(matched_after_count / len(after) * 100, 1) if after else None,
        },
        "cohorts": cohorts, "explanation": explanation,
        "limitations": list(_MIX_LIMITATIONS), "methodology": _METHODOLOGY,
    }


def _blind(rows: list[dict]) -> dict:
    groups: dict[tuple, list] = defaultdict(list)
    for row in rows:
        if (key := _key(row)) is not None:
            groups[key].append(row)
    candidates = []
    for key, observations in groups.items():
        if len(observations) < 2:
            continue
        _, dong, name, area = key
        candidates.append({
            "id": _id(key), "name": name, "neighborhood": dong,
            "area_m2": round(median([r["area_m2"] for r in observations]), 2),
            "area_min_m2": area, "area_max_m2": area + 5,
            "sale_krw": _median([r["price_krw"] for r in observations]),
            "price_per_m2_krw": _median([r["price_krw"] / r["area_m2"] for r in observations]),
            "sale_count": len(observations),
            "first_date": min(r["contract_date"] for r in observations),
            "last_date": max(r["contract_date"] for r in observations),
        })
    candidates.sort(key=lambda c: (c["sale_krw"], c["area_m2"], c["id"]))
    total = len(candidates)
    if total >= 3:
        chosen = [candidates[0], candidates[total // 2], candidates[-1]]
    else:
        chosen = candidates if total == 2 else []
    # Avoid a permanent A=cheapest ordering; no randomness or stored identity.
    chosen.sort(key=lambda c: c["id"])
    return {
        "status": "ready" if total >= 2 else "insufficient",
        "candidates": chosen, "eligible_cohorts": total,
        "explanation": ("주소와 단지 이름을 가리고 가격·면적·표본 수로 먼저 골라 보세요. 선택 후 이름을 공개하고 선택을 바꾸어 볼 수 있습니다."
                        if total >= 2 else
                        "각각 2건 이상 거래된 동·단지·면적 그룹이 2개 이상 있어야 선택 실험을 열 수 있습니다. 동 또는 면적 조건을 넓혀 보세요."),
        "limitations": [
            "각 카드는 같은 동·단지·5㎡ 구간의 과거 매매 표본 중앙값입니다. 현재 매물이나 특정 한 세대를 뜻하지 않습니다.",
            "후보가 3개 이상이면 가격 중앙값이 낮은·중간·높은 그룹을 하나씩 골랐습니다. 지역 전체를 대표하는 무작위 표본이 아닙니다.",
            "가격과 면적만으로 주거 품질·통근·교육 환경을 판단할 수 없습니다. 선택에는 정답이나 투자 추천이 없습니다.",
            "주소 숨김은 화면상의 선택 실험입니다. 정보의 보안상 익명화가 아니며 선택 결과는 저장하지 않습니다.",
        ],
    }


def build_insights(records: list[dict[str, Any]], area_band: str = "all",
                   neighborhood: str = "", period: dict | None = None) -> dict:
    """Validate input and return mix-comparison and masked-choice experiments.

    ``period`` uses exact ISO start/end dates. Rows outside it are excluded from
    BOTH experiments. If omitted, boundaries are inferred from usable sales.
    Missing prices and canceled contracts are excluded, never zero-filled.
    """
    if not isinstance(area_band, str) or area_band not in _AREA_BANDS:
        raise ValueError("면적 구간은 all, small, medium, large 중 하나여야 합니다.")
    neighborhood = _text(neighborhood, "동 이름", limit=100)
    validated = _validated_records(records)
    for row, source in zip(validated, records):
        row["_region"] = _text(source.get("region_code"), "지역 코드", limit=20)
    sales = [r for r in validated if r["kind"] == "sale" and not r["canceled"]
             and r["price_krw"] is not None and r["price_krw"] > 0
             and _in_area(r["area_m2"], area_band)
             and (not neighborhood or r["neighborhood"] == neighborhood)]
    start, end = _period(period, sales)
    if start is not None:
        sales = [r for r in sales if start.isoformat() <= r["contract_date"] <= end.isoformat()]
    return {"mix": _mix(sales, start, end), "blind": _blind(sales)}


def demo_mix() -> dict:
    """Fictional mix shift: low/high cohort prices stay flat, median doubles."""
    records = []
    for month, counts in ((1, (8, 2)), (2, (2, 8))):
        for index, (price, count) in enumerate(zip((500_000_000, 1_000_000_000), counts)):
            for day in range(1, count + 1):
                records.append({
                    "id": f"mix-example-{month}-{index}-{day}", "region_code": "EXAMPLE",
                    "kind": "sale", "canceled": False,
                    "contract_date": f"2025-{month:02d}-{day:02d}",
                    "apartment": "가상 작은집" if index == 0 else "가상 넓은집",
                    "neighborhood": "연습용 가상동", "area_m2": 59.8 if index == 0 else 84.9,
                    "floor": 5, "price_krw": price,
                    "deposit_krw": None, "monthly_rent_krw": None,
                })
    result = build_insights(records, period={"start": "2025-01-01", "end": "2025-02-28"})["mix"]
    result["is_example"] = True
    result["label"] = "착시 연습용 가상 예제"
    result["explanation"] = "작은집은 5억, 넓은집은 10억으로 그대로인데, 넓은집 거래가 2건에서 8건으로 늘었습니다. 전체 중앙값은 100% 올랐지만 같은 구성으로 비교하면 0%입니다."
    result["limitations"].insert(0, "이 예제의 집·가격·거래·날짜는 설명을 위해 만든 가상 자료이며 선택 지역의 실제 시세와 무관합니다.")
    return result
