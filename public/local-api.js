/* Installation-free demo API. No network, credentials, or browser storage. */
(() => {
  'use strict';

  const VERSION = '0.5.0';
  const MAX_RECORDS = 5000;
  const MAX_BODY_BYTES = 3000000;
  const LOCAL_ORIGIN = 'https://dongne-local.invalid';
  const WARNING = '가상으로 만든 예시 데이터입니다. 실제 지역 시세나 거래를 나타내지 않으며 투자 판단에 사용할 수 없습니다.';
  let regionCache;

  function failure(message, status = 400, code = 'INVALID_INPUT') {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
  }

  function checkAbort(signal) {
    if (!signal?.aborted) return;
    const error = new Error('자료 요청을 취소했습니다.');
    error.name = 'AbortError';
    throw error;
  }

  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const textLength = value => Array.from(value).length;
  const normalize = value => value.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase('ko-KR');
  const copy = value => JSON.parse(JSON.stringify(value));

  function regions() {
    if (regionCache) return regionCache;
    const data = globalThis.DONGNE_REGIONS;
    const rows = Array.isArray(data) ? data : data?.regions;
    if (!Array.isArray(rows) || rows.length === 0 || rows.some(row => !object(row) ||
        !/^\d{5}$/.test(row.code) || typeof row.name !== 'string' ||
        !Array.isArray(row.neighborhoods) || row.neighborhoods.some(value => typeof value !== 'string') ||
        (row.aliases !== undefined && (!Array.isArray(row.aliases) || row.aliases.some(value => typeof value !== 'string'))))) {
      throw failure('체험용 지역 목록을 읽지 못했습니다. 완전한 play.html 파일을 다시 열어 주세요.', 500, 'LOCAL_DATA_MISSING');
    }
    regionCache = copy(rows);
    return regionCache;
  }

  function finite(value, label, minimum, maximum, integer = false) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum ||
        (integer && !Number.isInteger(value))) {
      throw failure(`${label} 값을 확인해 주세요.`);
    }
    return value;
  }

  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(0, 0, 0, 0);
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  function validateAnalysis(payload) {
    if (!object(payload)) throw failure('분석 요청은 JSON 객체여야 합니다.');
    const records = payload.records;
    if (!Array.isArray(records) || records.length > MAX_RECORDS) throw failure('거래자료는 최대 5,000건의 목록으로 보내 주세요.');
    const area_band = payload.area_band === undefined ? 'all' : payload.area_band;
    if (!['all', 'small', 'medium', 'large'].includes(area_band)) throw failure('면적 구간을 확인해 주세요.');
    const neighborhood = payload.neighborhood === undefined ? '' : payload.neighborhood;
    if (typeof neighborhood !== 'string' || textLength(neighborhood) > 100) throw failure('동 이름을 확인해 주세요.');
    const assumptions = payload.assumptions === undefined ? {} : payload.assumptions;
    if (!object(assumptions)) throw failure('자금 가정을 확인해 주세요.');
    const limits = {
      budget_krw: [1, 1e13], equity_krw: [0, 1e13], loan_rate_pct: [0, 30],
      loan_years: [1, 50], vacancy_pct: [0, 100], annual_cost_krw: [0, 1e11]
    };
    const cleaned = {};
    for (const key of Object.keys(assumptions)) {
      if (!Object.prototype.hasOwnProperty.call(limits, key)) throw failure('알 수 없는 자금 가정이 포함되어 있습니다.');
      cleaned[key] = finite(assumptions[key], key, ...limits[key]);
    }
    records.forEach((record, index) => {
      if (!object(record)) throw failure(`${index + 1}번째 거래자료 형식을 확인해 주세요.`);
      if (!['sale', 'jeonse', 'monthly'].includes(record.kind)) throw failure(`${index + 1}번째 거래 구분을 확인해 주세요.`);
      finite(record.area_m2, '전용면적', 0.01, 2000);
      for (const key of ['id', 'region_code', 'district', 'neighborhood', 'apartment', 'contract_date']) {
        if (typeof record[key] !== 'string' || textLength(record[key]) > 250) throw failure(`${index + 1}번째 거래자료의 ${key} 값을 확인해 주세요.`);
      }
      if (!validDate(record.contract_date)) throw failure('계약일은 YYYY-MM-DD 형식이어야 합니다.');
      if (record.canceled !== undefined && typeof record.canceled !== 'boolean') throw failure('해제 여부는 true 또는 false여야 합니다.');
      for (const key of ['price_krw', 'deposit_krw', 'monthly_rent_krw']) {
        if (record[key] !== null && record[key] !== undefined) finite(record[key], '거래금액', 0, 1e15, true);
      }
      if (record.kind === 'sale' && !record.price_krw) throw failure('매매가격은 0보다 커야 합니다.');
      if (record.kind === 'jeonse' && !record.deposit_krw) throw failure('전세보증금은 0보다 커야 합니다.');
      if (record.kind === 'monthly' && !record.monthly_rent_krw) throw failure('월세는 0보다 커야 합니다.');
    });
    return { records, options: { area_band, neighborhood, assumptions: cleaned, period: payload.period } };
  }

  function parseBody(options) {
    const headers = options.headers;
    let contentType = '';
    if (headers && typeof headers.get === 'function') contentType = headers.get('Content-Type') || '';
    else if (headers) {
      const entries = Array.isArray(headers) ? headers : Object.entries(headers);
      const match = entries.find(([key]) => String(key).toLowerCase() === 'content-type');
      contentType = match ? String(match[1]) : '';
    }
    if (contentType.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      throw failure('JSON 형식으로 보내 주세요.', 415, 'UNSUPPORTED_MEDIA_TYPE');
    }
    if (typeof options.body !== 'string' || options.body.length === 0) throw failure('올바른 JSON 자료인지 확인해 주세요.');
    if (options.body.length > MAX_BODY_BYTES || new TextEncoder().encode(options.body).byteLength > MAX_BODY_BYTES) {
      throw failure('요청 자료는 3MB 이하여야 합니다.', 413, 'TOO_LARGE');
    }
    try { return JSON.parse(options.body); }
    catch { throw failure('올바른 JSON 자료인지 확인해 주세요.'); }
  }

  function calendarDate(year, month, day) {
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function kstClock() {
    const date = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(),
      fetchedAt: `${date.toISOString().slice(0, 19)}+09:00` };
  }

  // The browser demo uses its own stable PRNG, not Python's random.Random.
  // Seeds use absolute calendar months, preserving overlapping query records.
  function randomFor(value) {
    let seed = 2166136261;
    for (let index = 0; index < value.length; index++) seed = Math.imul(seed ^ value.charCodeAt(index), 16777619) >>> 0;
    return () => {
      seed = (seed + 0x6D2B79F5) >>> 0;
      let result = Math.imul(seed ^ seed >>> 15, 1 | seed);
      result ^= result + Math.imul(result ^ result >>> 7, 61 | result);
      return ((result ^ result >>> 14) >>> 0) / 4294967296;
    };
  }

  function demoMarket(region, months) {
    const now = kstClock();
    const currentMonth = now.year * 12 + now.month - 1;
    const firstMonth = currentMonth - months + 1;
    const records = [];
    const neighborhoods = region.neighborhoods.length ? region.neighborhoods : ['가상동'];
    for (let absoluteMonth = firstMonth; absoluteMonth <= currentMonth; absoluteMonth++) {
      const year = Math.floor(absoluteMonth / 12);
      const month = absoluteMonth % 12 + 1;
      const lastDay = absoluteMonth === currentMonth ? now.day : new Date(Date.UTC(year, month, 0)).getUTCDate();
      neighborhoods.forEach((neighborhood, nIndex) => {
        [59.8, 84.9, 114.6].forEach((area, aIndex) => {
          const random = randomFor(`${region.code}/${absoluteMonth}/${nIndex}/${aIndex}`);
          const integer = (minimum, maximum) => minimum + Math.floor(random() * (maximum - minimum + 1));
          const variation = (nIndex % 4 - 1.5) * 0.035 + (random() * 0.14 - 0.07);
          const price = Math.round([790000000, 1180000000, 1560000000][aIndex] * (1 + variation) / 1000000) * 1000000;
          const apartment = `가상 ${neighborhood} ${['가든', '리버', '포레'][aIndex]}`;
          for (const kind of ['sale', 'jeonse', 'monthly']) {
            records.push({
              id: `demo-${region.code}-${year}${String(month).padStart(2, '0')}-${nIndex}-${aIndex}-${kind}`,
              region_code: region.code, district: region.name, neighborhood, apartment,
              area_m2: area, contract_date: calendarDate(year, month, integer(1, lastDay)), floor: integer(2, 23), kind,
              price_krw: kind === 'sale' ? price : null,
              deposit_krw: kind === 'jeonse' ? Math.round(price * 0.57 / 1000000) * 1000000 : kind === 'monthly' ? 100000000 + aIndex * 50000000 : null,
              monthly_rent_krw: kind === 'monthly' ? 1100000 + aIndex * 400000 + integer(-2, 2) * 50000 : kind === 'jeonse' ? 0 : null,
              canceled: false
            });
          }
        });
      });
    }
    records.sort((left, right) => right.contract_date.localeCompare(left.contract_date));
    return {
      mode: 'demo', region: copy(region), records: records.slice(0, MAX_RECORDS), fetched_at: now.fetchedAt,
      period: { start: calendarDate(Math.floor(firstMonth / 12), firstMonth % 12 + 1, 1), end: calendarDate(now.year, now.month, now.day) },
      coverage: { requested_months: months, successful_months: months, partial: false, warnings: [] },
      source: { label: '동네렌즈 설치 없는 가상 예시 · 현재 월 기준의 체험용 날짜', url: '' }, warnings: [WARNING]
    };
  }

  function engine(name, method) {
    const target = globalThis[name];
    if (!target || typeof target[method] !== 'function') throw failure('체험용 계산 모듈을 읽지 못했습니다. 완전한 play.html 파일을 다시 열어 주세요.', 500, 'LOCAL_ENGINE_MISSING');
    return target;
  }

  async function request(url, options = {}) {
    if (!object(options)) throw failure('요청 형식을 확인해 주세요.');
    checkAbort(options.signal);
    // A microtask boundary gives an immediately cancelled client intent priority.
    await Promise.resolve();
    checkAbort(options.signal);
    if (typeof url !== 'string' || url.length > 2048) throw failure('요청 주소를 확인해 주세요.');
    let parsed;
    try { parsed = new URL(url, LOCAL_ORIGIN); }
    catch { throw failure('요청 주소를 확인해 주세요.'); }
    if (parsed.origin !== LOCAL_ORIGIN || parsed.username || parsed.password) throw failure('설치 없는 체험은 외부 주소를 요청하지 않습니다.', 400, 'LOCAL_ONLY');
    const entries = [...parsed.searchParams.entries()];
    if (entries.length > 12) throw failure('조회 조건이 너무 많습니다.');
    if (new Set(entries.map(([key]) => key)).size !== entries.length) throw failure('중복된 조회 조건이 있습니다.');
    const params = parsed.searchParams;
    const method = String(options.method || 'GET').toUpperCase();
    let result;
    if (method === 'GET') {
      if (parsed.pathname === '/health') result = { status: 'ok', version: VERSION };
      else if (parsed.pathname === '/api/config') result = { live_available: false, app_version: VERSION, source_label: '설치 없는 가상 예시 데이터', local_only: true };
      else if (parsed.pathname === '/api/regions') {
        const query = params.get('q') || '';
        if (textLength(query) > 100) throw failure('검색어를 100자 이내로 입력해 주세요.');
        const normalized = normalize(query);
        result = { regions: copy(regions().filter(region => !normalized || [region.name, region.code, ...(region.aliases || []), ...region.neighborhoods].some(value => normalize(value).includes(normalized)))) };
      } else if (parsed.pathname === '/api/market') {
        const code = params.get('region') ?? '11680';
        const rawMonths = params.get('months') ?? '6';
        const mode = params.get('mode') ?? 'demo';
        if (!/^\d{5}$/.test(code)) throw failure('지역코드를 확인해 주세요.');
        const region = regions().find(item => item.code === code);
        if (!region) throw failure('지원 지역 목록에서 지역을 선택해 주세요.');
        if (!/^[+-]?\d+$/.test(rawMonths.trim())) throw failure('조회 기간을 확인해 주세요.');
        const months = Number(rawMonths);
        if (![3, 6, 12].includes(months)) throw failure('조회 기간은 3개월, 6개월, 12개월 중에서 선택해 주세요.');
        if (!['demo', 'live'].includes(mode)) throw failure('자료 모드는 예시 또는 공식 자료를 선택해 주세요.');
        if (mode === 'live') throw failure('설치 없는 체험에서는 공식 자료를 조회할 수 없습니다. Replit 서버에서 MOLIT_SERVICE_KEY를 설정한 뒤 공식 자료 모드를 이용해 주세요.', 503, 'SERVER_REQUIRED');
        result = demoMarket(region, months);
      } else if (parsed.pathname === '/api/insights/example') result = { mix: engine('DongneInsights', 'example').example() };
      else throw failure('요청한 API를 찾을 수 없습니다.', 404, 'NOT_FOUND');
    } else if (method === 'POST' && ['/api/analyze', '/api/insights'].includes(parsed.pathname)) {
      const data = validateAnalysis(parseBody(options));
      const insights = parsed.pathname === '/api/insights';
      const target = engine(insights ? 'DongneInsights' : 'DongneAnalytics', insights ? 'build' : 'analyze');
      try { result = insights ? target.build(data.records, data.options) : target.analyze(data.records, data.options); }
      catch { throw failure('분석할 거래자료와 입력 가정을 확인해 주세요.'); }
    } else throw failure('요청한 API를 찾을 수 없습니다.', 404, 'NOT_FOUND');
    checkAbort(options.signal);
    return result;
  }

  globalThis.DongneLocal = Object.freeze({ request });
})();
