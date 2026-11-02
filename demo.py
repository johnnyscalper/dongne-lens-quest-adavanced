"""Reproducible fictional transactions for UI exploration; NEVER market data."""
from __future__ import annotations

import calendar
import hashlib
import random
from datetime import date, datetime, timezone, timedelta

KST = timezone(timedelta(hours=9))


def generate_demo_records(region: dict, months: int = 6, now=None) -> list[dict]:
    """Generate clearly named fictional apartments, up to 12 calendar months.

    Monetary magnitudes are arbitrary illustration values. No observed regional
    price or real apartment identity is used. Dates stop at the current KST day.
    """
    if months not in (3, 6, 12):
        raise ValueError("조회 기간은 3, 6, 12개월 중 선택하세요.")
    if now is None:
        today = datetime.now(KST).date()
    elif isinstance(now, datetime):
        today = now.astimezone(KST).date() if now.tzinfo else now.date()
    elif isinstance(now, date):
        today = now
    else:
        raise ValueError("날짜 형식을 확인하세요.")
    code = str(region["code"])
    seed = int(hashlib.sha256(code.encode()).hexdigest()[:12], 16)
    neighborhoods = region.get("neighborhoods") or ["가상동"]
    result = []
    for offset in range(months - 1, -1, -1):
        absolute_month = today.year * 12 + today.month - 1 - offset
        year, zero_month = divmod(absolute_month, 12)
        month = zero_month + 1
        last_day = today.day if offset == 0 else calendar.monthrange(year, month)[1]
        for n_index, neighborhood in enumerate(neighborhoods):
            for a_index, area in enumerate((59.8, 84.9, 114.6)):
                # The seed uses calendar month, so the same contract appears in
                # overlapping 3/6/12-month views without changing its values.
                rng = random.Random(seed + absolute_month * 101 + n_index * 31 + a_index)
                base = (790_000_000, 1_180_000_000, 1_560_000_000)[a_index]
                variation = (n_index % 4 - 1.5) * .035 + rng.uniform(-.07, .07)
                price = round(base * (1 + variation) / 1_000_000) * 1_000_000
                apartment = f"가상 {neighborhood} {'가든' if a_index == 0 else '리버' if a_index == 1 else '포레'}"
                for kind in ("sale", "jeonse", "monthly"):
                    contract = date(year, month, rng.randint(1, last_day)).isoformat()
                    common = {
                        "id": f"demo-{code}-{year}{month:02d}-{n_index}-{a_index}-{kind}",
                        "region_code": code, "district": region["name"],
                        "neighborhood": neighborhood, "apartment": apartment,
                        "area_m2": area, "floor": rng.randint(2, 23),
                        "contract_date": contract, "kind": kind,
                        "price_krw": price if kind == "sale" else None,
                        "deposit_krw": (round(price * .57 / 1_000_000) * 1_000_000 if kind == "jeonse" else (100_000_000 + a_index * 50_000_000) if kind == "monthly" else None),
                        "monthly_rent_krw": (1_100_000 + a_index * 400_000 + rng.randint(-2, 2) * 50_000) if kind == "monthly" else (0 if kind == "jeonse" else None),
                        "canceled": False,
                    }
                    result.append(common)
    return result
