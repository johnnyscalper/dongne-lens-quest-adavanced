/* Browser-local counterpart of analytics.py. Pure calculations; all money is KRW. */
(() => {
  'use strict';
  const DEFAULT_ASSUMPTIONS = Object.freeze({
    budget_krw: 1500000000, equity_krw: 700000000, loan_rate_pct: 4.5,
    loan_years: 30, vacancy_pct: 5, annual_cost_krw: 2400000
  });
  const LIMITS = Object.freeze({
    budget_krw: [1000000, 1000000000000, true], equity_krw: [0, 1000000000000, true],
    loan_rate_pct: [0, 30, false], loan_years: [1, 50, true],
    vacancy_pct: [0, 100, false], annual_cost_krw: [0, 10000000000, true]
  });
  const KINDS = ['sale', 'jeonse', 'monthly'];
  const AREA_BANDS = ['all', 'small', 'medium', 'large'];
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const objectLike = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const commas = value => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  // Python round uses nearest/even, unlike Math.round. Decimal rounding must use
  // the exact binary value as well (e.g. round(2.675, 2) is 2.67 in Python).
  const floatBits = new DataView(new ArrayBuffer(8));
  function pyRound(value, digits = 0) {
    if (!Number.isFinite(value) || !Number.isInteger(digits)) throw new Error('반올림할 유한한 숫자가 필요합니다.');
    if (digits === 0) {
      const lower = Math.floor(value), fraction = value - lower;
      const result = fraction < .5 ? lower : fraction > .5 ? lower + 1 : lower % 2 === 0 ? lower : lower + 1;
      return result === 0 ? 0 : result;
    }
    if (digits > 308) return value;
    if (digits < -308) return 0;
    const negative = value < 0;
    floatBits.setFloat64(0, Math.abs(value), false);
    const high = floatBits.getUint32(0, false), low = floatBits.getUint32(4, false);
    const exponentBits = (high >>> 20) & 0x7ff;
    let numerator = (BigInt(high & 0xfffff) << 32n) | BigInt(low);
    if (exponentBits !== 0) numerator += 1n << 52n;
    const exponent = exponentBits === 0 ? -1074 : exponentBits - 1023 - 52;
    let denominator = 1n;
    if (exponent >= 0) numerator <<= BigInt(exponent);
    else denominator <<= BigInt(-exponent);
    const decimalScale = 10n ** BigInt(Math.abs(digits));
    if (digits > 0) numerator *= decimalScale;
    else denominator *= decimalScale;
    let quotient = numerator / denominator;
    const remainder = numerator % denominator;
    if (remainder * 2n > denominator || (remainder * 2n === denominator && quotient % 2n !== 0n)) quotient += 1n;
    // Decimal-string conversion avoids overflowing a temporary Number when a
    // very small value is rounded at many decimal places.
    const rounded = Number(`${negative ? '-' : ''}${quotient}e${-digits}`);
    return rounded === 0 ? 0 : rounded;
  }

  function general(value) {
    if (value === 0) return '0';
    const rounded = Number(value.toPrecision(6));
    const exponent = Math.floor(Math.log10(Math.abs(rounded)));
    if (exponent < -4 || exponent >= 6) {
      const [mantissa, power] = rounded.toExponential().split('e');
      return `${mantissa}e${Number(power) < 0 ? '-' : '+'}${String(Math.abs(Number(power))).padStart(2, '0')}`;
    }
    return String(rounded);
  }

  function number(value, label, minimum, maximum, { integer = false, nullable = false } = {}) {
    if (value == null && nullable) return null;
    if (typeof value !== 'number') throw new Error(`${label}: 숫자를 입력해 주세요.`);
    if (!Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`${label}: ${general(minimum)}~${general(maximum)} 범위의 유한한 숫자가 필요합니다.`);
    if (integer && !Number.isInteger(value)) throw new Error(`${label}: 정수 단위로 입력해 주세요.`);
    return value;
  }

  function text(value, label, { defaultValue = '', limit = 200 } = {}) {
    if (value == null) return defaultValue;
    if (typeof value !== 'string' || Array.from(value).length > limit) throw new Error(`${label}: ${limit}자 이내의 문자열이 필요합니다.`);
    // Same whitespace set as Python str.strip; a BOM is not silently removed.
    return value.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g, '');
  }

  function validateAssumptions(values) {
    if (values == null) values = {};
    if (!objectLike(values)) throw new Error('자금 가정은 객체 형식이어야 합니다.');
    if (Object.keys(values).some(key => !own(DEFAULT_ASSUMPTIONS, key))) throw new Error('지원하지 않는 자금 가정 항목이 있습니다.');
    const result = {};
    for (const [key, defaultValue] of Object.entries(DEFAULT_ASSUMPTIONS)) {
      const [minimum, maximum, integer] = LIMITS[key];
      result[key] = number(own(values, key) ? values[key] : defaultValue, key, minimum, maximum, { integer });
    }
    return result;
  }

  function isDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  }

  function validateRecords(records) {
    if (!Array.isArray(records) || records.length > 5000) throw new Error('거래 자료는 최대 5,000개 행의 배열이어야 합니다.');
    return records.map((source, index) => {
      const label = `거래 ${index + 1}행`;
      if (!objectLike(source)) throw new Error(`${label}: 객체 형식이 필요합니다.`);
      if (!KINDS.includes(source.kind)) throw new Error(`${label}: sale, jeonse, monthly 중 거래 유형을 지정해 주세요.`);
      const canceled = own(source, 'canceled') ? source.canceled : false;
      if (typeof canceled !== 'boolean') throw new Error(`${label}: 해제 여부는 true/false여야 합니다.`);
      if (typeof source.contract_date !== 'string') throw new Error(`${label}: 계약일은 YYYY-MM-DD 형식이어야 합니다.`);
      if (!isDate(source.contract_date)) throw new Error(`${label}: 올바른 계약일을 입력해 주세요.`);
      return {
        kind: source.kind, canceled, contract_date: source.contract_date,
        area_m2: number(source.area_m2, `${label} 전용면적`, .01, 2000),
        price_krw: number(source.price_krw, `${label} 매매가`, 1, 10000000000000, { integer: true, nullable: true }),
        deposit_krw: number(source.deposit_krw, `${label} 보증금`, 0, 10000000000000, { integer: true, nullable: true }),
        monthly_rent_krw: number(source.monthly_rent_krw, `${label} 월세`, 0, 1000000000, { integer: true, nullable: true }),
        floor: number(source.floor, `${label} 층`, -20, 300, { integer: true, nullable: true }),
        apartment: text(source.apartment, `${label} 단지명`, { defaultValue: '단지명 미상' }) || '단지명 미상',
        neighborhood: text(source.neighborhood, `${label} 법정동`)
      };
    });
  }

  const inArea = (area, band) => band === 'all' || (band === 'small' && area <= 60) || (band === 'medium' && area > 60 && area <= 85) || (band === 'large' && area > 85);
  function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }
  const medianWon = values => values.length ? pyRound(median(values)) : null;
  const won = value => `${commas(pyRound(value / 10000))}만원`;
  function payment(principal, annualRate, years) {
    if (principal <= 0) return 0;
    const installments = Math.trunc(years * 12);
    if (annualRate === 0) return pyRound(principal / installments);
    const monthlyRate = annualRate / 1200;
    const denominator = -Math.expm1(-installments * Math.log1p(monthlyRate));
    return pyRound(principal * monthlyRate / denominator);
  }
  function compareText(left, right) {
    const a = Array.from(left), b = Array.from(right);
    for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
      const difference = a[i].codePointAt(0) - b[i].codePointAt(0);
      if (difference) return difference;
    }
    return a.length - b.length;
  }

  function analyze(records, options = {}) {
    if (!objectLike(options)) throw new Error('분석 조건은 객체 형식이어야 합니다.');
    const areaBand = own(options, 'area_band') ? options.area_band : 'all';
    if (!AREA_BANDS.includes(areaBand)) throw new Error('면적 구간은 all, small, medium, large 중 하나여야 합니다.');
    const neighborhood = text(own(options, 'neighborhood') ? options.neighborhood : '', '동 이름', { limit: 100 });
    const settings = validateAssumptions(options.assumptions);
    const rows = validateRecords(records), warnings = [];
    const canceledCount = rows.filter(row => row.canceled).length;
    let filtered = rows.filter(row => !row.canceled && inArea(row.area_m2, areaBand) && (!neighborhood || row.neighborhood === neighborhood));
    const essentialKey = { sale: 'price_krw', jeonse: 'deposit_krw', monthly: 'monthly_rent_krw' };
    const missingCount = filtered.filter(row => row[essentialKey[row.kind]] == null || row[essentialKey[row.kind]] <= 0).length;
    filtered = filtered.filter(row => row[essentialKey[row.kind]] !== null && row[essentialKey[row.kind]] > 0);
    const byKind = Object.fromEntries(KINDS.map(kind => [kind, filtered.filter(row => row.kind === kind)]));
    const sales = byKind.sale.map(row => row.price_krw), jeonse = byKind.jeonse.map(row => row.deposit_krw);
    const rents = byKind.monthly.map(row => row.monthly_rent_krw);
    const monthlyDeposits = byKind.monthly.map(row => row.deposit_krw).filter(value => value !== null);
    const counts = { sale: sales.length, jeonse: jeonse.length, monthly: rents.length, total: filtered.length };
    const medians = {
      sale_krw: medianWon(sales), jeonse_krw: medianWon(jeonse), monthly_rent_krw: medianWon(rents),
      monthly_deposit_krw: medianWon(monthlyDeposits), price_per_m2_krw: medianWon(byKind.sale.map(row => row.price_krw / row.area_m2))
    };
    if (canceledCount) warnings.push(`해제된 거래 ${commas(canceledCount)}건은 모든 분석에서 제외했습니다.`);
    if (missingCount) warnings.push(`필수 금액이 없거나 유효하지 않은 거래 ${commas(missingCount)}건을 제외했습니다. 0원으로 보정하지 않았습니다.`);
    if (!filtered.length) warnings.push('선택한 동·면적 조건에 맞는 유효 거래가 없습니다. 조건을 넓혀 주세요.');
    else if (sales.length < 5) warnings.push('매매 표본이 5건 미만이라 조건 적합도 점수를 계산하지 않습니다.');
    if ((jeonse.length > 0 && jeonse.length < 5) || (rents.length > 0 && rents.length < 5)) warnings.push('임대 유형별 표본이 5건 미만이면 중위값이 일부 거래에 크게 영향을 받을 수 있습니다.');

    const months = new Map(), groups = new Map();
    for (const row of filtered) {
      const month = row.contract_date.slice(0, 7), group = JSON.stringify([row.apartment, row.neighborhood]);
      if (!months.has(month)) months.set(month, []);
      if (!groups.has(group)) groups.set(group, []);
      months.get(month).push(row); groups.get(group).push(row);
    }
    const trend = [...months.entries()].sort(([a], [b]) => compareText(a, b)).map(([month, observations]) => {
      const saleValues = observations.filter(row => row.kind === 'sale').map(row => row.price_krw);
      const jeonseValues = observations.filter(row => row.kind === 'jeonse').map(row => row.deposit_krw);
      return { month, sale_krw: medianWon(saleValues), jeonse_krw: medianWon(jeonseValues), sale_count: saleValues.length, rent_count: jeonseValues.length };
    });
    const apartments = [...groups.values()].map(observations => {
      const saleValues = observations.filter(row => row.kind === 'sale').map(row => row.price_krw);
      const jeonseValues = observations.filter(row => row.kind === 'jeonse').map(row => row.deposit_krw);
      const monthlyValues = observations.filter(row => row.kind === 'monthly').map(row => row.monthly_rent_krw);
      return {
        name: observations[0].apartment, neighborhood: observations[0].neighborhood,
        area_m2: pyRound(median(observations.map(row => row.area_m2)), 2),
        sale_krw: medianWon(saleValues), sale_count: saleValues.length, jeonse_krw: medianWon(jeonseValues),
        monthly_rent_krw: medianWon(monthlyValues), jeonse_count: jeonseValues.length, monthly_count: monthlyValues.length
      };
    }).sort((a, b) => b.sale_count - a.sale_count || compareText(a.name, b.name) || compareText(a.neighborhood, b.neighborhood));
    if (apartments.length > 30) warnings.push(`단지 비교는 매매 표본이 많은 상위 30개를 표시합니다. 전체 통계에는 ${commas(apartments.length)}개 단지가 포함됩니다.`);

    const purchase = medians.sale_krw;
    const withinCount = sales.filter(value => value <= settings.budget_krw).length;
    const budgetShare = { within_count: withinCount, total: sales.length, percent: sales.length ? pyRound(100 * withinCount / sales.length, 1) : null };
    const reasons = [], components = [];
    const confidence = sales.length < 5 ? 'insufficient' : sales.length < 20 ? 'limited' : 'good';
    let score = null, label = '자료 부족 · 조건을 넓혀 보세요';
    if (purchase !== null) {
      const budgetPoints = pyRound(60 * Math.min(1, settings.budget_krw / purchase));
      const fundingPoints = pyRound(40 * Math.min(1, settings.equity_krw / purchase));
      components.push(
        { label: '예산 적합', score: sales.length >= 5 ? budgetPoints : null, max_score: 60, detail: '60 × min(1, 입력 예산 ÷ 매매 중위값)' },
        { label: '자기자금 여력', score: sales.length >= 5 ? fundingPoints : null, max_score: 40, detail: '40 × min(1, 입력 자기자금 ÷ 매매 중위값)' }
      );
      reasons.push(purchase > settings.budget_krw
        ? `매매 중위값이 입력 예산보다 ${won(purchase - settings.budget_krw)} 높습니다.`
        : `매매 중위값은 입력 예산 안에 있습니다. 예산 차이는 ${won(settings.budget_krw - purchase)}입니다.`);
      reasons.push(`필터에 맞는 과거 매매 ${commas(sales.length)}건 중 ${commas(withinCount)}건이 입력 예산 이하입니다.`);
      if (sales.length >= 5) {
        score = budgetPoints + fundingPoints;
        label = purchase > settings.budget_krw ? '예산 조정 검토' : score >= 85 ? '자금 여유가 비교적 있는 편' : score >= 65 ? '추가 자금 조건 확인' : '자금 부담 점검 필요';
      }
    }
    if (sales.length < 5) reasons.push('매매 표본 5건 이상일 때만 점수를 표시합니다.');
    reasons.push('점수는 입력 자금과 거래 중위값의 비교이며, 투자수익·가격상승·대출승인 가능성을 예측하지 않습니다.');
    const fit = { score, label, reasons, components, confidence };
    const loan = purchase !== null ? Math.max(purchase - settings.equity_krw, 0) : null;
    const interest = loan !== null ? pyRound(loan * settings.loan_rate_pct / 1200) : null;
    const cashflow = loan !== null && medians.monthly_rent_krw !== null
      ? pyRound(medians.monthly_rent_krw * (1 - settings.vacancy_pct / 100) - loan * settings.loan_rate_pct / 1200 - settings.annual_cost_krw / 12) : null;
    const scenario = {
      purchase_krw: purchase, loan_krw: loan,
      monthly_payment_krw: loan !== null ? payment(loan, settings.loan_rate_pct, settings.loan_years) : null,
      monthly_interest_krw: interest,
      stress_payment_krw: loan !== null ? payment(loan, settings.loan_rate_pct + 2, settings.loan_years) : null,
      monthly_cashflow_krw: cashflow,
      jeonse_return_gap_krw: medians.jeonse_krw !== null ? pyRound(medians.jeonse_krw * .1) : null,
      notes: [
        '대출 가정은 매매 중위값 − 자기자금(최소 0원)입니다. 실제 대출 한도·승인·규제를 반영하지 않습니다.',
        `월 상환액은 ${settings.loan_years}년 원리금균등상환입니다. 금리 부담 비교는 입력 금리 +2%p를 적용합니다.`,
        `월 임대 현금흐름은 월세 중위값 × (1 − 공실률 ${general(settings.vacancy_pct)}%) − 월 이자 − 연 운영비 ${won(settings.annual_cost_krw)} ÷ 12입니다. 원금상환과 세금은 제외합니다.`,
        '매매·전세·월세 중위값은 서로 다른 거래 표본입니다. 같은 세대의 수익률이 아니며 보증금으로 대출을 줄이지 않습니다.',
        '보증금 10% 감소 시 반환할 추가 자금만 가정합니다. 보증금 자체는 수익이 아니라 반환 의무가 있는 자금입니다.',
        '취득세·중개보수·등기비용·대규모 수선비·보유세 등은 별도 확인이 필요하며 초기 자기자금 계산에 포함되지 않습니다.'
      ]
    };
    return {
      counts, medians, trend, apartments: apartments.slice(0, 30), fit, scenario,
      budget_share: budgetShare, warnings,
      methodology: [
        '금액은 선택 지역·동·면적·기간의 신고 거래 중위값입니다. 현재 매물 호가·감정가격·공식 가격지수가 아닙니다.',
        '소형은 전용 60㎡ 이하, 중형은 60㎡ 초과~85㎡ 이하, 대형은 85㎡ 초과입니다. 모든 금액은 원 단위로 계산합니다.',
        '해제 거래와 필수 금액이 없는 행은 제외합니다. 알 수 없는 값을 0으로 대체하지 않습니다.',
        '월별 중위값은 거래된 단지·면적·층의 구성 변화에 영향을 받습니다. 같은 주택의 가격변화나 수익률로 해석하지 마세요.',
        '단지 비교는 같은 단지명·동의 거래를 묶은 값으로, 면적·층이 같은 개별 세대 비교가 아닙니다.',
        '조건 적합도 = 예산 적합 60점 + 자기자금 여력 40점의 공개된 가정식입니다. 거래 표본 5건 미만이면 점수를 표시하지 않습니다.',
        '자료 충실도는 매매 표본 수만 표시합니다(5건 미만: 부족, 5~19건: 제한적, 20건 이상: 충분). 자료의 정확도·미래 예측 신뢰도를 보증하지 않습니다.',
        '예산 이하 비율은 선택한 과거 매매 중 예산 이하 거래의 비율이며, 현재 구매 가능한 매물 비율이 아닙니다.'
      ]
    };
  }

  globalThis.DongneAnalytics = Object.freeze({
    analyze, DEFAULT_ASSUMPTIONS,
    helpers: Object.freeze({ pyRound, median, medianWon, validateRecords, inArea, text, validateAssumptions, isDate, compareText })
  });
})();
