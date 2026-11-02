"""동네렌즈: a dependency-free, same-origin Python web application."""
from __future__ import annotations

import argparse
import calendar
import collections
import copy
import datetime as dt
import http.server
import json
import math
import mimetypes
import os
from pathlib import Path
import re
import threading
import time
import unicodedata
import urllib.parse

import molit

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
DATA = ROOT / "data"
APP_VERSION = "0.5.0"
MAX_BODY_BYTES = 3_000_000
MAX_RECORDS = 5000
CACHE_TTL_SECONDS = 900
MAX_CACHE_ENTRIES = 24
_cache: collections.OrderedDict = collections.OrderedDict()
_cache_lock = threading.Lock()
_live_slots = threading.BoundedSemaphore(2)
_rate_lock = threading.Lock()
_rate: dict[str, collections.deque] = {}


class RequestError(Exception):
    def __init__(self, message: str, status: int = 400, code: str = "INVALID_INPUT"):
        super().__init__(message)
        self.status, self.code = status, code


def read_regions() -> list[dict]:
    raw = json.loads((DATA / "regions.json").read_text(encoding="utf-8"))
    return raw["regions"] if isinstance(raw, dict) else raw


def _normalize(text: str) -> str:
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", text).casefold())


def search_regions(query: str) -> list[dict]:
    normalized = _normalize(query)
    regions = read_regions()
    if not normalized:
        return regions
    return [region for region in regions
            if any(normalized in _normalize(value) for value in [region["name"], region["code"],
                *region.get("aliases", []), *region.get("neighborhoods", [])])]


def demo_market(region: dict, months: int, today: dt.date | None = None) -> dict:
    """Generate explicitly fictional records; never substitute them for live data."""
    today = today or molit.today_kst()
    from demo import generate_demo_records
    period = molit.period_for(months, today)
    records = generate_demo_records(region, months, today)
    records.sort(key=lambda record: record["contract_date"], reverse=True)
    warnings = ["가상으로 만든 예시 데이터입니다. 실제 지역 시세나 거래를 나타내지 않으며 투자 판단에 사용할 수 없습니다."]
    if not records:
        warnings.append("이 지역의 가상 예시가 아직 없습니다. 다른 지역을 선택하거나 공식 자료를 연결해 주세요.")
    return {"mode": "demo", "region": region, "records": records[:MAX_RECORDS],
        "fetched_at": dt.datetime.now(molit.KST).isoformat(timespec="seconds"),
        "period": period,
        "coverage": {"requested_months": months, "successful_months": months,
            "partial": False, "warnings": []},
        "source": {"label": "동네렌즈 가상 예시 · 현재 월 기준의 체험용 날짜", "url": ""},
        "warnings": warnings}


def get_market(region_code: str, months: int, mode: str) -> dict:
    region = next((region for region in read_regions() if region["code"] == region_code), None)
    if region is None:
        raise RequestError("지원 지역 목록에서 지역을 선택해 주세요.")
    if months not in {3, 6, 12}:
        raise RequestError("조회 기간은 3개월, 6개월, 12개월 중에서 선택해 주세요.")
    if mode not in {"demo", "live"}:
        raise RequestError("자료 모드는 예시 또는 공식 자료를 선택해 주세요.")
    if mode == "demo":
        return demo_market(region, months)
    if not os.environ.get("MOLIT_SERVICE_KEY", "").strip():
        raise RequestError("공식 자료 연결에는 MOLIT_SERVICE_KEY 설정이 필요합니다. 예시 모드를 선택해 먼저 체험할 수 있습니다.", 503, "KEY_REQUIRED")
    today = molit.today_kst()
    cache_key = (region_code, months, today.isoformat())
    now = time.monotonic()
    with _cache_lock:
        cached = _cache.get(cache_key)
        if cached and now - cached[0] < CACHE_TTL_SECONDS:
            _cache.move_to_end(cache_key)
            return copy.deepcopy(cached[1])
    if not _live_slots.acquire(blocking=False):
        raise RequestError("공식 자료 조회가 진행 중입니다. 잠시 후 다시 시도해 주세요.", 429, "BUSY")
    try:
        result = molit.fetch_market(region, months, today=today)
        # Partial results may improve on retry, so do not cache them.
        if not result["coverage"]["partial"]:
            with _cache_lock:
                _cache[cache_key] = (time.monotonic(), result)
                _cache.move_to_end(cache_key)
                while len(_cache) > MAX_CACHE_ENTRIES:
                    _cache.popitem(last=False)
        return copy.deepcopy(result)
    except molit.MolitError as exc:
        raise RequestError(str(exc), 502, exc.code) from exc
    finally:
        _live_slots.release()


def _finite_number(value, label: str, minimum: float, maximum: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not minimum <= value <= maximum or not math.isfinite(value):
        raise RequestError(f"{label} 값을 확인해 주세요.")
    return value


def validate_analysis(payload: dict) -> tuple:
    if not isinstance(payload, dict):
        raise RequestError("분석 요청은 JSON 객체여야 합니다.")
    records = payload.get("records")
    if not isinstance(records, list) or len(records) > MAX_RECORDS:
        raise RequestError("거래자료는 최대 5,000건의 목록으로 보내 주세요.")
    band = payload.get("area_band", "all")
    if not isinstance(band, str) or band not in {"all", "small", "medium", "large"}:
        raise RequestError("면적 구간을 확인해 주세요.")
    neighborhood = payload.get("neighborhood", "")
    if not isinstance(neighborhood, str) or len(neighborhood) > 100:
        raise RequestError("동 이름을 확인해 주세요.")
    assumptions = payload.get("assumptions", {})
    if not isinstance(assumptions, dict):
        raise RequestError("자금 가정을 확인해 주세요.")
    limits = {"budget_krw": (1, 10**13), "equity_krw": (0, 10**13),
        "loan_rate_pct": (0, 30), "loan_years": (1, 50), "vacancy_pct": (0, 100),
        "annual_cost_krw": (0, 10**11)}
    cleaned_assumptions = {}
    for key, value in assumptions.items():
        if key not in limits:
            raise RequestError("알 수 없는 자금 가정이 포함되어 있습니다.")
        cleaned_assumptions[key] = _finite_number(value, key, *limits[key])
    for index, record in enumerate(records):
        if not isinstance(record, dict):
            raise RequestError(f"{index + 1}번째 거래자료 형식을 확인해 주세요.")
        if not isinstance(record.get("kind"), str) or record["kind"] not in {"sale", "jeonse", "monthly"}:
            raise RequestError(f"{index + 1}번째 거래 구분을 확인해 주세요.")
        _finite_number(record.get("area_m2"), "전용면적", 0.01, 2000)
        for key in ("id", "region_code", "district", "neighborhood", "apartment", "contract_date"):
            if not isinstance(record.get(key), str) or len(record[key]) > 250:
                raise RequestError(f"{index + 1}번째 거래자료의 {key} 값을 확인해 주세요.")
        try:
            date = dt.date.fromisoformat(record["contract_date"])
            if date.isoformat() != record["contract_date"]:
                raise ValueError
        except ValueError as exc:
            raise RequestError("계약일은 YYYY-MM-DD 형식이어야 합니다.") from exc
        if type(record.get("canceled", False)) is not bool:
            raise RequestError("해제 여부는 true 또는 false여야 합니다.")
        for key in ("price_krw", "deposit_krw", "monthly_rent_krw"):
            value = record.get(key)
            if value is not None:
                _finite_number(value, "거래금액", 0, 10**15)
                if int(value) != value:
                    raise RequestError("금액은 원 단위 정수여야 합니다.")
        if record["kind"] == "sale" and not record.get("price_krw"):
            raise RequestError("매매가격은 0보다 커야 합니다.")
        if record["kind"] == "jeonse" and not record.get("deposit_krw"):
            raise RequestError("전세보증금은 0보다 커야 합니다.")
        if record["kind"] == "monthly" and not record.get("monthly_rent_krw"):
            raise RequestError("월세는 0보다 커야 합니다.")
    return records, band, neighborhood, cleaned_assumptions


class AppHandler(http.server.BaseHTTPRequestHandler):
    server_version = "NeighborhoodLens"

    def log_message(self, format, *args):
        # Do not log query strings, uploaded records, budgets or upstream keys.
        return

    def _headers(self, status: int, content_type: str, length: int, *, api: bool = True):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store" if api else "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.end_headers()

    def _json(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
        self._headers(status, "application/json; charset=utf-8", len(body))
        if self.command != "HEAD":
            self.wfile.write(body)

    def _error(self, exc: RequestError):
        self._json(exc.status, {"error": {"code": exc.code, "message": str(exc)}})

    def _check_live_rate(self):
        ip, now = self.client_address[0], time.monotonic()
        with _rate_lock:
            if len(_rate) > 2048:
                for key in list(_rate):
                    if not _rate[key] or now - _rate[key][-1] > 60:
                        _rate.pop(key, None)
                if len(_rate) > 2048:
                    _rate.clear()
            timestamps = _rate.setdefault(ip, collections.deque())
            while timestamps and now - timestamps[0] > 60:
                timestamps.popleft()
            if len(timestamps) >= 12:
                raise RequestError("공식 자료 요청이 많습니다. 1분 후 다시 시도해 주세요.", 429, "RATE_LIMITED")
            timestamps.append(now)

    def do_GET(self):
        try:
            parsed = urllib.parse.urlsplit(self.path)
            if len(self.path) > 2048:
                raise RequestError("요청 주소가 너무 깁니다.", 414)
            params = urllib.parse.parse_qs(parsed.query, keep_blank_values=True, max_num_fields=12)
            if any(len(values) != 1 for values in params.values()):
                raise RequestError("중복된 조회 조건이 있습니다.")
            if parsed.path == "/health":
                return self._json(200, {"status": "ok", "version": APP_VERSION})
            if parsed.path == "/api/insights/example":
                from insights import demo_mix
                return self._json(200, {"mix": demo_mix()})
            if parsed.path == "/api/config":
                available = bool(os.environ.get("MOLIT_SERVICE_KEY", "").strip())
                return self._json(200, {"live_available": available, "app_version": APP_VERSION,
                    "source_label": "국토교통부 신고 거래자료" if available else "가상 예시 데이터"})
            if parsed.path == "/api/regions":
                query = params.get("q", [""])[0]
                if len(query) > 100:
                    raise RequestError("검색어를 100자 이내로 입력해 주세요.")
                return self._json(200, {"regions": search_regions(query)})
            if parsed.path == "/api/market":
                code = params.get("region", ["11680"])[0]
                if not re.fullmatch(r"\d{5}", code):
                    raise RequestError("지역코드를 확인해 주세요.")
                try:
                    months = int(params.get("months", ["6"])[0])
                except ValueError as exc:
                    raise RequestError("조회 기간을 확인해 주세요.") from exc
                mode = params.get("mode", ["demo"])[0]
                if mode == "live":
                    self._check_live_rate()
                return self._json(200, get_market(code, months, mode))
            if parsed.path.startswith("/api/"):
                raise RequestError("요청한 API를 찾을 수 없습니다.", 404, "NOT_FOUND")
            self._serve_static(parsed.path)
        except RequestError as exc:
            self._error(exc)
        except (ValueError, UnicodeError):
            self._error(RequestError("요청 형식을 확인해 주세요."))
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self._error(RequestError("요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.", 500, "INTERNAL_ERROR"))

    def do_HEAD(self):
        self.do_GET()

    def _serve_static(self, path: str):
        decoded = urllib.parse.unquote(path)
        if "\x00" in decoded or "\\" in decoded or any(part.startswith(".") for part in decoded.split("/") if part):
            raise RequestError("요청한 파일을 찾을 수 없습니다.", 404, "NOT_FOUND")
        relative = "index.html" if decoded in {"", "/"} else decoded.lstrip("/")
        target = (PUBLIC / relative).resolve()
        if not target.is_relative_to(PUBLIC.resolve()) or not target.is_file():
            raise RequestError("요청한 파일을 찾을 수 없습니다.", 404, "NOT_FOUND")
        if target.suffix not in {".html", ".css", ".js", ".svg", ".png", ".ico", ".webp", ".woff2"}:
            raise RequestError("요청한 파일을 찾을 수 없습니다.", 404, "NOT_FOUND")
        body = target.read_bytes()
        mime = {".js": "text/javascript", ".css": "text/css", ".html": "text/html"}.get(target.suffix)
        mime = mime or mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if target.suffix in {".js", ".css", ".html", ".svg"}:
            mime += "; charset=utf-8"
        self._headers(200, mime, len(body), api=False)
        if self.command != "HEAD":
            self.wfile.write(body)

    def do_POST(self):
        try:
            path = urllib.parse.urlsplit(self.path).path
            if path not in {"/api/analyze", "/api/insights"}:
                raise RequestError("요청한 API를 찾을 수 없습니다.", 404, "NOT_FOUND")
            if self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
                raise RequestError("JSON 형식으로 보내 주세요.", 415, "UNSUPPORTED_MEDIA_TYPE")
            if self.headers.get("Transfer-Encoding") is not None:
                raise RequestError("요청 크기를 지정해 주세요.", 411)
            lengths = self.headers.get_all("Content-Length", [])
            if len(lengths) != 1 or not re.fullmatch(r"[0-9]+", lengths[0]):
                raise RequestError("요청 크기를 확인해 주세요.", 411)
            # Compare bounded ASCII digits before int(): huge or Unicode digit
            # headers must be client errors, not Python conversion failures.
            digits = lengths[0].lstrip("0") or "0"
            if len(digits) > len(str(MAX_BODY_BYTES)):
                raise RequestError("요청 자료는 3MB 이하여야 합니다.", 413, "TOO_LARGE")
            length = int(digits)
            if not 0 < length <= MAX_BODY_BYTES:
                raise RequestError("요청 자료는 3MB 이하여야 합니다.", 413, "TOO_LARGE")
            self.connection.settimeout(10)
            body = self.rfile.read(length)
            if len(body) != length:
                raise RequestError("자료 전송이 완료되지 않았습니다.")
            try:
                payload = json.loads(body.decode("utf-8"), parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Non-finite number")))
            except (ValueError, UnicodeError, RecursionError) as exc:
                raise RequestError("올바른 JSON 자료인지 확인해 주세요.") from exc
            records, band, neighborhood, assumptions = validate_analysis(payload)
            import analytics
            try:
                if path == "/api/insights":
                    from insights import build_insights
                    result = build_insights(records, area_band=band, neighborhood=neighborhood, period=payload.get("period"))
                else:
                    result = analytics.analyze(records, area_band=band, neighborhood=neighborhood, assumptions=assumptions)
            except (ValueError, TypeError, KeyError) as exc:
                raise RequestError("분석할 거래자료와 입력 가정을 확인해 주세요.") from exc
            self._json(200, result)
        except RequestError as exc:
            self._error(exc)
        except (ValueError, UnicodeError):
            self._error(RequestError("요청 형식을 확인해 주세요."))
        except (BrokenPipeError, ConnectionResetError):
            pass
        except TimeoutError:
            self._error(RequestError("자료 전송 시간이 초과되었습니다.", 408, "TIMEOUT"))
        except Exception:
            self._error(RequestError("분석을 완료하지 못했습니다. 입력 자료를 확인해 주세요.", 500, "INTERNAL_ERROR"))


def main():
    parser = argparse.ArgumentParser(description="동네렌즈 지역 분석 앱")
    parser.add_argument("--host", default="0.0.0.0")
    # argparse converts a string default only when --port was not supplied.
    # This lets an explicit port override a stale or invalid environment value.
    parser.add_argument("--port", type=int, default=os.environ.get("PORT") or "3000")
    # Preview infrastructure supplies Vite-compatible flags; binding is already strict.
    parser.add_argument("--strictPort", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("port must be between 1 and 65535")
    server = http.server.ThreadingHTTPServer((args.host, args.port), AppHandler)
    server.daemon_threads = True
    print(f"동네렌즈 실행: http://{args.host}:{args.port} (API 키 {'설정됨' if os.environ.get('MOLIT_SERVICE_KEY', '').strip() else '없음 · 예시 모드'})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
