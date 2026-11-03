/* Pure scenario model: never writes to a candidate or to market records. */
globalThis.DongnePriceChoice = {
  price(base, discount) {
    if (!Number.isSafeInteger(base) || base <= 0 || !Number.isInteger(discount) || discount < 0 || discount > 30) return null;
    const assumed = Math.round(base * (100 - discount) / 100);
    return { base, assumed, discount, difference: base - assumed };
  },
  create() {
    return {
      b: null, discount: 0, decision: null,
      reset(b = null) { this.b = b; this.discount = 0; this.decision = null; },
      adjust(value) {
        if (!Number.isInteger(value) || value < 0 || value > 30) return false;
        this.discount = value; this.decision = null; return true;
      },
      confirm(choice, base) {
        const quote = globalThis.DongnePriceChoice.price(base, this.discount);
        if (!this.b || !quote || !['a', 'b', 'unsure'].includes(choice)) return false;
        this.decision = Object.freeze({ choice, b: this.b, ...quote }); return true;
      }
    };
  }
};
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
  const scenario = globalThis.DongnePriceChoice.create();
  let priceStage = 'invite';
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
    announce(blindRoot, '');
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
    if (state.stage === 'done') renderPriceChoice(data.candidates);
    const details = make('details', 'lab-details');
    append(details, make('summary', '', `어떤 후보를 보여주나요? · 조건을 충족한 구간 ${num(data.eligible_cohorts, 0)}개`));
    const notes = make('div', 'lab-details-body');
    notes.append(make('p', '', data.explanation || '단지·5㎡ 면적 구간별 과거 거래 중 표본이 있는 후보를 비교합니다.'));
    for (const limitation of data.limitations || []) notes.append(make('p', '', limitation));
    append(details, notes); blindRoot.append(details);
    blindRoot.append(make('p', 'lab-footnote', '현재 매물·투자 추천·성향 진단이 아닙니다. 선택 기록은 이 페이지 안에서만 유지됩니다.'));
  }

  function renderPriceChoice(candidates) {
    const panel = make('section', 'price-lab');
    panel.setAttribute('aria-label', '내 선택의 가격');
    append(panel, make('span', 'lab-eyebrow', 'PRICE PLAY · 선택의 다음 장'), make('h4', '', '내 선택의 가격'));
    blindRoot.append(panel);
    const refresh = (selector = '.price-title') => { renderBlind(); focusAfterRender(blindRoot, selector); };
    if (priceStage !== 'active') {
      panel.append(make('p', '', priceStage === 'skip' ? '가격 실험은 건너뛰었어요. 원할 때 이어갈 수 있습니다.' : '주소를 확인한 내 선택, 가격 조건만 달라져도 같을까요?'));
      append(panel, button('가격이 달라지면 내 선택도 바뀔까?', 'lab-action price-start', () => { priceStage = 'active'; refresh(); }));
      if (priceStage !== 'skip') panel.append(button('이번에는 건너뛰기', 'lab-text-button', () => { priceStage = 'skip'; refresh('.price-start'); }));
      return;
    }
    const title = make('p', 'price-title', '최종 선택은 A, 다시 비교할 집은 B');
    title.tabIndex = -1; panel.append(title);
    append(panel, badge(sourceText()), make('p', 'lab-footnote', '가격만 바꾸는 가정 실험입니다. 실제 적정가·투자 추천·심리 진단·정확한 선택 전환점이 아닙니다. 원본 거래·관심집·자금계획에는 반영하지 않습니다.'));
    const a = candidates.find(item => item.id === state.selected);
    if (!a || !globalThis.DongnePriceChoice.price(a.sale_krw, 0)) {
      panel.append(statusBox('A의 기준 가격이 유효하지 않아 가격 실험을 진행할 수 없습니다.')); return;
    }
    const others = candidates.filter(item => item.id !== a.id);
    const label = make('label', 'price-label', '비교할 후보 B');
    label.htmlFor = 'price-candidate';
    const select = make('select', 'price-select'); select.id = 'price-candidate';
    const placeholder = make('option', '', '다른 후보를 골라주세요'); placeholder.value = ''; select.append(placeholder);
    others.forEach(item => {
      const option = make('option', '', `${item.name} · ${num(item.area_m2)}㎡`);
      option.value = item.id; select.append(option);
    });
    select.value = scenario.b || '';
    select.addEventListener('change', () => { scenario.reset(select.value || null); refresh('#price-candidate'); });
    append(panel, label, select);
    if (!others.length) { panel.append(statusBox('비교할 다른 후보가 부족합니다. 조회 조건을 넓혀주세요.')); return; }
    const b = others.find(item => item.id === scenario.b);
    if (!b) { panel.append(statusBox('B를 고르면 0~30% 가격 시나리오를 시작합니다.')); return; }
    if (!globalThis.DongnePriceChoice.price(b.sale_krw, 0)) { panel.append(statusBox('B의 기준 가격이 유효하지 않습니다. 다른 후보를 골라주세요.')); return; }
    const exact = value => `${value.toLocaleString('ko-KR')}원`;
    const grid = make('div', 'price-cards');
    let priceNode, differenceNode, discountNode;
    const cards = [];
    for (const [letter, item] of [['A', a], ['B', b]]) {
      const card = make('article', 'price-card'); cards.push(card);
      const mark = make('span', 'price-mark', letter === 'A' ? 'A · 주소 공개 후 선택' : 'B · 가격을 바꿔볼 후보');
      append(card, mark, make('h5', '', item.name), make('p', 'price-location', item.neighborhood));
      const facts = make('dl', 'price-facts');
      const fact = (key, value, cls = '') => {
        const dd = make('dd', cls, value); append(facts, append(make('div'), make('dt', '', key), dd)); return dd;
      };
      fact('원래 기준 가격 · 매매 중앙값', exact(item.sale_krw));
      if (letter === 'B') {
        priceNode = fact('조절한 가정 가격 · 실제 가격 아님', '', 'price-number');
        discountNode = fact('가정 할인율', '');
        differenceNode = fact('기준 대비 차액', '');
      }
      fact('기존 면적 중앙값 / 매매 표본', `${num(item.area_m2)}㎡ / ${num(item.sale_count, 0)}건`);
      fact('데이터 출처', `${sourceText()} · ${state.context.market.source?.label || '거래 집계'}`);
      fact('거래 기간', `${item.first_date} – ${item.last_date}`);
      append(card, facts, make('p', 'price-selection', '아직 가격 선택을 확정하지 않았어요')); grid.append(card);
    }
    panel.append(grid);
    const controls = make('div', 'price-controls');
    const rangeLabel = make('label', 'price-label', 'B의 가정 할인율'); rangeLabel.htmlFor = 'price-discount';
    const output = make('output', 'price-discount-value'); output.htmlFor = 'price-discount';
    const range = make('input', 'price-range'); range.type = 'range'; range.id = 'price-discount'; range.min = '0'; range.max = '30'; range.step = '1';
    const minus = button('−', 'price-step', () => change(scenario.discount - 1)); minus.setAttribute('aria-label', '할인율 1% 줄이기');
    const plus = button('+', 'price-step', () => change(scenario.discount + 1)); plus.setAttribute('aria-label', '할인율 1% 늘리기');
    const row = append(make('div', 'price-slider-row'), minus, range, plus);
    append(controls, rangeLabel, output, row, make('p', 'lab-footnote', '0% 그대로 ↔ 30% 낮게 · 1%씩 조절 / 버튼을 눌러야 선택이 확정됩니다.'));
    panel.append(controls);
    const actions = make('div', 'price-actions');
    const result = make('div', 'price-result'); result.tabIndex = -1;
    function renderResult() {
      result.replaceChildren();
      const decision = scenario.decision;
      cards.forEach((card, index) => {
        const chosen = decision?.choice === (index === 0 ? 'a' : 'b');
        card.classList.toggle('is-selected', chosen);
        card.querySelector('.price-selection').textContent = chosen ? '✓ 가정 가격 적용 후 선택 확정' : decision ? '선택하지 않음' : '아직 가격 선택을 확정하지 않았어요';
      });
      if (!decision) { result.append(make('p', '', '가격은 가정일 뿐, 선택은 아직 확정되지 않았어요.')); return; }
      const first = candidates.find(item => item.id === state.firstChoice);
      const sentence = `B의 가정 가격을 기준보다 ${decision.discount}% 낮춘 시나리오에서 ${decision.choice === 'b' ? 'B를 선택했습니다.' : decision.choice === 'a' ? 'A를 유지했습니다.' : '판단이 어렵다고 답했습니다.'}`;
      append(result, make('span', 'lab-eyebrow', 'MY CHOICE · 세 번의 기록'), make('h5', '', '가격 조건을 바꾼 뒤의 내 선택'));
      const trail = make('ol', 'price-trail');
      [['주소 공개 전', first?.name], ['주소 공개 후', `A · ${a.name}`], ['가정 가격 적용 후', decision.choice === 'unsure' ? '판단 어려움' : decision.choice === 'a' ? `A · ${a.name}` : `B · ${b.name}`]].forEach(([step, value]) => trail.append(append(make('li'), make('span', '', step), make('strong', '', value))));
      result.append(trail);
      const summary = make('textarea', 'price-copy-text');
      summary.readOnly = true; summary.rows = 7; summary.setAttribute('aria-label', '복사할 결과 문구');
      summary.value = `${sentence}\n주소 공개 전: ${first?.name}\n주소 공개 후: A · ${a.name}\nB: ${b.name}\n기준 ${exact(decision.base)} → 가정 ${exact(decision.assumed)} (차액 ${exact(decision.difference)})\n${sourceText()} · 가격 가정 선택 실험이며 실제 적정가·투자 추천·심리 진단·정확한 선택 전환점이 아닙니다.`;
      const feedback = make('p', 'price-copy-feedback'); feedback.setAttribute('role', 'status');
      append(result, make('p', '', sentence), summary,
        button('결과 문구 복사', 'lab-action lab-action-secondary', async () => {
          try {
            if (!navigator.clipboard?.writeText) throw new Error('unsupported');
            await navigator.clipboard.writeText(summary.value);
            feedback.textContent = '결과 문구를 복사했습니다.';
          } catch {
            summary.focus(); summary.select();
            feedback.textContent = '자동 복사를 사용할 수 없습니다. 위 텍스트를 길게 눌러 선택하거나 복사해 주세요.';
          }
        }), feedback,
        button('다시 해보기', 'lab-text-button', () => { scenario.reset(); refresh('#price-candidate'); }));
    }
    function change(value) {
      if (!scenario.adjust(value)) return;
      update(); renderResult();
      announce(blindRoot, '가격 가정이 바뀌었습니다. 선택을 다시 확정해 주세요.');
    }
    function update() {
      const quote = globalThis.DongnePriceChoice.price(b.sale_krw, scenario.discount);
      range.value = String(scenario.discount); range.setAttribute('aria-valuetext', `${scenario.discount}% 할인, 가정 가격 ${exact(quote.assumed)}`);
      output.textContent = `${scenario.discount}%`;
      // Update the exact number synchronously; animate only its appearance, never its value.
      priceNode.textContent = exact(quote.assumed);
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && priceNode.animate) {
        priceNode.getAnimations().forEach(animation => animation.cancel());
        priceNode.animate([{ opacity: .55, transform: 'translateY(2px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 140 });
      }
      discountNode.textContent = `${scenario.discount}% 낮춤`; differenceNode.textContent = `${exact(quote.difference)} 낮음`;
      minus.disabled = scenario.discount === 0; plus.disabled = scenario.discount === 30;
    }
    range.addEventListener('input', () => change(Number(range.value)));
    for (const [choice, text] of [['b', '이 가격이면 B 선택'], ['a', 'A 유지'], ['unsure', '판단 어려움']]) {
      actions.append(button(text, 'lab-action', () => {
        if (scenario.confirm(choice, b.sale_krw)) { renderResult(); result.focus({ preventScroll: true }); announce(blindRoot, '가격 시나리오 선택을 확정했습니다. 아래 결과를 확인하세요.'); }
      }));
    }
    append(panel, actions, result); update(); renderResult();
  }

  function choose(id) {
    if (state.stage === 'blind') { state.firstChoice = id; state.stage = 'reveal'; }
    else state.stage = 'done';
    state.selected = id;
    renderBlind(); focusAfterRender(blindRoot, '.blind-reflection');
    announce(blindRoot, '집의 이름과 동네를 공개했습니다. 선택을 돌아보세요.');
  }
  function resetChoice() { state.selected = null; state.firstChoice = null; state.stage = 'blind'; scenario.reset(); priceStage = 'invite'; }
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
