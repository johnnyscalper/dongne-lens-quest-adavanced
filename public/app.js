/* 동네렌즈 퀘스트 (Adavanced) — no third-party browser dependencies. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const LOCAL_RUNTIME = globalThis.DONGNE_RUNTIME === 'local';
  const DEFAULTS = Object.freeze({ budget_krw: 1500000000, equity_krw: 700000000, loan_rate_pct: 4.5, loan_years: 30, vacancy_pct: 5, annual_cost_krw: 2400000 });
  const state = { regions: [], config: null, region: null, market: null, analysis: null, assumptions: { ...DEFAULTS }, loading: false, analyzing: false, marketSequence: 0, analysisSequence: 0, searchSequence: 0, marketController: null, analysisController: null, timer: null, toastTimer: null, transaction: 'sale', savedKeys: new Set() };
  let settleReady;
  const ready = new Promise((resolve) => { settleReady = resolve; });
  const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
  const numeric = (value) => typeof value === 'number' && Number.isFinite(value);
  const normalized = (value) => String(value ?? '').normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase('ko-KR');
  const text = (id, value) => { const target = $(id); if (target) target.textContent = value; };
  const hidden = (id, value) => { const target = $(id); if (target) target.hidden = value; };
  const number = (value, digits = 0) => value.toLocaleString('ko-KR', { maximumFractionDigits: digits });
  const money = (value) => {
    if (!numeric(value)) return '자료 부족';
    const sign = value < 0 ? '−' : '';
    const absolute = Math.abs(value);
    if (absolute >= 100000000) return `${sign}${number(absolute / 100000000, 2)}억`;
    if (absolute >= 10000) return `${sign}${number(absolute / 10000, 1)}만원`;
    return `${sign}${number(absolute)}원`;
  };
  const exactMoney = (value) => numeric(value) ? `${number(value)}원` : '자료 부족';
  const element = (tag, className, value) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined && value !== null) node.textContent = String(value);
    return node;
  };
  const setMoney = (id, value) => {
    const target = $(id);
    if (!target) return;
    target.textContent = money(value);
    target.title = exactMoney(value);
  };

  function toast(message, isError = false) {
    const target = $('toast');
    if (!target) return;
    clearTimeout(state.toastTimer);
    target.textContent = message;
    target.dataset.kind = isError ? 'error' : 'info';
    target.hidden = false;
    state.toastTimer = setTimeout(() => { target.hidden = true; }, 5500);
  }

  async function request(url, options = {}) {
    if (LOCAL_RUNTIME) {
      if (typeof globalThis.DongneLocal?.request !== 'function') throw new Error('설치 없는 체험 파일이 완전하지 않습니다. 최신 play.html 전체 파일을 다시 열어 주세요.');
      return globalThis.DongneLocal.request(url, options);
    }
    const response = await fetch(url, { cache: 'no-store', ...options });
    let payload;
    try { payload = await response.json(); } catch { throw new Error('서버 응답을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
    if (!response.ok) {
      const detail = typeof payload.error === 'string' ? payload.error : payload.error?.message || payload.message;
      throw new Error(typeof detail === 'string' ? detail : '자료를 가져오지 못했습니다. 다시 시도해 주세요.');
    }
    return payload;
  }

  function updateBusy() {
    const busy = state.loading || state.analyzing;
    hidden('loading-indicator', !busy);
    document.querySelector('main')?.setAttribute('aria-busy', String(busy));
    for (const id of ['search-button', 'period-select', 'mode-select']) if ($(id)) $(id).disabled = state.loading;
    for (const id of ['area-select', 'neighborhood-select', 'analyze-button']) if ($(id)) $(id).disabled = state.loading || !state.market;
    if ($('download-button')) $('download-button').disabled = busy || !state.analysis;
    if ($('share-button')) $('share-button').disabled = busy || !state.market;
    if ($('search-button')) $('search-button').setAttribute('aria-busy', String(state.loading));
    emit('lens:busy', { loading: state.loading, analyzing: state.analyzing });
  }

  function clearAnalysis() {
    state.analysis = null;
    window.dispatchEvent(new CustomEvent('lens:clear', { detail: { reason: '분석 조건 변경' } }));
    for (const id of ['sale-value', 'jeonse-value', 'rent-value', 'gap-value', 'payment-value', 'stress-value', 'cashflow-value', 'return-gap-value']) text(id, '—');
    for (const id of ['home-sale', 'home-jeonse', 'home-count']) text(id, '—');
    text('market-result-count', state.loading ? '거래 자료를 확인하고 있어요' : '조건을 계산하고 있어요');
    for (const id of ['sale-count', 'jeonse-count', 'rent-count', 'gap-detail', 'fit-confidence']) text(id, '');
    text('fit-score', '—');
    text('fit-label', state.loading ? '자료를 불러오는 중' : '조건을 분석하는 중');
    for (const id of ['fit-reasons', 'fit-components', 'scenario-notes', 'apartment-list', 'trend-chart']) $(id)?.replaceChildren();
    hidden('apartment-empty', true);
    hidden('trend-empty', true);
    updateBusy();
  }

  function showError(message, { clear = true } = {}) {
    if (clear) clearAnalysis();
    const box = $('warnings');
    if (box) {
      box.replaceChildren(element('p', 'notice', message));
      box.hidden = false;
    }
    text('fit-label', '분석할 자료를 확인해 주세요');
    text('source-status', '조회 실패 · 이전 결과를 표시하지 않습니다');
    toast(message, true);
  }

  function invalidateSearch(message) {
    window.dispatchEvent(new CustomEvent('lens:destination', { detail: { name: '목적지를 다시 선택해 주세요' } }));
    // A failed search is a new intent: old data and in-flight responses must not
    // look like results for the text that remains in the search field.
    ++state.marketSequence;
    ++state.analysisSequence;
    clearTimeout(state.timer);
    state.marketController?.abort();
    state.analysisController?.abort();
    state.region = null;
    state.market = null;
    state.analysis = null;
    state.loading = false;
    state.analyzing = false;
    fillNeighborhoods();
    showError(message);
    text('region-title', '지역을 다시 선택해 주세요');
    text('region-subtitle', '입력한 지역을 확인하지 못해 이전 지역의 분석 결과를 지웠습니다.');
    text('source-status', '지역 확인 필요 · 이전 결과를 표시하지 않습니다');
    text('home-region', '관심 지역을 선택해 주세요');
    text('market-search-label', '관심 지역 검색');
    text('market-result-count', '지역을 다시 선택해 주세요');
    text('updated-at', '자료 조회 대기 중');
    $('source-details')?.replaceChildren(element('p', 'source-line', '지역을 다시 선택하면 해당 지역의 자료 출처와 조회 시각을 표시합니다.'));
    updateBusy();
    $('region-input').focus();
  }

  function regionMatches(region, query) {
    return [region.code, region.name, ...(region.aliases || []), ...(region.neighborhoods || [])].some((name) => normalized(name) === query);
  }

  function resolveRegion(raw) {
    const query = normalized(raw);
    if (!query) throw new Error('지역명을 입력해 주세요. 예: 강남구, 청담동, 자양동');
    const qualified = [];
    for (const region of state.regions) {
      const prefixes = [region.name, region.name.replace(/^서울특별시\s*/, '서울'), region.name.split(/\s+/).at(-1),
        ...(region.aliases || []).filter((alias) => !/동$/.test(alias.trim()))];
      for (const neighborhood of region.neighborhoods || []) {
        if (prefixes.some((prefix) => normalized(`${prefix} ${neighborhood}`) === query)) qualified.push({ region, neighborhood });
      }
    }
    if (qualified.length === 1) return qualified[0];
    if (qualified.length > 1) throw new Error('같은 이름의 지역이 있습니다. 시·도와 시·군·구를 함께 입력해 주세요.');
    let matches = state.regions.filter((region) => regionMatches(region, query));
    if (!matches.length) matches = state.regions.filter((region) => [region.name, ...(region.aliases || []), ...(region.neighborhoods || [])].some((name) => normalized(name).includes(query)));
    if (!matches.length) throw new Error('현재 지원 목록에서 찾지 못한 지역입니다. 자동완성에 표시되는 시·군·구를 선택해 주세요.');
    if (matches.length > 1) throw new Error('같은 이름의 지역이 있습니다. 시·도와 시·군·구를 함께 입력해 주세요.');
    const region = matches[0];
    const neighborhoods = region.neighborhoods || [];
    const exactNeighborhood = neighborhoods.find((name) => normalized(name) === query);
    if (exactNeighborhood) return { region, neighborhood: exactNeighborhood };
    const district = normalized(region.name.split(/\s+/).at(-1));
    const districtStem = district.replace(/[시군구]$/, '');
    const isDistrictQuery = query === region.code || query === normalized(region.name) || query.endsWith(district) || (districtStem && query.endsWith(districtStem));
    if (isDistrictQuery) return { region, neighborhood: '' };
    const neighborhoodHint = query.replace(/동$/, '');
    const neighborhoodMatches = neighborhoods.filter((name) => normalized(name).includes(neighborhoodHint));
    if (neighborhoodMatches.length === 1) return { region, neighborhood: neighborhoodMatches[0] };
    if (neighborhoodMatches.length > 1) throw new Error(`세부 동을 선택해 주세요: ${neighborhoodMatches.join(', ')}. 시·군·구 전체를 보려면 ${region.name}로 검색하세요.`);
    const exactAlias = (region.aliases || []).find((alias) => normalized(alias) === query);
    if (exactAlias && /동$/.test(exactAlias.trim())) return { region, neighborhood: exactAlias.trim() };
    throw new Error(`이 별칭은 정확한 동 경계를 정할 수 없습니다. 자동완성의 동 이름 또는 ${region.name}를 선택해 주세요.`);
  }

  function fillRegionOptions() {
    const list = $('region-options');
    if (!list) return;
    list.replaceChildren();
    const seen = new Set();
    for (const region of state.regions) {
      for (const value of [region.name, ...(region.aliases || []), ...(region.neighborhoods || [])]) {
        if (seen.has(value)) continue;
        seen.add(value);
        const option = element('option');
        option.value = value;
        if (value !== region.name) option.label = region.name;
        list.append(option);
      }
    }
  }

  function fillNeighborhoods(wanted = '') {
    const select = $('neighborhood-select');
    if (!select) return;
    const neighborhoods = [...new Set((state.market?.records || []).filter((row) => !row.canceled && row.neighborhood).map((row) => row.neighborhood))].sort((a, b) => a.localeCompare(b, 'ko'));
    select.replaceChildren();
    const all = element('option', '', '전체 동'); all.value = ''; select.append(all);
    for (const name of neighborhoods) { const option = element('option', '', name); option.value = name; select.append(option); }
    if (wanted && !neighborhoods.includes(wanted)) {
      // Keep the user's exact neighborhood intent; never broaden it silently.
      const unavailable = element('option', '', `${wanted} · 해당 기간 자료 없음`);
      unavailable.value = wanted;
      select.append(unavailable);
    }
    select.value = wanted;
  }

  function modePresentation(mode) {
    const demo = mode === 'demo';
    text('mode-badge', demo ? '가상 예시 데이터' : '국토부 신고 거래자료');
    if ($('mode-badge')) $('mode-badge').dataset.mode = demo ? 'demo' : 'live';
    document.body.dataset.mode = demo ? 'demo' : 'live';
    text('source-status', demo ? (LOCAL_RUNTIME ? '설치 없는 체험 · 모든 거래는 가상 데이터이며 실제 시세가 아닙니다' : '실제 시세가 아닙니다 · 기능을 체험하는 가상 데이터') : '계약 신고자료 기준 · 현재 매물 호가와 다릅니다');
  }

  async function loadMarket(region, wantedNeighborhood = '') {
    const sequence = ++state.marketSequence;
    ++state.analysisSequence;
    clearTimeout(state.timer);
    state.marketController?.abort();
    state.analysisController?.abort();
    state.marketController = new AbortController();
    state.region = region;
    state.market = null;
    state.loading = true;
    state.analyzing = false;
    window.dispatchEvent(new CustomEvent('lens:destination', { detail: { name: '목적지를 확인하고 있어요' } }));
    clearAnalysis();
    hidden('warnings', true);
    text('region-title', region.name);
    text('home-region', wantedNeighborhood || region.name);
    text('market-search-label', wantedNeighborhood || region.name);
    text('region-subtitle', '선택한 지역의 거래자료를 불러오고 있습니다.');
    $('region-input').value = wantedNeighborhood || region.name;
    const mode = $('mode-select').value;
    modePresentation(mode);
    const controller = state.marketController;
    text('updated-at', '자료 조회 중');
    $('source-details')?.replaceChildren(element('p', 'source-line', '선택한 지역의 출처와 조회 시각을 확인하는 중입니다.'));
    const timeout = setTimeout(() => controller.abort(), mode === 'live' ? 90000 : 15000);
    try {
      const query = new URLSearchParams({ region: region.code, months: $('period-select').value, mode });
      const market = await request(`/api/market?${query}`, { signal: state.marketController.signal });
      if (sequence !== state.marketSequence) return;
      if (!market || !Array.isArray(market.records) || !market.region || market.mode !== mode || market.region.code !== region.code) throw new Error('지역 또는 데이터 모드가 요청과 일치하지 않습니다. 다시 조회해 주세요.');
      state.market = market;
      state.region = market.region;
      fillNeighborhoods(wantedNeighborhood);
      modePresentation(market.mode);
      window.dispatchEvent(new CustomEvent('lens:destination', { detail: { name: wantedNeighborhood || market.region.name, mode: market.mode } }));
      renderSource();
      state.loading = false;
      updateBusy();
      return await analyze();
    } catch (error) {
      if (sequence !== state.marketSequence) return;
      state.market = null;
      window.dispatchEvent(new CustomEvent('lens:destination', { detail: { name: '목적지를 다시 선택해 주세요' } }));
      const message = error.name === 'AbortError' ? '자료 조회 시간이 길어져 중단했습니다. 기간을 줄이거나 잠시 후 다시 시도해 주세요.' : error.message;
      showError(message);
      text('region-subtitle', '조회가 완료되지 않았습니다. 지역·기간·데이터 연결 상태를 확인해 주세요.');
      text('updated-at', '자료 조회 미완료');
      $('source-details')?.replaceChildren(element('p', 'source-line', '이번 조회가 완료되지 않아 출처 정보를 표시하지 않습니다.'));
      text('market-result-count', '조회하지 못했어요 · 다시 검색해 주세요');
      return { error: message };
    } finally {
      clearTimeout(timeout);
      if (sequence === state.marketSequence) { state.loading = false; updateBusy(); }
    }
  }

  async function search(raw, { navigate = true } = {}) {
    const intent = ++state.searchSequence;
    const readiness = await ready;
    if (intent !== state.searchSequence) return false;
    const query = typeof raw === 'string' ? raw.trim() : '';
    const fail = (message) => {
      emit('lens:search-error', { message });
      return false;
    };
    if (!readiness.ok) return fail(readiness.message);
    if ($('region-input')) $('region-input').value = query;
    let resolved;
    try { resolved = resolveRegion(query); }
    catch (error) { invalidateSearch(error.message); return fail(error.message); }
    text('search-error', '');
    hidden('search-error', true);
    const sequence = state.marketSequence + 1;
    const result = await loadMarket(resolved.region, resolved.neighborhood);
    // A newer query, filter request or invalid search owns the screen now.
    if (intent !== state.searchSequence || sequence !== state.marketSequence || !result) return false;
    if (result.error) return fail(result.error);
    if (!result.analysis || state.analysis !== result.analysis) return false;
    if (navigate) emit('lens:search-success', { query, region: state.region,
      neighborhood: resolved.neighborhood, market: state.market, analysis: state.analysis });
    return true;
  }

  function readAssumptions() {
    const budget = Number($('budget-input').value);
    const equity = Number($('equity-input').value);
    const rate = Number($('rate-input').value);
    if (!$('scenario-form').checkValidity() || !numeric(budget) || !numeric(equity) || !numeric(rate) || budget <= 0 || equity < 0 || rate < 0) throw new Error('예산·자기자금·금리를 허용 범위 안의 숫자로 입력해 주세요.');
    return { ...DEFAULTS, budget_krw: Math.round(budget * 10000), equity_krw: Math.round(equity * 10000), loan_rate_pct: rate };
  }

  function updateInputEchoes() {
    for (const [input, echoes] of [['budget-input', ['budget-display', 'budget-readable', 'budget-echo']], ['equity-input', ['equity-display', 'equity-readable', 'equity-echo']]]) {
      const value = Number($(input)?.value);
      for (const id of echoes) if ($(id)) text(id, numeric(value) ? money(value * 10000) : '');
    }
    text('rate-display', `${$('rate-input')?.value || '0'}%`);
  }

  async function analyze() {
    if (!state.market || state.loading) return;
    const sequence = ++state.analysisSequence;
    const marketSequence = state.marketSequence;
    state.analysisController?.abort();
    state.analysisController = new AbortController();
    state.analyzing = true;
    clearAnalysis();
    try {
      const assumptions = readAssumptions();
      const analysis = await request('/api/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: state.analysisController.signal,
        body: JSON.stringify({ records: state.market.records, area_band: $('area-select').value, neighborhood: $('neighborhood-select').value, assumptions })
      });
      if (sequence !== state.analysisSequence || marketSequence !== state.marketSequence) return;
      state.assumptions = assumptions;
      state.analysis = analysis;
      renderAnalysis();
      modePresentation(state.market.mode);
      window.dispatchEvent(new CustomEvent('lens:destination', { detail: { name: $('neighborhood-select').value || state.market.region.name, mode: state.market.mode } }));
      window.dispatchEvent(new CustomEvent('lens:analysis', { detail: { market: state.market, analysis, assumptions,
        filters: { area_band: $('area-select').value, neighborhood: $('neighborhood-select').value } } }));
      return { analysis };
    } catch (error) {
      if (sequence !== state.analysisSequence || marketSequence !== state.marketSequence || error.name === 'AbortError') return;
      showError(error.message);
      return { error: error.message };
    } finally {
      if (sequence === state.analysisSequence) { state.analyzing = false; updateBusy(); }
    }
  }

  function renderSource() {
    const market = state.market;
    if (!market) return;
    const box = $('source-details');
    if (box) {
      box.replaceChildren();
      box.append(element('p', 'source-line', market.mode === 'demo' ? '가상의 단지·가격·거래일로 만든 기능 체험 자료입니다. 실제 지역 시세나 투자 판단에 사용할 수 없습니다.' : '국토교통부 아파트 매매·전월세 신고자료입니다. 현재 매물, 감정가, 대출 승인 가능 여부를 뜻하지 않습니다.'));
      if (LOCAL_RUNTIME) box.append(element('p', 'source-line', '설치 없는 체험은 브라우저 안에서 가상 거래를 생성하고 계산합니다. 실제 국토부 자료 조회는 API 키를 설정한 서버 버전에서 제공합니다.'));
      if (market.period) box.append(element('p', 'source-line', `조회 계약기간 ${market.period.start} ~ ${market.period.end}`));
      if (market.source?.label) box.append(element('p', 'source-line', `출처: ${market.source.label}`));
      if (market.source?.url) {
        try {
          const url = new URL(market.source.url);
          if (url.protocol === 'https:') { const link = element('a', 'source-link', '원본 자료 안내 보기 ↗'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; box.append(link); }
        } catch { /* Untrusted or invalid URLs are deliberately omitted. */ }
      }
      if (market.coverage?.partial) box.append(element('p', 'source-line', '일부 기간 또는 거래 유형의 자료가 누락되어 있습니다. 아래 알림을 확인해 주세요.'));
    }
    const fetched = new Date(market.fetched_at);
    text('updated-at', Number.isNaN(fetched.getTime()) ? '조회 시각 확인 불가' : `${market.mode === 'demo' ? '예시 생성' : '자료 조회'} ${new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(fetched)} · KST`);
  }

  function renderWarnings() {
    const demoNotice = '가상으로 만든 예시 데이터입니다. 실제 지역 시세나 거래를 나타내지 않으며 투자 판단에 사용할 수 없습니다.';
    // The persistent source strip already identifies the demo. Keep every actual
    // coverage/sample warning, but do not repeat the same demo notice as an alert.
    const warnings = [...(state.market?.warnings || []), ...(state.market?.coverage?.warnings || []), ...(state.analysis?.warnings || [])]
      .filter((value) => typeof value === 'string' && !(state.market?.mode === 'demo' && value === demoNotice));
    const box = $('warnings');
    if (!box) return;
    box.replaceChildren();
    for (const warning of [...new Set(warnings)]) box.append(element('p', 'notice', warning));
    box.hidden = !box.children.length;
  }

  function renderAnalysis() {
    const data = state.analysis;
    if (!data) return;
    const { counts, medians, scenario, fit } = data;
    setMoney('sale-value', medians.sale_krw);
    setMoney('jeonse-value', medians.jeonse_krw);
    setMoney('rent-value', medians.monthly_rent_krw);
    text('sale-count', `매매 ${number(counts.sale)}건 · 중앙값`);
    text('jeonse-count', `전세 ${number(counts.jeonse)}건 · 중앙값`);
    text('rent-count', `월세 ${number(counts.monthly)}건 · 보증금 중앙값 ${money(medians.monthly_deposit_krw)}`);
    const gap = numeric(medians.sale_krw) && numeric(medians.jeonse_krw) ? medians.sale_krw - medians.jeonse_krw : null;
    setMoney('gap-value', gap);
    const share = data.budget_share;
    text('gap-detail', numeric(share?.percent) ? `내 예산 이하 매매 ${share.within_count}/${share.total}건 (${number(share.percent, 1)}%) · 동일 세대의 갭이 아님` : '매매·전세 중앙값의 차이 · 동일 세대의 갭이 아님');
    const neighborhood = $('neighborhood-select').value;
    text('region-title', neighborhood ? `${state.region.name} · ${neighborhood}` : state.region.name);
    const areaLabel = $('area-select').selectedOptions[0]?.textContent || '';
    text('region-subtitle', `${areaLabel} · 최근 ${$('period-select').value}개월 · 유효 거래 ${number(counts.total)}건${state.market.mode === 'demo' ? ' · 모두 가상 예시' : ''}`);
    text('home-region', neighborhood || state.region.name);
    setMoney('home-sale', medians.sale_krw);
    setMoney('home-jeonse', medians.jeonse_krw);
    text('home-count', `${number(counts.total)}건`);
    text('market-search-label', neighborhood || state.region.name);
    text('fit-score', numeric(fit.score) ? String(fit.score) : '—');
    text('fit-label', fit.label || '자료 부족');
    text('fit-confidence', ({ insufficient: '매매 표본 5건 미만 · 점수 산출 보류', limited: '표본이 적어 해석에 주의가 필요합니다', good: '표본 수를 충족했습니다 · 미래 수익을 예측하지 않습니다' })[fit.confidence] || '자료 충실도 확인 필요');
    $('fit-reasons')?.replaceChildren(...(fit.reasons || []).map((reason) => element('p', 'reason-item', reason)));
    const components = $('fit-components');
    if (components) {
      components.replaceChildren();
      for (const component of fit.components || []) {
        const row = element('div', 'fit-component');
        const heading = element('div', 'fit-component-heading');
        heading.append(element('span', '', component.label), element('strong', '', numeric(component.score) ? `${component.score} / ${component.max_score}` : '평가 보류'));
        const track = element('div', 'fit-component-track'); track.setAttribute('aria-hidden', 'true');
        const fill = element('span', 'fit-component-fill');
        const width = numeric(component.score) && numeric(component.max_score) && component.max_score > 0 ? Math.max(0, Math.min(100, component.score / component.max_score * 100)) : 0;
        fill.style.width = `${width}%`;
        track.append(fill); row.append(heading, track, element('p', '', component.detail)); components.append(row);
      }
    }
    setMoney('payment-value', scenario.monthly_payment_krw);
    setMoney('stress-value', scenario.stress_payment_krw);
    setMoney('cashflow-value', scenario.monthly_cashflow_krw);
    setMoney('return-gap-value', scenario.jeonse_return_gap_krw);
    if ($('cashflow-value')) $('cashflow-value').dataset.negative = String(numeric(scenario.monthly_cashflow_krw) && scenario.monthly_cashflow_krw < 0);
    $('scenario-notes')?.replaceChildren(...(scenario.notes || []).map((note) => element('p', 'source-line', note)));
    const methodology = $('methodology-details');
    if (methodology) methodology.replaceChildren(...(data.methodology || []).map((line) => element('p', 'source-line', line)));
    renderTrend(data.trend || []);
    renderApartments(data.apartments || []);
    renderWarnings();
    updateBusy();
  }

  function periodMonths() {
    const start = String(state.market?.period?.start || '').slice(0, 7);
    const end = String(state.market?.period?.end || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(start) || !/^\d{4}-\d{2}$/.test(end)) return [];
    let [year, month] = start.split('-').map(Number);
    const months = [];
    for (let i = 0; i < 12; i += 1) {
      const item = `${year}-${String(month).padStart(2, '0')}`;
      if (item > end) break;
      months.push(item);
      month += 1;
      if (month > 12) { month = 1; year += 1; }
    }
    return months;
  }

  function renderTrend(rows) {
    const container = $('trend-chart');
    if (!container) return;
    container.replaceChildren();
    const byMonth = new Map(rows.map((row) => [row.month, row]));
    const months = periodMonths();
    const series = (months.length ? months : [...byMonth.keys()].sort()).map((month) => ({ month, ...(byMonth.get(month) || {}) }));
    const values = series.flatMap((row) => [row.sale_krw, row.jeonse_krw]).filter(numeric);
    hidden('trend-empty', values.length !== 0);
    text('trend-empty', '선택한 지역·면적·기간에 가격 흐름을 그릴 거래자료가 없습니다.');
    if (!values.length) return;
    const NS = 'http://www.w3.org/2000/svg';
    const svgNode = (tag, attrs = {}, value) => { const node = document.createElementNS(NS, tag); for (const [key, attr] of Object.entries(attrs)) node.setAttribute(key, String(attr)); if (value !== undefined) node.textContent = value; return node; };
    const svg = svgNode('svg', { viewBox: '0 0 760 274', role: 'img', 'aria-labelledby': 'trend-svg-title trend-svg-desc', class: 'chart-svg' });
    svg.append(svgNode('title', { id: 'trend-svg-title' }, '월별 매매·전세 거래 중앙값'), svgNode('desc', { id: 'trend-svg-desc' }, '같은 지역과 면적 조건에서 월별 거래 중앙값을 비교합니다. 서로 다른 주택이 거래되어 구성 변화가 포함되며, 거래가 없는 달은 연결하지 않습니다.'));
    const left = 70; const right = 735; const top = 24; const bottom = 223;
    const max = Math.max(...values); const min = Math.min(...values);
    const pad = Math.max((max - min) * 0.18, max * 0.08, 10000000);
    const low = Math.max(0, min - pad); const high = max + pad;
    const x = (index) => series.length <= 1 ? (left + right) / 2 : left + index * (right - left) / (series.length - 1);
    const y = (value) => bottom - (value - low) / (high - low) * (bottom - top);
    for (let i = 0; i <= 3; i += 1) {
      const value = low + (high - low) * i / 3;
      const position = y(value);
      svg.append(svgNode('line', { x1: left, x2: right, y1: position, y2: position, stroke: '#263140', 'stroke-dasharray': '3 5' }), svgNode('text', { x: left - 12, y: position + 4, 'text-anchor': 'end', fill: '#a6afbd', 'font-size': 11 }, money(value)));
    }
    const interval = Math.max(1, Math.ceil(series.length / 6));
    series.forEach((row, index) => {
      if (index % interval === 0 || index === series.length - 1) svg.append(svgNode('text', { x: x(index), y: bottom + 29, 'text-anchor': 'middle', fill: '#a6afbd', 'font-size': 11 }, `${row.month.slice(2, 4)}.${row.month.slice(5)}`));
    });
    for (const [key, label, color] of [['sale_krw', '매매', '#99f6d2'], ['jeonse_krw', '전세', '#a798ff']]) {
      let path = ''; let inSegment = false;
      series.forEach((row, index) => {
        if (!numeric(row[key])) { inSegment = false; return; }
        path += `${inSegment ? ' L' : ' M'}${x(index).toFixed(2)},${y(row[key]).toFixed(2)}`;
        inSegment = true;
      });
      if (path) svg.append(svgNode('path', { d: path, fill: 'none', stroke: color, 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      series.forEach((row, index) => {
        if (!numeric(row[key])) return;
        const point = svgNode('circle', { cx: x(index), cy: y(row[key]), r: 4.5, fill: color, stroke: '#10151d', 'stroke-width': 2 });
        const labelText = `${row.month} ${label} ${exactMoney(row[key])}`;
        point.setAttribute('aria-label', labelText); point.append(svgNode('title', {}, labelText)); svg.append(point);
      });
    }
    const accessibleData = element('div', 'sr-only');
    const table = document.createElement('table');
    table.append(element('caption', '', '월별 매매·전세 거래 중앙값. 거래가 없는 달은 거래 없음으로 표시합니다.'));
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const label of ['계약 월', '매매 중앙값', '전세 중앙값']) {
      const cell = element('th', '', label); cell.scope = 'col'; headRow.append(cell);
    }
    head.append(headRow);
    const body = document.createElement('tbody');
    for (const row of series) {
      const tableRow = document.createElement('tr');
      const monthCell = element('th', '', row.month); monthCell.scope = 'row'; tableRow.append(monthCell);
      for (const key of ['sale_krw', 'jeonse_krw']) tableRow.append(element('td', '', numeric(row[key]) ? exactMoney(row[key]) : '거래 없음'));
      body.append(tableRow);
    }
    table.append(head, body);
    accessibleData.append(table);
    container.append(svg, accessibleData);
  }

  const TRANSACTIONS = Object.freeze({
    sale: { label: '매매', price: 'sale_krw', count: 'sale_count' },
    jeonse: { label: '전세', price: 'jeonse_krw', count: 'jeonse_count' },
    monthly: { label: '월세', price: 'monthly_rent_krw', count: 'monthly_count' }
  });

  function monthlyDeposit(apartment) {
    const area = $('area-select').value;
    const values = (state.market?.records || []).filter((row) => {
      const name = typeof row.apartment === 'string' ? row.apartment.trim() || '단지명 미상' : '단지명 미상';
      const neighborhood = typeof row.neighborhood === 'string' ? row.neighborhood.trim() : '';
      return !row.canceled && row.kind === 'monthly' && numeric(row.monthly_rent_krw) && row.monthly_rent_krw > 0
        && name === apartment.name && neighborhood === apartment.neighborhood
        && numeric(row.area_m2) && (area === 'all' || (area === 'small' && row.area_m2 <= 60)
          || (area === 'medium' && row.area_m2 > 60 && row.area_m2 <= 85) || (area === 'large' && row.area_m2 > 85))
        && numeric(row.deposit_krw) && row.deposit_krw >= 0;
    }).map((row) => row.deposit_krw).sort((a, b) => a - b);
    if (!values.length) return null;
    const middle = Math.floor(values.length / 2);
    const value = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
    // Same ties-to-even integer rounding as the two validated engines.
    const lower = Math.floor(value);
    return value - lower === 0.5 ? (lower % 2 === 0 ? lower : lower + 1) : Math.round(value);
  }

  function apartmentPayload(apartment) {
    const filters = { area_band: $('area-select').value, neighborhood: $('neighborhood-select').value };
    return {
      key: JSON.stringify([state.market.mode, state.region.code, apartment.neighborhood, apartment.name, filters.area_band]),
      apartment: { ...apartment, monthly_deposit_krw: monthlyDeposit(apartment),
        area_label: $('area-select').selectedOptions[0]?.textContent || '전체 면적',
        transaction_type: state.transaction, observed_at: state.market.fetched_at || new Date().toISOString() },
      region: { code: state.region.code, name: state.region.name }, mode: state.market.mode,
      period: state.market.period ? { ...state.market.period } : null, filters
    };
  }

  function apartmentIllustration(index) {
    const NS = 'http://www.w3.org/2000/svg';
    const node = (tag, attrs) => { const result = document.createElementNS(NS, tag); for (const [key, value] of Object.entries(attrs)) result.setAttribute(key, String(value)); return result; };
    const svg = node('svg', { viewBox: '0 0 120 110', class: 'apartment-illustration', 'aria-hidden': 'true' });
    const colors = [['#77bfa4', '#37685e', '#b6e7cf'], ['#9d9bd0', '#545278', '#d1cbef'], ['#c7ae80', '#71634c', '#e7d6b5']][index % 3];
    svg.append(node('path', { d: 'M10 83 56 61 111 82 65 105Z', fill: '#263b38', stroke: 'none' }));
    for (const [x, y, width, height] of [[20, 39, 24, 44], [54, 13, 28, 63], [80, 49, 20, 36]]) {
      svg.append(node('path', { d: `M${x} ${y}l${width} 9v${height}l-${width} -9Z`, fill: colors[0], stroke: 'none' }),
        node('path', { d: `M${x + width} ${y + 9}l12 -6v${height}l-12 6Z`, fill: colors[1], stroke: 'none' }),
        node('path', { d: `M${x} ${y}l12 -6 ${width} 9 -12 6Z`, fill: colors[2], stroke: 'none' }));
      for (let floor = 0; floor < Math.floor(height / 12); floor += 1) {
        for (let column = 0; column < 2; column += 1) {
          const px = x + 6 + column * 9; const py = y + 12 + floor * 11 + column * 3;
          svg.append(node('path', { d: `M${px} ${py}l4 1.4v5l-4 -1.4Z`, fill: '#fff0be', stroke: 'none' }));
        }
      }
    }
    return svg;
  }

  function isApartmentSaved(key) {
    return Boolean(globalThis.DongneShell?.isSaved?.(key) || state.savedKeys.has(key));
  }

  function updateSavedButtons() {
    document.querySelectorAll('.apartment-save[data-save-key]').forEach((button) => {
      const saved = isApartmentSaved(button.dataset.saveKey);
      button.setAttribute('aria-pressed', String(saved));
      button.setAttribute('aria-label', `${button.dataset.apartmentName || '단지'} 관심 ${saved ? '해제' : '저장'}`);
      button.textContent = saved ? '♥' : '♡';
    });
  }

  function renderApartments(apartments) {
    const list = $('apartment-list');
    if (!list) return;
    list.replaceChildren();
    const type = TRANSACTIONS[state.transaction];
    const selected = apartments.filter((apartment) => numeric(apartment[type.price]) && apartment[type.count] > 0)
      .slice().sort((a, b) => b[type.count] - a[type.count] || a.name.localeCompare(b.name, 'ko-KR'));
    hidden('apartment-empty', selected.length > 0);
    text('apartment-empty', `이 지역·면적·기간에 ${type.label} 거래가 있는 단지가 없습니다. 거래 유형이나 검색 조건을 바꿔보세요.`);
    text('market-result-count', `${type.label} 거래가 있는 단지 ${number(selected.length)}곳 · 기간 내 거래 집계`);
    document.querySelectorAll('[data-transaction]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.transaction === state.transaction)));
    for (const [index, apartment] of selected.entries()) {
      const payload = apartmentPayload(apartment);
      const card = element('article', 'apartment-card');
      const top = element('div', 'apartment-card-top');
      top.append(apartmentIllustration(index), element('span', 'apartment-type-label', type.label));
      const main = element('div', 'apartment-card-main');
      const heading = element('div', 'apartment-heading');
      heading.append(element('h3', 'apartment-name', apartment.name || '단지명 미확인'));
      if (state.market.mode === 'demo') heading.append(element('span', 'apartment-demo-label', '가상 단지'));
      else heading.append(element('span', 'apartment-demo-label', '신고 거래'));
      main.append(heading, element('p', 'apartment-meta', `${apartment.neighborhood || '동 정보 없음'} · 전용면적 중앙값 ${numeric(apartment.area_m2) ? `${number(apartment.area_m2, 1)}㎡` : '미확인'}`),
        element('span', 'apartment-price-label', `${type.label} 중앙값`), element('strong', 'apartment-price', money(apartment[type.price])));
      const note = state.transaction === 'monthly'
        ? `보증금 중앙값 ${money(payload.apartment.monthly_deposit_krw)} · 월세 ${number(apartment.monthly_count)}건`
        : `${type.label} ${number(apartment[type.count])}건 · ${payload.apartment.area_label}`;
      main.append(element('p', 'apartment-price-note', note));
      const footer = element('div', 'apartment-card-footer');
      const details = element('button', 'apartment-details', '단지 살펴보기 ↗');
      details.type = 'button'; details.setAttribute('aria-label', `${apartment.name} 거래 상세 보기`);
      details.addEventListener('click', () => emit('lens:apartment', payload));
      const save = element('button', 'apartment-save', '♡');
      save.type = 'button'; save.dataset.saveKey = payload.key; save.dataset.apartmentName = apartment.name;
      save.addEventListener('click', () => emit('lens:save', payload));
      footer.append(details, save); card.append(top, main, footer); list.append(card);
    }
    updateSavedButtons();
  }

  function downloadReport() {
    if (!state.analysis || !state.market) return;
    const report = {
      app: '동네렌즈 퀘스트', version: state.config?.app_version || '0.5.0', runtime: LOCAL_RUNTIME ? 'local' : 'server', generated_at: new Date().toISOString(), mode: state.market.mode,
      disclaimer: state.market.mode === 'demo' ? '모든 거래는 가상 예시입니다. 실제 시세 또는 투자 판단 자료가 아닙니다.' : '신고된 과거 거래자료 기반의 조건 비교이며, 투자 수익·대출 승인·현재 매물 호가를 보장하지 않습니다.',
      region: state.region, period: state.market.period, source: state.market.source, fetched_at: state.market.fetched_at, coverage: state.market.coverage,
      filters: { area_band: $('area-select').value, neighborhood: $('neighborhood-select').value }, assumptions: state.assumptions, analysis: state.analysis
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = element('a'); link.href = url; link.download = `dongne-lens-${state.region.code}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('입력 가정과 출처를 포함한 분석 결과를 저장했습니다.');
  }

  async function shareView() {
    if (!state.market) return;
    // A local file address is unusable to other people and may reveal a device path.
    if (!['https:', 'http:'].includes(window.location.protocol)) {
      text('share-help', '파일로 연 체험은 공유 주소가 없습니다. 분석 저장으로 결과를 보관하거나, 배포된 앱에서 화면 링크를 이용해 주세요. 기기의 파일 경로는 복사하지 않았습니다.');
      hidden('share-help', false);
      toast('이 파일에는 공유 주소가 없습니다. 분석 저장을 이용해 주세요.');
      return;
    }
    hidden('share-help', true);
    const url = new URL(window.location.href);
    url.search = ''; url.hash = 'market';
    url.searchParams.set('region', state.region.code);
    url.searchParams.set('months', $('period-select').value);
    url.searchParams.set('area', $('area-select').value);
    url.searchParams.set('mode', state.market.mode);
    if ($('neighborhood-select').value) url.searchParams.set('dong', $('neighborhood-select').value);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(url.href);
      toast('지역·조회조건 링크를 복사했습니다. 예산과 자기자금은 포함하지 않습니다.');
    } catch {
      const focused = document.activeElement;
      const input = element('textarea'); input.value = url.href; input.readOnly = true; input.setAttribute('aria-label', '복사할 지역 조회 링크'); input.style.position = 'fixed'; input.style.opacity = '0';
      document.body.append(input); input.select();
      let copied = false;
      try { copied = document.execCommand('copy'); } catch { /* Clipboard permissions can be unavailable in embedded previews. */ }
      input.remove();
      if (focused?.isConnected && typeof focused.focus === 'function') focused.focus({ preventScroll: true });
      if (copied) toast('지역·조회조건 링크를 복사했습니다. 자금 입력값은 포함하지 않습니다.');
      else {
        const link = element('a', 'manual-share-url', url.href);
        link.href = url.href;
        $('share-help')?.replaceChildren(element('span', '', '자동 복사를 사용할 수 없습니다. 아래 주소를 길게 눌러 복사하거나 분석 저장을 이용해 주세요.'), link);
        hidden('share-help', false);
        toast('복사할 주소를 화면에 표시했습니다. 현재 화면은 유지됩니다.');
      }
    }
  }

  function bind() {
    $('search-form').addEventListener('submit', (event) => {
      event.preventDefault();
      search($('region-input').value);
    });
    for (const id of ['period-select', 'mode-select']) $(id).addEventListener('change', () => { if (state.region) loadMarket(state.region, $('neighborhood-select').value); });
    for (const id of ['area-select', 'neighborhood-select']) $(id).addEventListener('change', analyze);
    $('scenario-form').addEventListener('submit', (event) => { event.preventDefault(); clearTimeout(state.timer); analyze(); });
    for (const id of ['budget-input', 'equity-input', 'rate-input']) $(id).addEventListener('input', () => {
      updateInputEchoes();
      clearTimeout(state.timer);
      // Invalidate a previous response immediately, before the debounce finishes.
      ++state.analysisSequence;
      state.analysisController?.abort();
      state.analyzing = false;
      state.analysis = null;
      window.dispatchEvent(new CustomEvent('lens:clear', { detail: { reason: '입력값 반영 대기' } }));
      for (const resultId of ['fit-score', 'payment-value', 'stress-value', 'cashflow-value', 'return-gap-value']) text(resultId, '—');
      $('fit-components')?.replaceChildren();
      $('fit-reasons')?.replaceChildren();
      text('fit-label', '입력값 반영 대기');
      updateBusy();
      state.timer = setTimeout(analyze, 450);
    });
    $('reset-button').addEventListener('click', (event) => {
      event.preventDefault(); clearTimeout(state.timer);
      $('budget-input').value = String(DEFAULTS.budget_krw / 10000); $('equity-input').value = String(DEFAULTS.equity_krw / 10000); $('rate-input').value = String(DEFAULTS.loan_rate_pct);
      updateInputEchoes(); analyze();
    });
    $('download-button').addEventListener('click', downloadReport);
    $('share-button').addEventListener('click', shareView);
    // Delegate quick-search chips so newly rendered home cards work as well.
    document.addEventListener('click', (event) => {
      const button = event.target.closest?.('[data-region-query]');
      if (button) { event.preventDefault(); search(button.dataset.regionQuery); }
      const transaction = event.target.closest?.('[data-transaction]');
      if (transaction && Object.hasOwn(TRANSACTIONS, transaction.dataset.transaction)) {
        state.transaction = transaction.dataset.transaction;
        renderApartments(state.analysis?.apartments || []);
      }
    });
    window.addEventListener('lens:saved-changed', (event) => {
      state.savedKeys = new Set((Array.isArray(event.detail?.keys) ? event.detail.keys : []).filter((key) => typeof key === 'string'));
      updateSavedButtons();
    });
  }

  async function init() {
    if (LOCAL_RUNTIME) {
      document.body.dataset.runtime = 'local';
      text('runtime-label', '설치 없는 체험 · 모든 거래는 가상 예시');
      document.querySelector('.brand')?.setAttribute('href', '#top');
      $('share-button')?.setAttribute('aria-describedby', 'share-help');
    }
    bind(); updateInputEchoes(); updateBusy();
    try {
      const [config, response] = await Promise.all([request('/api/config'), request('/api/regions')]);
      if (!Array.isArray(response.regions) || !response.regions.length) throw new Error('지원 지역 목록을 읽지 못했습니다. 서버 설정을 확인해 주세요.');
      state.config = config; state.regions = response.regions; fillRegionOptions();
      settleReady({ ok: true });
      emit('lens:ready', { regions: state.regions, config });
      const liveOption = [...$('mode-select').options].find((option) => option.value === 'live');
      if (liveOption) { liveOption.disabled = LOCAL_RUNTIME || !config.live_available; liveOption.textContent = LOCAL_RUNTIME ? '공식 자료 · 서버 버전에서 조회' : config.live_available ? '공식 거래자료' : '공식 자료 · API 키 설정 필요'; }
      const params = new URLSearchParams(window.location.search);
      const regionCode = params.get('region');
      const region = regionCode ? state.regions.find((item) => item.code === regionCode) : state.regions.find((item) => item.code === '11680') || state.regions[0];
      if (!region) throw new Error('링크에 포함된 지역은 현재 지원하지 않습니다. 지역명을 다시 선택해 주세요.');
      const months = params.get('months'); if (['3', '6', '12'].includes(months)) $('period-select').value = months;
      const area = params.get('area'); if (['all', 'small', 'medium', 'large'].includes(area)) $('area-select').value = area;
      state.region = region; $('region-input').value = region.name;
      const requestedMode = params.get('mode');
      if (requestedMode === 'live' && (LOCAL_RUNTIME || !config.live_available)) {
        $('mode-select').value = 'demo'; modePresentation('demo');
        throw new Error(LOCAL_RUNTIME ? '공식 자료 링크입니다. 설치 없는 체험에서는 실제 자료를 조회하지 않았습니다. 가상 예시로 체험하려면 지역 검색을 누르거나, API 키를 설정한 서버 버전을 이용해 주세요.' : '공식 자료 링크입니다. 이 서버에는 MOLIT_SERVICE_KEY가 없어 조회하지 않았습니다. 예시 모드를 선택한 뒤 지역 검색을 누르면 체험할 수 있습니다.');
      }
      $('mode-select').value = requestedMode === 'live' ? 'live' : 'demo';
      await loadMarket(region, params.get('dong') || '');
    } catch (error) {
      settleReady({ ok: false, message: error.message });
      showError(error.message);
    }
  }

  globalThis.DongneApp = Object.freeze({
    search,
    notify: toast,
    // Dismissing a search or leaving its screen invalidates that navigation
    // intent, even if the sheet is reopened before its data request finishes.
    cancelPendingNavigation: () => { state.searchSequence += 1; },
    getApartmentPayload: (apartment, { transaction = 'sale' } = {}) => {
      const current = state.analysis?.apartments?.find((item) => item.name === apartment?.name && item.neighborhood === apartment?.neighborhood);
      if (!current || !state.market) return null;
      const payload = apartmentPayload(current);
      payload.apartment.transaction_type = Object.hasOwn(TRANSACTIONS, transaction) ? transaction : 'sale';
      return payload;
    },
    getSnapshot: () => ({ market: state.market, analysis: state.analysis, assumptions: { ...state.assumptions },
      filters: { area_band: $('area-select')?.value || 'all', neighborhood: $('neighborhood-select')?.value || '' },
      regions: state.regions, config: state.config })
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
