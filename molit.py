"""Bounded, read-only client for MOLIT apartment transaction APIs.

No key, endpoint URL or upstream exception is ever returned to the browser.
Reported transactions are historical contracts, not current listings.
"""
from __future__ import annotations

import calendar
import concurrent.futures
import datetime as dt
import hashlib
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from decimal import Decimal, InvalidOperation

KST = dt.timezone(dt.timedelta(hours=9))
ENDPOINTS = {
    "sale": "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade",
    "rent": "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent",
}
MAX_XML_BYTES = 4_000_000
PAGE_SIZE = 1000
MAX_PAGES = 5
MAX_RECORDS = 5000
QUERY_DEADLINE_SECONDS = 45


class MolitError(Exception):
    """A safe message that can be displayed without exposing credentials."""

    def __init__(self, message: str, code: str = "UPSTREAM_ERROR"):
        super().__init__(message)
        self.code = code


def today_kst() -> dt.date:
    return dt.datetime.now(KST).date()


def month_window(months: int, today: dt.date | None = None) -> list[str]:
    """Oldest through newest YYYYMM, including the current KST month."""
    today = today or today_kst()
    current = today.year * 12 + today.month - 1
    return [f"{index // 12:04d}{index % 12 + 1:02d}"
            for index in range(current - months + 1, current + 1)]


def period_for(months: int, today: dt.date | None = None) -> dict:
    today = today or today_kst()
    first = month_window(months, today)[0]
    return {"start": f"{first[:4]}-{first[4:]}-01", "end": today.isoformat()}


def _text(item: ET.Element, *names: str) -> str:
    for name in names:
        value = item.findtext(name)
        if value is not None and value.strip():
            return value.strip()
    return ""


def _money(value: str, *, required: bool = True) -> int | None:
    """Official API currency fields are in 10,000 KRW, normalized to KRW."""
    if not value:
        if required:
            raise ValueError("Missing amount")
        return None
    try:
        amount = Decimal(value.replace(",", "").strip()) * 10000
    except InvalidOperation as exc:
        raise ValueError("Invalid amount") from exc
    if not amount.is_finite() or amount < 0 or amount > 10**15 or amount != amount.to_integral_value():
        raise ValueError("Invalid amount")
    return int(amount)


def normalize_item(item: ET.Element, kind: str, region: dict, unique_id: str) -> dict:
    """Normalize a sale/rent API item; malformed mandatory values are rejected."""
    year = int(_text(item, "dealYear", "년"))
    month = int(_text(item, "dealMonth", "월"))
    day = int(_text(item, "dealDay", "일"))
    contract_date = dt.date(year, month, day).isoformat()
    try:
        area = Decimal(_text(item, "excluUseAr", "전용면적"))
    except InvalidOperation as exc:
        raise ValueError("Invalid area") from exc
    if not area.is_finite() or not 0 < area <= 2000:
        raise ValueError("Invalid area")
    apartment = _text(item, "aptNm", "아파트")
    neighborhood = _text(item, "umdNm", "법정동")
    if not apartment or not neighborhood:
        raise ValueError("Missing apartment or neighborhood")
    floor_raw = _text(item, "floor", "층")
    floor = int(floor_raw) if floor_raw else None
    cancellation = _text(item, "cdealType", "해제여부").upper()
    cancellation_day = _text(item, "cdealDay", "해제사유발생일")
    canceled = cancellation in {"Y", "YES", "1", "O", "해제"} or cancellation_day not in {"", "-", "0"}
    price, deposit, rent = None, None, None
    if kind == "sale":
        price = _money(_text(item, "dealAmount", "거래금액"))
        if not price:
            raise ValueError("Sale price must be positive")
        record_kind = "sale"
    elif kind == "rent":
        deposit = _money(_text(item, "deposit", "보증금액"))
        rent = _money(_text(item, "monthlyRent", "월세금액"))
        if deposit == 0 and rent == 0:
            raise ValueError("Rent and deposit cannot both be zero")
        record_kind = "monthly" if rent else "jeonse"
    else:
        raise ValueError("Invalid kind")
    return {
        "id": unique_id, "region_code": region["code"], "district": region["name"],
        "neighborhood": neighborhood[:100], "apartment": apartment[:200],
        "area_m2": float(area), "floor": floor, "contract_date": contract_date,
        "kind": record_kind, "price_krw": price, "deposit_krw": deposit,
        "monthly_rent_krw": rent, "canceled": canceled,
    }


def parse_response(payload: bytes, kind: str, region: dict, month: str, page: int = 1) -> tuple[list[dict], int, int]:
    """Return normalized records, upstream total count, malformed item count."""
    if len(payload) > MAX_XML_BYTES or b"\x00" in payload or re.search(br"<!\s*(DOCTYPE|ENTITY)", payload, re.I):
        raise MolitError("공식 자료 응답 형식을 확인할 수 없습니다.", "INVALID_RESPONSE")
    try:
        root = ET.fromstring(payload)
    except ET.ParseError as exc:
        raise MolitError("공식 자료 응답을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.", "INVALID_RESPONSE") from exc
    code = root.findtext(".//resultCode")
    auth = root.findtext(".//returnAuthMsg")
    if auth or (code is not None and code.strip() not in {"00", "000", "0"}):
        raise MolitError("공식 API가 요청을 거절했습니다. 인증키와 두 API의 활용신청 상태를 확인해 주세요.", "API_REJECTED")
    body = root.find(".//body")
    if body is None or code is None:
        raise MolitError("공식 자료 응답 형식이 예상과 다릅니다.", "INVALID_RESPONSE")
    try:
        total = int(body.findtext("totalCount", "0"))
    except ValueError as exc:
        raise MolitError("공식 자료 건수를 읽지 못했습니다.", "INVALID_RESPONSE") from exc
    if total < 0:
        raise MolitError("공식 자료 건수가 올바르지 않습니다.", "INVALID_RESPONSE")
    records, invalid = [], 0
    for index, item in enumerate(body.findall("./items/item")):
        # Preserve identical transactions: page/row identity, not value-based de-duplication.
        record_id = hashlib.sha256(f"{region['code']}:{kind}:{month}:{page}:{index}".encode()).hexdigest()[:24]
        try:
            record = normalize_item(item, kind, region, record_id)
            if record["contract_date"][:7].replace("-", "") != month:
                raise ValueError("Unexpected contract month")
            records.append(record)
        except (ValueError, TypeError, OverflowError):
            invalid += 1
    return records, total, invalid


def _fetch_month(region: dict, month: str, kind: str, key: str, deadline: float) -> dict:
    records, invalid, truncated = [], 0, False
    for page in range(1, MAX_PAGES + 1):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise MolitError("공식 자료 조회 시간이 초과되었습니다.", "UPSTREAM_TIMEOUT")
        # data.go.kr can provide an already URL-encoded key. Encode exactly once.
        params = urllib.parse.urlencode({"serviceKey": urllib.parse.unquote(key),
            "LAWD_CD": region["code"], "DEAL_YMD": month,
            "pageNo": page, "numOfRows": PAGE_SIZE})
        request = urllib.request.Request(ENDPOINTS[kind] + "?" + params,
            headers={"Accept": "application/xml", "User-Agent": "DongneLensQuest/0.2"})
        try:
            with urllib.request.urlopen(request, timeout=min(8, remaining)) as response:
                payload = response.read(MAX_XML_BYTES + 1)
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise MolitError("공식 자료 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.", "UPSTREAM_UNAVAILABLE") from exc
        batch, total, skipped = parse_response(payload, kind, region, month, page)
        records.extend(batch)
        invalid += skipped
        if total > (page - 1) * PAGE_SIZE and not batch and not skipped:
            raise MolitError("공식 자료 페이지가 비어 있어 전체 건수를 확인하지 못했습니다.", "INCOMPLETE_RESPONSE")
        if total <= page * PAGE_SIZE:
            break
        if page == MAX_PAGES:
            truncated = True
    return {"records": records, "invalid": invalid, "truncated": truncated}


def fetch_market(region: dict, months: int, *, today: dt.date | None = None,
                 service_key: str | None = None) -> dict:
    key = (service_key if service_key is not None else os.environ.get("MOLIT_SERVICE_KEY", "")).strip()
    if not key:
        raise MolitError("공식 자료를 보려면 서버의 MOLIT_SERVICE_KEY를 설정해 주세요. 예시 모드는 별도로 선택할 수 있습니다.", "KEY_REQUIRED")
    today = today or today_kst()
    requested = month_window(months, today)
    deadline = time.monotonic() + QUERY_DEADLINE_SECONDS
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=4)
    futures = {executor.submit(_fetch_month, region, month, kind, key, deadline): (month, kind)
               for month in requested for kind in ("sale", "rent")}
    successful, all_records, warnings, failed = set(), [], [], 0
    malformed, truncated = 0, False
    try:
        for future in concurrent.futures.as_completed(futures, timeout=QUERY_DEADLINE_SECONDS + 1):
            month, kind = futures[future]
            try:
                result = future.result()
                successful.add((month, kind))
                all_records.extend(result["records"])
                malformed += result["invalid"]
                truncated = truncated or result["truncated"]
            except MolitError:
                failed += 1
            except Exception:
                # Never expose raw upstream URLs or response bodies to clients.
                failed += 1
    except concurrent.futures.TimeoutError:
        failed += sum(not f.done() for f in futures)
    finally:
        executor.shutdown(wait=False, cancel_futures=True)
    if not successful:
        raise MolitError("공식 자료를 가져오지 못했습니다. 인증키·매매 및 전월세 API 활용신청·네트워크 상태를 확인해 주세요.", "UPSTREAM_UNAVAILABLE")
    failed = len(futures) - len(successful)
    if failed:
        warnings.append(f"{len(requested) * 2}개 월별 매매·임대 조회 중 {len(successful)}개만 완료되었습니다. 일부 자료가 빠져 있습니다.")
    if malformed:
        warnings.append(f"필수 값이 불완전한 거래 {malformed}건은 집계에서 제외했습니다.")
    if truncated:
        warnings.append("조회량 제한으로 일부 거래를 가져오지 못했습니다. 조회 기간을 줄여 주세요.")
    all_records.sort(key=lambda record: (record["contract_date"], record["id"]), reverse=True)
    if len(all_records) > MAX_RECORDS:
        all_records = all_records[:MAX_RECORDS]
        truncated = True
        warnings.append("최대 5,000건까지만 표시합니다. 조회 기간을 줄이면 누락을 줄일 수 있습니다.")
    # Never include a future-dated contract in an as-of-today view.
    all_records = [r for r in all_records if r["contract_date"] <= today.isoformat()]
    complete_months = sum((month, "sale") in successful and (month, "rent") in successful for month in requested)
    return {
        "mode": "live", "region": region, "records": all_records,
        "fetched_at": dt.datetime.now(KST).isoformat(timespec="seconds"),
        "period": period_for(months, today),
        "coverage": {"requested_months": months, "successful_months": complete_months,
            "requested_queries": months * 2, "successful_queries": len(successful),
            "partial": bool(failed or malformed or truncated), "warnings": warnings},
        "source": {"label": "국토교통부 아파트 매매·전월세 신고 거래자료",
            "url": "https://www.data.go.kr/data/15126469/openapi.do",
            "rent_url": "https://www.data.go.kr/data/15126474/openapi.do"},
        "warnings": warnings + ["신고·정정·해제 반영에 따라 과거 자료도 달라집니다. 현재 매물 호가나 감정가격이 아닙니다."],
    }
