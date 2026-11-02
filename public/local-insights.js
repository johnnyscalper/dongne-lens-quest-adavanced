/* Deterministic local equivalents of insights.py. No network, storage, or DOM. */
(() => {
  'use strict';

  const AREA_BANDS = new Set(['all', 'small', 'medium', 'large']);
  const UNKNOWN_NAMES = new Set(['', '단지명 미상', '미상']);
  const MIX_LIMITATIONS = [
    '같은 동·단지·5㎡ 면적 구간을 비교합니다. 같은 세대의 반복 거래는 아닙니다.',
    '층·향·수리 상태·동 위치·정확한 면적 차이와 거래 시점은 보정하지 않았습니다.',
    '두 변화율의 차이는 거래 구성과 표본 선택의 영향을 살펴보는 단서이며, 구성 효과의 인과 추정치가 아닙니다.',
    '조회 마지막 달은 진행 중일 수 있고, 전후 기간의 길이와 표본 수가 다를 수 있습니다. 신고 지연·정정·해제도 반영 시점에 따라 달라집니다.'
  ];
  const METHODOLOGY = '조회 기간을 달 단위로 앞·뒤 두 구간으로 나눕니다. 홀수 개월이면 뒤 구간이 한 달 더 깁니다. ' +
    '전체 변화율=(뒤 구간 매매 중앙값/앞 구간 매매 중앙값−1)×100. ' +
    '동·단지·5㎡ 구간(하한 포함, 상한 제외)이 같고 각 구간에 2건 이상 있는 그룹만 매칭합니다. ' +
    '매칭 그룹이 2개 이상일 때 앞 구간 거래 건수를 고정 가중치로 사용해 ' +
    '동일 구성 변화율=(Σ(앞 건수×뒤 그룹 중앙값)/Σ(앞 건수×앞 그룹 중앙값)−1)×100을 계산합니다. ' +
    '두 지표는 모집단과 집계 방식이 다르므로 차이를 가격 착시의 확정적 크기로 해석하지 않습니다.';

  function helpers() {
    const value = globalThis.DongneAnalytics?.helpers;
    if (!value) throw new Error('로컬 분석 모듈을 먼저 불러와 주세요.');
    return value;
  }

  // Python sorts strings by Unicode code points, rather than locale or UTF-16.
  function compareText(left, right) {
    const a = Array.from(left), b = Array.from(right);
    for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
      const difference = a[i].codePointAt(0) - b[i].codePointAt(0);
      if (difference) return difference;
    }
    return a.length - b.length;
  }

  function compareKey(left, right) {
    for (let i = 0; i < 3; i += 1) {
      const difference = compareText(left[i], right[i]);
      if (difference) return difference;
    }
    return left[3] - right[3];
  }

  // Matching Python repr(tuple) preserves cohort IDs across both runtimes.
  function reprString(value) {
    const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
    let result = quote;
    for (const character of value) {
      const code = character.codePointAt(0);
      if (character === '\\' || character === quote) result += '\\' + character;
      else if (character === '\t') result += '\\t';
      else if (character === '\n') result += '\\n';
      else if (character === '\r') result += '\\r';
      else if (character !== ' ' && /[\p{C}\p{Z}]/u.test(character)) {
        result += code < 256 ? '\\x' + code.toString(16).padStart(2, '0') :
          code <= 65535 ? '\\u' + code.toString(16).padStart(4, '0') :
            '\\U' + code.toString(16).padStart(8, '0');
      } else result += character;
    }
    return result + quote;
  }

  // SHA-256 is used only for stable display IDs, not for a security decision.
  const HASH_CONSTANTS = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  const rotate = (value, count) => (value >>> count) | (value << (32 - count));

  function hashId(value) {
    const bytes = [];
    for (const character of value) {
      const code = character.codePointAt(0);
      if (code < 0x80) bytes.push(code);
      else if (code < 0x800) bytes.push(0xc0 | (code >>> 6), 0x80 | (code & 63));
      else if (code < 0x10000) bytes.push(0xe0 | (code >>> 12), 0x80 | ((code >>> 6) & 63), 0x80 | (code & 63));
      else bytes.push(0xf0 | (code >>> 18), 0x80 | ((code >>> 12) & 63), 0x80 | ((code >>> 6) & 63), 0x80 | (code & 63));
    }
    const length = bytes.length;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    const highLength = Math.floor(length / 0x20000000), lowLength = (length * 8) >>> 0;
    for (let shift = 24; shift >= 0; shift -= 8) bytes.push((highLength >>> shift) & 255);
    for (let shift = 24; shift >= 0; shift -= 8) bytes.push((lowLength >>> shift) & 255);
    const state = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const words = new Int32Array(64);
    for (let offset = 0; offset < bytes.length; offset += 64) {
      for (let i = 0; i < 16; i += 1) {
        const at = offset + i * 4;
        words[i] = (bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3];
      }
      for (let i = 16; i < 64; i += 1) {
        const a = words[i - 15], b = words[i - 2];
        words[i] = (words[i - 16] + (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) + words[i - 7] +
          (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10))) | 0;
      }
      let [a, b, c, d, e, f, g, h] = state;
      for (let i = 0; i < 64; i += 1) {
        const first = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + HASH_CONSTANTS[i] + words[i]) | 0;
        const second = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + first) | 0; d = c; c = b; b = a; a = (first + second) | 0;
      }
      [a, b, c, d, e, f, g, h].forEach((word, i) => { state[i] = (state[i] + word) | 0; });
    }
    return state.map(word => (word >>> 0).toString(16).padStart(8, '0')).join('').slice(0, 16);
  }

  function cohortKey(row) {
    if (UNKNOWN_NAMES.has(row.apartment) || !row.neighborhood) return null;
    return [row._region, row.neighborhood, row.apartment, Math.floor(row.area_m2 / 5) * 5];
  }

  function groupRows(rows) {
    const groups = new Map();
    for (const row of rows) {
      const key = cohortKey(row);
      if (!key) continue;
      const serialized = JSON.stringify(key);
      if (!groups.has(serialized)) groups.set(serialized, {key, rows: []});
      groups.get(serialized).rows.push(row);
    }
    return groups;
  }

  function parseDate(value, label) {
    if (typeof value !== 'string') throw new Error(`${label}: YYYY-MM-DD 형식의 날짜가 필요합니다.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label}: 올바른 날짜를 입력해 주세요.`);
    const parsed = new Date(value + 'T00:00:00Z');
    if (value.startsWith('0000') || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      throw new Error(`${label}: 올바른 날짜를 입력해 주세요.`);
    }
    return value;
  }

  function periodBounds(period, rows) {
    if (period == null) {
      const dates = rows.map(row => row.contract_date).sort();
      return dates.length ? [dates[0], dates[dates.length - 1]] : [null, null];
    }
    if (typeof period !== 'object' || Array.isArray(period) || Object.keys(period).sort().join(',') !== 'end,start') {
      throw new Error('조회 기간은 start와 end 날짜가 있는 객체여야 합니다.');
    }
    const start = parseDate(period.start, '시작일'), end = parseDate(period.end, '종료일');
    if (start > end) throw new Error('조회 시작일은 종료일보다 늦을 수 없습니다.');
    return [start, end];
  }

  function windows(start, end) {
    if (start === null || end === null) return [null, null, null, null];
    const [startYear, startMonth] = start.split('-').map(Number);
    const [endYear, endMonth] = end.split('-').map(Number);
    const beforeMonths = Math.floor(((endYear - startYear) * 12 + endMonth - startMonth + 1) / 2);
    if (!beforeMonths) return [null, null, start, end];
    const month = startYear * 12 + startMonth - 1 + beforeMonths;
    const split = `${String(Math.floor(month / 12)).padStart(4, '0')}-${String(month % 12 + 1).padStart(2, '0')}-01`;
    const beforeEnd = new Date(new Date(split + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
    return [start, beforeEnd, split, end];
  }

  function mix(rows, start, end, idFor, helper) {
    const {median, medianWon, pyRound} = helper;
    const change = (before, after) => before && after !== null ? pyRound((after / before - 1) * 100, 2) : null;
    const [beforeStart, beforeEnd, afterStart, afterEnd] = windows(start, end);
    const before = rows.filter(row => beforeStart && row.contract_date >= beforeStart && row.contract_date <= beforeEnd);
    const after = rows.filter(row => afterStart && row.contract_date >= afterStart && row.contract_date <= afterEnd);
    const groupedBefore = groupRows(before), groupedAfter = groupRows(after);
    const keys = [...groupedBefore.keys()].filter(key => groupedBefore.get(key).rows.length >= 2 && (groupedAfter.get(key)?.rows.length || 0) >= 2)
      .sort((a, b) => compareKey(groupedBefore.get(a).key, groupedBefore.get(b).key));
    const matchedBeforeCount = keys.reduce((sum, key) => sum + groupedBefore.get(key).rows.length, 0);
    const matchedAfterCount = keys.reduce((sum, key) => sum + groupedAfter.get(key).rows.length, 0);
    const cohorts = keys.map(serialized => {
      const oldGroup = groupedBefore.get(serialized), newGroup = groupedAfter.get(serialized);
      const [, dong, name, area] = oldGroup.key;
      const oldMedian = median(oldGroup.rows.map(row => row.price_krw));
      const newMedian = median(newGroup.rows.map(row => row.price_krw));
      return {id: idFor(oldGroup.key), name, neighborhood: dong, area_min_m2: area, area_max_m2: area + 5,
        before_count: oldGroup.rows.length, after_count: newGroup.rows.length,
        before_median_krw: oldMedian, after_median_krw: newMedian,
        change_pct: change(oldMedian, newMedian), weight_pct: pyRound(oldGroup.rows.length / matchedBeforeCount * 100, 4)};
    });
    const ready = keys.length >= 2;
    const weightedBefore = ready ? cohorts.reduce((sum, item) => sum + item.before_count * item.before_median_krw, 0) / matchedBeforeCount : null;
    const weightedAfter = ready ? cohorts.reduce((sum, item) => sum + item.before_count * item.after_median_krw, 0) / matchedBeforeCount : null;
    const summary = (first, last, observations) => ({start: first, end: last, count: observations.length, median_krw: medianWon(observations.map(row => row.price_krw))});
    const beforeSummary = summary(beforeStart, beforeEnd, before), afterSummary = summary(afterStart, afterEnd, after);
    const raw = change(beforeSummary.median_krw, afterSummary.median_krw), matched = change(weightedBefore, weightedAfter);
    const gap = raw !== null && matched !== null ? pyRound(raw - matched, 2) : null;
    const explanation = !ready ? '각 기간에 2건 이상 거래된 같은 동·단지·면적 그룹이 2개 이상 필요합니다. 조건을 넓히거나 조회 기간을 늘려 보세요.' :
      Math.abs(gap) >= 3 ? '전체 거래와 구성을 고정한 비교가 다른 움직임을 보입니다. 어떤 집이 거래됐는지와 매칭 표본 비중을 함께 살펴보세요.' :
        '이번 표본에서는 두 변화율이 비슷합니다. 이것만으로 거래 구성의 영향이 없다고 단정할 수는 없습니다.';
    return {status: ready ? 'ready' : 'insufficient', label: '선택 지역 거래자료 비교', is_example: false,
      before: beforeSummary, after: afterSummary, raw_change_pct: raw, matched_change_pct: matched, mix_gap_pp: gap,
      matched_before_krw: ready ? pyRound(weightedBefore) : null, matched_after_krw: ready ? pyRound(weightedAfter) : null,
      matched_cohorts: keys.length, matched_before_count: matchedBeforeCount, matched_after_count: matchedAfterCount,
      coverage_pct: {before: before.length ? pyRound(matchedBeforeCount / before.length * 100, 1) : null,
        after: after.length ? pyRound(matchedAfterCount / after.length * 100, 1) : null},
      cohorts, explanation, limitations: [...MIX_LIMITATIONS], methodology: METHODOLOGY};
  }

  function blind(rows, idFor, helper) {
    const {median, medianWon, pyRound} = helper;
    const candidates = [];
    for (const {key, rows: observations} of groupRows(rows).values()) {
      if (observations.length < 2) continue;
      const [, dong, name, area] = key;
      const dates = observations.map(row => row.contract_date).sort();
      candidates.push({id: idFor(key), name, neighborhood: dong, area_m2: pyRound(median(observations.map(row => row.area_m2)), 2),
        area_min_m2: area, area_max_m2: area + 5, sale_krw: medianWon(observations.map(row => row.price_krw)),
        price_per_m2_krw: medianWon(observations.map(row => row.price_krw / row.area_m2)),
        sale_count: observations.length, first_date: dates[0], last_date: dates[dates.length - 1]});
    }
    candidates.sort((a, b) => a.sale_krw - b.sale_krw || a.area_m2 - b.area_m2 || compareText(a.id, b.id));
    const total = candidates.length;
    const chosen = total >= 3 ? [candidates[0], candidates[Math.floor(total / 2)], candidates[total - 1]] : total === 2 ? candidates : [];
    chosen.sort((a, b) => compareText(a.id, b.id));
    return {status: total >= 2 ? 'ready' : 'insufficient', candidates: chosen, eligible_cohorts: total,
      explanation: total >= 2 ? '주소와 단지 이름을 가리고 가격·면적·표본 수로 먼저 골라 보세요. 선택 후 이름을 공개하고 선택을 바꾸어 볼 수 있습니다.' :
        '각각 2건 이상 거래된 동·단지·면적 그룹이 2개 이상 있어야 선택 실험을 열 수 있습니다. 동 또는 면적 조건을 넓혀 보세요.',
      limitations: [
        '각 카드는 같은 동·단지·5㎡ 구간의 과거 매매 표본 중앙값입니다. 현재 매물이나 특정 한 세대를 뜻하지 않습니다.',
        '후보가 3개 이상이면 가격 중앙값이 낮은·중간·높은 그룹을 하나씩 골랐습니다. 지역 전체를 대표하는 무작위 표본이 아닙니다.',
        '가격과 면적만으로 주거 품질·통근·교육 환경을 판단할 수 없습니다. 선택에는 정답이나 투자 추천이 없습니다.',
        '주소 숨김은 화면상의 선택 실험입니다. 정보의 보안상 익명화가 아니며 선택 결과는 저장하지 않습니다.'
      ]};
  }

  function build(records, options = {}) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) throw new Error('실험 조건은 객체 형식이어야 합니다.');
    const helper = helpers();
    const areaBand = options.area_band === undefined ? 'all' : options.area_band;
    if (typeof areaBand !== 'string' || !AREA_BANDS.has(areaBand)) throw new Error('면적 구간은 all, small, medium, large 중 하나여야 합니다.');
    const neighborhood = helper.text(options.neighborhood, '동 이름', {limit: 100});
    const validated = helper.validateRecords(records);
    validated.forEach((row, index) => { row._region = helper.text(records[index].region_code, '지역 코드', {limit: 20}); });
    let sales = validated.filter(row => row.kind === 'sale' && !row.canceled && row.price_krw !== null && row.price_krw > 0 &&
      helper.inArea(row.area_m2, areaBand) && (!neighborhood || row.neighborhood === neighborhood));
    const [start, end] = periodBounds(options.period, sales);
    if (start !== null) sales = sales.filter(row => row.contract_date >= start && row.contract_date <= end);
    const idCache = new Map();
    const idFor = key => {
      const serialized = JSON.stringify(key);
      if (!idCache.has(serialized)) idCache.set(serialized, hashId(`(${key.slice(0, 3).map(reprString).join(', ')}, ${key[3]})`));
      return idCache.get(serialized);
    };
    return {mix: mix(sales, start, end, idFor, helper), blind: blind(sales, idFor, helper)};
  }

  function example() {
    const records = [];
    for (const [month, counts] of [[1, [8, 2]], [2, [2, 8]]]) {
      for (let index = 0; index < 2; index += 1) {
        for (let day = 1; day <= counts[index]; day += 1) {
          records.push({id: `mix-example-${month}-${index}-${day}`, region_code: 'EXAMPLE', kind: 'sale', canceled: false,
            contract_date: `2025-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
            apartment: index === 0 ? '가상 작은집' : '가상 넓은집', neighborhood: '연습용 가상동', area_m2: index === 0 ? 59.8 : 84.9,
            floor: 5, price_krw: index === 0 ? 500000000 : 1000000000, deposit_krw: null, monthly_rent_krw: null});
        }
      }
    }
    const result = build(records, {period: {start: '2025-01-01', end: '2025-02-28'}}).mix;
    result.is_example = true;
    result.label = '착시 연습용 가상 예제';
    result.explanation = '작은집은 5억, 넓은집은 10억으로 그대로인데, 넓은집 거래가 2건에서 8건으로 늘었습니다. 전체 중앙값은 100% 올랐지만 같은 구성으로 비교하면 0%입니다.';
    result.limitations.unshift('이 예제의 집·가격·거래·날짜는 설명을 위해 만든 가상 자료이며 선택 지역의 실제 시세와 무관합니다.');
    return result;
  }

  globalThis.DongneInsights = Object.freeze({build, example});
})();
