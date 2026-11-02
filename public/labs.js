/* Two small decision experiments. All selections stay in this page's memory. */
(() => {
  'use strict';
  const mixHost = document.getElementById('mix-lab');
  const blindHost = document.getElementById('blind-lab');
  if (!mixHost || !blindHost) return;
  const mixRoot = document.createElement('div');
  const blindRoot = document.createElement('div');
  // Keep live regions mounted while interactive content is replaced.
  for (const [host, root] of [[mixHost, mixRoot], [blindHost, blindRoot]]) {
    const live = document.createElement('p');
    live.className = 'sr-only lab-live'; live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');
    host.replaceChildren(root, live);
  }

  const state = { sequence: 0, controller: null, exampleController: null, exampleSequence: 0, context: null, result: null, example: null, useExample: false, adjusted: false, loading: false, error: '', exampleError: '', exampleLoading: false, selected: null, firstChoice: null, stage: 'blind' };
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const num = (value, digits = 1) => finite(value) ? value.toLocaleString('ko-KR', { maximumFractionDigits: digits }) : '—';
  const money = (value) => !finite(value) ? '자료 부족' : value >= 100000000 ? `${num(value / 100000000, 2)}억` : `${num(value / 10000, 0)}만원`;
  const percent = (value) => !finite(value) ? '자료 부족' : `${value > 0 ? '+' : value < 0 ? '−' : ''}${num(Math.abs(value), 1)}%`;
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  };
  const button = (label, className, onClick) => {
    const node = make('button', className, label);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  };
  const append = (parent, ...children) => { parent.append(...children); return parent; };
  const badge = (label, className = '') => make('span', `lab-badge ${className}`, label);
  function announce(root, text) {
    const node = root.parentElement.querySelector('.lab-live');
    if (node) node.textContent = text;
  }
  function focusAfterRender(root, selector) {
    const node = root.querySelector(selector);
    if (node) node.focus({ preventScroll: true });
  }
  function sourceText() {
    if (!state.context) return '지역 선택 후 시작';
    const market = state.context.market;
    const name = state.context.filters.neighborhood || market.region?.name || '선택 지역';
    return `${name} · ${market.mode === 'demo' ? '가상 예시' : '신고 거래자료'}`;
  }
  function heading(number, title, subtitle, isDark = false) {
    const node = make('div', 'lab-heading');
    const text = make('div', 'lab-heading-copy');
    append(text, make('span', 'lab-eyebrow', `EXPERIMENT ${number}`), make('h3', '', title), make('p', '', subtitle));
    append(node, text, make('span', `lab-emblem ${isDark ? 'lab-emblem-mix' : 'lab-emblem-blind'}`, isDark ? '≋' : '⌂'));
    node.lastElementChild.setAttribute('aria-hidden', 'true');
    return node;
  }
  function statusBox(message, kind = '') {
    const node = make('div', `lab-empty ${kind}`, message);
    node.setAttribute('role', 'status');
    return node;
  }
  function coverageNotice(root) {
    if (state.context?.market?.coverage?.partial) {
      root.append(make('p', 'lab-coverage-note', '일부 공식 조회가 누락되었습니다. 비교와 후보는 가져온 거래만 사용하며, 누락 자료에 따라 결과가 달라질 수 있어요.'));
    }
  }
  async function fetchJSON(url, options) {
    if (globalThis.DONGNE_RUNTIME === 'local') {
      if (typeof globalThis.DongneLocal?.request !== 'function') throw new Error('설치 없는 체험 파일이 완전하지 않습니다. 최신 play.html 전체 파일을 다시 열어 주세요.');
      return globalThis.DongneLocal.request(url, options);
    }
    const response = await fetch(url, { cache: 'no-store', ...options });
    let data;
    try { data = await response.json(); } catch { throw new Error('체험 자료를 읽지 못했습니다. 다시 조회해 주세요.'); }
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || '체험 자료를 불러오지 못했습니다.');
    return data;
  }

  function renderMix() {
    mixHost.className = 'lab-card mix-lab-card';
    mixRoot.replaceChildren();
    append(mixRoot, heading('01', '가격 착시 탐정', '가격이 달라진 걸까, 거래된 집이 달라진 걸까?', true));
    const toolbar = make('div', 'lab-toolbar');
    const tabs = make('div', 'lab-switch');
    tabs.setAttribute('role', 'group');
    tabs.setAttribute('aria-label', '가격 착시 탐정 자료 선택');
    const current = button('내가 고른 동네', `lab-switch-button ${!state.useExample ? 'active' : ''}`, () => { ++state.exampleSequence; state.exampleController?.abort(); state.exampleLoading = false; state.useExample = false; state.adjusted = false; state.exampleError = ''; renderMix(); focusAfterRender(mixRoot, '.lab-current-button'); });
    current.classList.add('lab-current-button');
    current.setAttribute('aria-pressed', String(!state.useExample));
    const example = button(state.exampleLoading ? '예제 준비 중…' : '착시 예제 체험', `lab-switch-button ${state.useExample ? 'active' : ''}`, loadExample);
    example.classList.add('lab-example-button');
    example.setAttribute('aria-pressed', String(state.useExample));
    // Keep the initiating control in the tab order while its request is pending.
    example.setAttribute('aria-disabled', String(state.exampleLoading));
    append(tabs, current, example);
    append(toolbar, tabs, badge(state.useExample ? '착시 연습용 가상 예제' : sourceText(), 'lab-source-badge'));
    mixRoot.append(toolbar);
    if (!state.useExample) coverageNotice(mixRoot);
    if (state.exampleError) mixRoot.append(statusBox(state.exampleError, 'lab-error'));
    const mix = state.useExample ? state.example : state.result?.mix;
    if (!mix) {
      mixRoot.append(statusBox(state.loading && !state.useExample ? '선택한 거래의 구성을 살펴보는 중입니다…' : state.error || '동네를 조회하면 두 시기의 거래 구성을 비교합니다. 가상 예제로 먼저 체험할 수도 있어요.'));
      mixRoot.append(make('p', 'lab-footnote', '실제 매물이나 미래 가격을 예측하는 기능이 아닙니다.'));
      return;
    }
    const body = make('div', 'mix-workbench');
    const story = make('div', 'mix-story');
    append(story, make('span', 'lab-step', state.adjusted ? 'STEP 02 · 구성을 맞추면' : 'STEP 01 · 겉으로 보이는 변화'), make('h4', '', state.adjusted ? '비교의 기준도 살펴보세요.' : '숫자 하나로 판단하기 전에.'), make('p', '', state.useExample ? '작은 집과 큰 집의 가격은 그대로인데, 큰 집이 더 많이 팔렸다면 중앙값은 어떻게 보일까요?' : '두 시기의 전체 거래와, 두 시기에 모두 거래된 같은 동·단지·면적 구간을 나란히 봅니다.'));
    const ready = mix.status === 'ready' && finite(mix.matched_change_pct);
    const reveal = button(state.adjusted ? '전체 변화부터 다시 보기 ↺' : '구성을 맞춰 비교하기 →', 'lab-action mix-reveal', () => {
      state.adjusted = !state.adjusted; renderMix(); focusAfterRender(mixRoot, '.mix-reveal');
      announce(mixRoot, state.adjusted ? `구성을 맞춘 변화 ${percent(mix.matched_change_pct)}. 동일 주택의 변동률은 아닙니다.` : '전체 거래 변화부터 다시 살펴봅니다.');
    });
    reveal.disabled = !ready;
    append(story, reveal, make('p', 'mix-action-note', ready ? '단지·면적별 과거 거래 비중을 고정해 비교합니다.' : '비교 표본 부족 · 12개월 또는 전체 면적으로 넓혀보세요.'));
    const comparison = make('div', 'mix-comparison');
    append(comparison, mixMetric('전체 거래의 변화', mix.raw_change_pct, mix.before?.median_krw, mix.after?.median_krw, false, true), mixMetric('구성을 맞춘 변화', mix.matched_change_pct, mix.matched_before_krw, mix.matched_after_krw, true, state.adjusted || !ready));
    append(body, story, comparison); mixRoot.append(body);
    const windows = make('div', 'mix-windows');
    for (const [label, period] of [['이전 시기', mix.before], ['이후 시기', mix.after]]) {
      const item = make('div', 'mix-window');
      append(item, make('span', '', label), make('strong', '', period?.start && period?.end ? `${period.start} – ${period.end}` : '기간 자료 부족'), make('small', '', `${num(period?.count, 0)}건 · 매매 거래`)); windows.append(item);
    }
    mixRoot.append(windows);
    const insight = make('div', 'mix-takeaway');
    append(insight, make('span', 'lab-note-mark', '↳'), make('p', '', !ready ? '두 시기 각각 2건 이상 거래된 비교 구간이 2개 이상 필요합니다. 표본이 없으면 변화율을 0%로 채우지 않습니다.' : state.adjusted ? (mix.explanation || '전체 거래와 구성 고정 비교는 다른 표본과 계산 기준을 사용합니다. 차이만으로 가격 변화의 원인을 확정할 수 없습니다.') : '오른쪽 비교를 열어, 거래 구성을 맞췄을 때도 비슷한 변화가 나타나는지 확인해 보세요.'));
    mixRoot.append(insight);
    const details = make('details', 'lab-details');
    append(details, make('summary', '', `계산 근거 보기 · 비교 구간 ${num(mix.matched_cohorts, 0)}개`));
    const detailsBody = make('div', 'lab-details-body');
    append(detailsBody, make('p', '', `비교에 포함된 매매: 이전 ${num(mix.matched_before_count, 0)}건 (${num(mix.coverage_pct?.before)}%), 이후 ${num(mix.matched_after_count, 0)}건 (${num(mix.coverage_pct?.after)}%).`), make('p', '', mix.methodology || '동·단지·5㎡ 면적 구간별 중앙값에 이전 시기의 거래 건수 비중을 적용합니다.'));
    if (mix.cohorts?.length) {
      const scroll = make('div', 'lab-table-scroll');
      scroll.tabIndex = 0;
      scroll.setAttribute('aria-label', '비교 구간 상세, 좁은 화면에서는 좌우로 스크롤');
      const table = make('table', 'lab-table');
      const head = make('thead'); const tr = make('tr');
      ['비교 구간', '이전 / 이후 건수', '구간별 변화', '이전 비중'].forEach((label) => { const th = make('th', '', label); th.scope = 'col'; tr.append(th); }); head.append(tr); table.append(head);
      const tbody = make('tbody');
      mix.cohorts.forEach((cohort) => {
        const row = make('tr');
        [ `${cohort.neighborhood} ${cohort.name} · ${num(cohort.area_min_m2, 0)}–${num(cohort.area_max_m2, 0)}㎡ 미만`, `${num(cohort.before_count, 0)} / ${num(cohort.after_count, 0)}`, percent(cohort.change_pct), `${num(cohort.weight_pct)}%` ].forEach((value) => row.append(make('td', '', value)));
        tbody.append(row);
      }); table.append(tbody); append(scroll, table); detailsBody.append(scroll);
    }
    for (const limitation of mix.limitations || []) detailsBody.append(make('p', 'lab-limitation', limitation));
    append(details, detailsBody); mixRoot.append(details);
    mixRoot.append(make('p', 'lab-footnote', '같은 주택의 가격지수가 아닙니다. 층·향·상태 등의 차이와 신고 지연이 남아 있습니다.'));
  }

  function mixMetric(label, change, before, after, adjusted, visible) {
    const card = make('div', `mix-metric ${adjusted ? 'mix-adjusted' : 'mix-raw'} ${!visible ? 'mix-locked' : ''}`);
    append(card, make('span', 'mix-metric-label', label), make('strong', 'mix-change', visible ? percent(change) : '•••'), make('span', 'mix-metric-caption', visible ? (finite(change) ? '이전 시기 대비' : '비교 표본 부족') : '비교를 열어보세요'));
    const visual = make('div', 'mix-mini-buildings'); visual.setAttribute('aria-hidden', 'true');
    append(visual, make('span', 'mix-building mix-building-small'), make('span', 'mix-building mix-building-medium'), make('span', 'mix-building mix-building-tall')); card.append(visual);
    append(card, make('p', 'mix-metric-prices', visible && finite(before) && finite(after) ? `${money(before)} → ${money(after)}` : adjusted && !visible ? '같은 구간 · 같은 거래 비중' : '자료가 모이면 비교합니다'));
    return card;
  }

  async function loadExample(event) {
    if (state.exampleLoading) return;
    const ownsFocus = document.activeElement === event?.currentTarget;
    if (state.example) {
      state.useExample = true; state.adjusted = false; renderMix();
      if (ownsFocus) focusAfterRender(mixRoot, '.lab-example-button');
      return;
    }
    const sequence = ++state.exampleSequence;
    state.exampleController?.abort(); state.exampleController = new AbortController();
    state.exampleLoading = true; state.exampleError = ''; renderMix();
    if (ownsFocus) focusAfterRender(mixRoot, '.lab-example-button');
    try {
      const data = await fetchJSON('/api/insights/example', { signal: state.exampleController.signal });
      if (sequence !== state.exampleSequence) return;
      state.example = data.mix; state.useExample = true; state.adjusted = false;
    } catch (error) {
      if (sequence !== state.exampleSequence || error.name === 'AbortError') return;
      state.exampleError = error.message;
    } finally {
      if (sequence === state.exampleSequence) {
        const restoreFocus = document.activeElement === mixRoot.querySelector('.lab-example-button');
        state.exampleLoading = false; renderMix();
        if (restoreFocus) focusAfterRender(mixRoot, '.lab-example-button');
      }
    }
  }

  function renderBlind() {
    blindHost.className = 'lab-card blind-lab-card'; blindRoot.replaceChildren();
    append(blindRoot, heading('02', '주소 블라인드 선택실험', '동네 이름을 잠깐 가리면, 어떤 집이 눈에 들어올까요?'));
    const toolbar = make('div', 'lab-toolbar');
    const steps = make('div', 'blind-steps'); steps.setAttribute('aria-label', '선택실험 단계');
    ['조건만 보고 선택', '이름 공개', '선택 돌아보기'].forEach((label, index) => append(steps, make('span', `blind-step ${index === (state.stage === 'blind' ? 0 : state.stage === 'done' ? 2 : 1) ? 'active' : ''}`, `${index + 1}. ${label}`)));
    append(toolbar, steps, badge(sourceText())); blindRoot.append(toolbar);
    coverageNotice(blindRoot);
    const data = state.result?.blind;
    if (!data || data.status !== 'ready' || data.candidates?.length < 2) {
      blindRoot.append(statusBox(state.loading ? '이름을 가릴 비교 후보를 준비하고 있어요…' : state.error || '각각 매매 2건 이상인 비교 후보가 2개 이상 필요합니다. 전체 면적이나 더 긴 조회 기간을 선택해 보세요.'));
      blindRoot.append(make('p', 'lab-footnote', '단지·5㎡ 면적 구간별 거래 요약입니다. 현재 판매 중인 집이 아닙니다.'));
      return;
    }
    const revealed = state.stage !== 'blind';
    const candidates = make('div', 'blind-candidates');
    data.candidates.forEach((candidate, index) => {
      const selected = candidate.id === state.selected;
      const card = make('article', `blind-candidate ${selected ? 'is-selected' : ''}`);
      const top = make('div', 'blind-card-top');
      append(top, make('span', 'blind-letter', String.fromCharCode(65 + index)), badge(selected ? '내 선택' : '거래 요약', selected ? 'selected-badge' : ''));
      const name = make('h4', 'blind-name', revealed ? candidate.name : `이름을 가린 집 ${String.fromCharCode(65 + index)}`);
      const location = make('p', `blind-location ${!revealed ? 'is-masked' : ''}`, revealed ? candidate.neighborhood : '주소는 선택 후 공개됩니다');
      append(card, top, name, location);
      const metrics = make('dl', 'blind-facts');
      for (const [label, value] of [['매매 중앙값', money(candidate.sale_krw)], ['거래 면적 중앙값', `${num(candidate.area_m2)}㎡`], ['매매 표본', `${num(candidate.sale_count, 0)}건`]]) {
        append(metrics, append(make('div'), make('dt', '', label), make('dd', '', value)));
      }
      card.append(metrics);
      card.append(make('p', 'blind-period', `${candidate.first_date} – ${candidate.last_date}`));
      if (state.stage === 'blind' || state.stage === 'rechoose') {
        const select = button(state.stage === 'blind' ? '이 조건의 집 선택 →' : selected ? '지금 선택 유지' : '이 집으로 바꾸기 →', 'lab-action blind-pick', () => choose(candidate.id));
        select.setAttribute('aria-label', `${String.fromCharCode(65 + index)}번 ${state.stage === 'blind' ? '집 선택' : candidate.name + ' 선택'}`);
        card.append(select);
      } else {
        card.append(make('span', 'blind-card-state', selected ? '✓ 내가 고른 조건' : '함께 비교한 조건'));
      }
      candidates.append(card);
    }); blindRoot.append(candidates);
    if (state.stage === 'blind') {
      const areas = data.candidates.map((candidate) => candidate.area_m2).filter(finite);
      blindRoot.append(make('p', 'blind-invitation', areas.length > 1 && Math.max(...areas) - Math.min(...areas) < 5 ? '면적 차이가 작은 후보들입니다. 다양한 크기를 비교하려면 전체 면적으로 넓혀보세요.' : '정답은 없습니다. 가격과 공간 중 지금 나에게 더 중요한 조건을 골라보세요.'));
    } else {
      const reflection = make('div', 'blind-reflection'); reflection.tabIndex = -1;
      reflection.setAttribute('aria-label', '선택 돌아보기');
      const candidate = data.candidates.find((item) => item.id === state.selected);
      const lowPrice = Math.min(...data.candidates.map((item) => item.sale_krw));
      const largest = Math.max(...data.candidates.map((item) => item.area_m2));
      let fact = `선택한 집의 거래 중앙값은 ${money(candidate.sale_krw)}, 면적 중앙값은 ${num(candidate.area_m2)}㎡입니다.`;
      if (candidate.sale_krw === lowPrice) fact += ' 제시된 후보 중 거래 중앙값이 가장 낮습니다.';
      else if (candidate.area_m2 === largest) fact += ' 제시된 후보 중 면적 중앙값이 가장 큽니다.';
      else fact += ' 후보마다 가격과 공간의 조건이 다릅니다.';
      append(reflection, make('span', 'lab-eyebrow', 'THE REVEAL'), make('h4', '', state.stage === 'done' ? (state.selected === state.firstChoice ? '이름을 봐도, 내 선택은 같았어요.' : '이름을 보고 선택을 바꿨어요.') : state.stage === 'rechoose' ? '이름을 확인한 채 다시 골라보세요.' : '이름을 본 뒤에도 이 집을 고르겠어요?'), make('p', '', fact));
      if (state.stage === 'reveal') {
        const actions = make('div', 'blind-reflection-actions');
        append(actions, button('선택 유지하기', 'lab-action', () => { state.stage = 'done'; renderBlind(); focusAfterRender(blindRoot, '.blind-reflection'); }), button('다시 선택하기', 'lab-action lab-action-secondary', () => { state.stage = 'rechoose'; renderBlind(); focusAfterRender(blindRoot, '.blind-pick'); }));
        reflection.append(actions);
      }
      if (state.stage === 'done') {
        reflection.append(make('p', 'blind-reflection-note', '선택에 옳고 그름은 없습니다. 이름을 보고 떠오른 이유를 실제 교통·환경·현장 상태와 함께 확인해 보세요.'));
        reflection.append(button('처음부터 다시 체험 ↺', 'lab-text-button blind-reset', () => { resetChoice(); renderBlind(); focusAfterRender(blindRoot, '.blind-pick'); }));
      }
      blindRoot.append(reflection);
    }
    const details = make('details', 'lab-details');
    append(details, make('summary', '', `어떤 후보를 보여주나요? · 조건을 충족한 구간 ${num(data.eligible_cohorts, 0)}개`));
    const notes = make('div', 'lab-details-body');
    notes.append(make('p', '', data.explanation || '단지·5㎡ 면적 구간별 과거 거래 중 표본이 있는 후보를 비교합니다.'));
    for (const limitation of data.limitations || []) notes.append(make('p', '', limitation));
    append(details, notes); blindRoot.append(details);
    blindRoot.append(make('p', 'lab-footnote', '현재 매물·투자 추천·성향 진단이 아닙니다. 선택 기록은 이 페이지 안에서만 유지됩니다.'));
  }

  function choose(id) {
    if (state.stage === 'blind') { state.firstChoice = id; state.stage = 'reveal'; }
    else state.stage = 'done';
    state.selected = id;
    renderBlind(); focusAfterRender(blindRoot, '.blind-reflection');
    announce(blindRoot, '집의 이름과 동네를 공개했습니다. 선택을 돌아보세요.');
  }
  function resetChoice() { state.selected = null; state.firstChoice = null; state.stage = 'blind'; }
  function clear() {
    ++state.sequence; state.controller?.abort();
    ++state.exampleSequence; state.exampleController?.abort();
    state.context = null; state.result = null; state.loading = false; state.error = ''; state.useExample = false; state.adjusted = false; state.exampleLoading = false; state.exampleError = ''; resetChoice();
    renderMix(); renderBlind();
  }
  async function receive(event) {
    const context = event.detail;
    if (!context?.market?.records || !context.filters) return;
    const sequence = ++state.sequence;
    state.controller?.abort(); state.controller = new AbortController();
    ++state.exampleSequence; state.exampleController?.abort(); state.exampleLoading = false; state.exampleError = '';
    state.context = context; state.result = null; state.loading = true; state.error = ''; state.useExample = false; state.adjusted = false; resetChoice();
    renderMix(); renderBlind();
    try {
      const data = await fetchJSON('/api/insights', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: state.controller.signal, body: JSON.stringify({ records: context.market.records, area_band: context.filters.area_band, neighborhood: context.filters.neighborhood, period: context.market.period }) });
      if (sequence !== state.sequence) return;
      state.result = data;
    } catch (error) {
      if (sequence !== state.sequence || error.name === 'AbortError') return;
      state.error = `체험 자료 조회 실패 · ${error.message}`;
    } finally {
      if (sequence === state.sequence) { state.loading = false; renderMix(); renderBlind(); }
    }
  }
  window.addEventListener('lens:analysis', receive);
  window.addEventListener('lens:clear', clear);
  renderMix(); renderBlind();
})();
