/* Dongne Lens mobile shell — device-local demo profiles, never account authentication. */
(() => {
  'use strict';

  const ROUTES = Object.freeze(['home', 'market', 'labs', 'plan', 'saved', 'profile']);
  const MAX_SAVED = 24;
  const MAX_RECENT = 6;
  const STORAGE = Object.freeze({ profile: 'dongne.v05.profile', saved: 'dongne.v05.saved', recent: 'dongne.v05.recent' });
  const cleanText = (value, max) => typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : '';
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const validDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  const validStamp = (value) => typeof value === 'string' && value.length <= 40 && /^\d{4}-\d{2}-\d{2}T/.test(value) && validDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
  const normalizeQuery = (value) => String(value || '').normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase('ko-KR');

  function cleanName(value) {
    if (typeof value !== 'string') return '';
    return [...value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').trim()].slice(0, 20).join('');
  }

  function normalizeProfile(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const nickname = cleanName(value.nickname);
    return nickname ? { nickname } : null;
  }

  function normalizeRecent(value) {
    if (!Array.isArray(value)) return [];
    const result = [], seen = new Set();
    for (const item of value.slice(0, 100)) {
      const query = cleanText(item, 80);
      const identity = normalizeQuery(query);
      if (!query || seen.has(identity)) continue;
      seen.add(identity); result.push(query);
      if (result.length === MAX_RECENT) break;
    }
    return result;
  }

  function normalizeSnapshot(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const { apartment: input, region: inputRegion } = value;
    if (!input || typeof input !== 'object' || !inputRegion || typeof inputRegion !== 'object') return null;
    const mode = value.mode;
    if (!['demo', 'live'].includes(mode)) return null;
    const code = cleanText(inputRegion.code, 5), regionName = cleanText(inputRegion.name, 80);
    const name = cleanText(input.name, 160), neighborhood = cleanText(input.neighborhood, 80);
    if (!/^\d{5}$/.test(code) || !regionName || !name || !neighborhood) return null;
    const areaBand = value.filters?.area_band ?? 'all';
    if (!['all', 'small', 'medium', 'large'].includes(areaBand)) return null;
    const key = JSON.stringify([mode, code, neighborhood, name, areaBand]);
    if (value.key !== key || !validStamp(value.saved_at)) return null;
    const apartment = { name, neighborhood };
    for (const field of ['sale_krw', 'jeonse_krw', 'monthly_rent_krw', 'monthly_deposit_krw']) {
      const amount = input[field] ?? null;
      if (amount !== null && (!finite(amount) || amount < 0 || amount > 1e15)) return null;
      apartment[field] = amount;
    }
    for (const field of ['sale_count', 'jeonse_count', 'monthly_count']) {
      const count = input[field] ?? 0;
      if (!Number.isSafeInteger(count) || count < 0 || count > 5000) return null;
      apartment[field] = count;
    }
    if (input.area_m2 !== null && input.area_m2 !== undefined && (!finite(input.area_m2) || input.area_m2 <= 0 || input.area_m2 > 10000)) return null;
    apartment.area_m2 = input.area_m2 ?? null;
    apartment.area_label = cleanText(input.area_label, 80) || ({ all: '전체 면적', small: '60㎡ 이하', medium: '60~85㎡', large: '85㎡ 초과' })[areaBand];
    apartment.transaction_type = ['sale', 'jeonse', 'monthly'].includes(input.transaction_type) ? input.transaction_type : 'sale';
    if (!validStamp(input.observed_at)) return null;
    apartment.observed_at = input.observed_at;
    const period = value.period;
    if (!period || !validDate(period.start) || !validDate(period.end) || period.start > period.end) return null;
    return {
      key, apartment, region: { code, name: regionName }, mode,
      period: { start: period.start, end: period.end },
      filters: { area_band: areaBand }, saved_at: value.saved_at
    };
  }

  function normalizeFavorites(value) {
    if (!Array.isArray(value)) return [];
    const result = [], seen = new Set();
    for (const item of value.slice(0, 100)) {
      const snapshot = normalizeSnapshot(item);
      if (!snapshot || seen.has(snapshot.key)) continue;
      seen.add(snapshot.key); result.push(snapshot);
      if (result.length === MAX_SAVED) break;
    }
    return result;
  }

  function routeFromHash(hash) {
    const raw = typeof hash === 'string' ? hash.replace(/^#/, '') : '';
    const aliases = { discovery: 'labs', scenario: 'plan', methodology: 'profile', top: 'home' };
    return ROUTES.includes(raw) ? raw : Object.prototype.hasOwnProperty.call(aliases, raw) ? aliases[raw] : 'home';
  }

  function routeAfterEvent(eventName, currentRoute, entered) {
    return eventName === 'lens:search-success' && entered ? 'market' : currentRoute;
  }

  // Exercise the actual storage and navigation boundaries in Node, without a
  // second implementation or a browser-shaped fake DOM.
  if (typeof module === 'object' && module.exports) {
    module.exports = Object.freeze({ cleanName, normalizeProfile, normalizeRecent, normalizeSnapshot, normalizeFavorites, routeFromHash, routeAfterEvent });
    return;
  }

  const $ = (id) => document.getElementById(id);
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  };
  const put = (id, value) => { if ($(id)) $(id).textContent = value; };
  const money = (value) => {
    if (!finite(value)) return '자료 없음';
    if (value >= 100000000) return `${(value / 100000000).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}억`;
    return `${(value / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}만원`;
  };
  const routeLabels = Object.freeze({ home: '동네렌즈', market: '동네 탐색', labs: '두 가지 실험', plan: '내 자금 계획', saved: '관심 단지', profile: '마이 렌즈' });
  const state = {
    initialized: false, entered: false, guest: true, nickname: '', route: 'home', index: 0,
    dialog: null, dialogFocus: null, closingNative: false, regions: [], saved: [], recent: [],
    activeSnapshot: null, storageOkay: true, busy: false, suppressSearchRoute: false,
    initialRoute: routeFromHash(window.location.hash), toastTimer: null
  };

  function notify(message, error = false) {
    if (globalThis.DongneApp?.notify) return globalThis.DongneApp.notify(message, error);
    const target = $('toast');
    if (!target) return;
    clearTimeout(state.toastTimer); target.textContent = message; target.hidden = false;
    target.dataset.kind = error ? 'error' : 'info';
    state.toastTimer = setTimeout(() => { target.hidden = true; }, 5000);
  }

  function updateStorageMessage() {
    put('storage-message', state.storageOkay
      ? '체험 이름·최근 지역·관심 단지만 이 기기에 저장됩니다. 계정 인증이나 다른 기기 동기화는 하지 않아요.'
      : '이 브라우저는 기기 저장을 허용하지 않습니다. 지금 창에서는 사용할 수 있지만 새로 열면 사라질 수 있어요.');
  }

  function readStorage(key) {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return null;
      if (raw.length > 262144) { window.localStorage.removeItem(key); return null; }
      try { return JSON.parse(raw); } catch { window.localStorage.removeItem(key); return null; }
    } catch { state.storageOkay = false; return null; }
  }

  function writeStorage(key, value) {
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      state.storageOkay = false; updateStorageMessage(); return false;
    }
  }

  function currentHistory() {
    const marker = window.history.state?.dongneMobile;
    return marker && Number.isSafeInteger(marker.index) && marker.index >= 0 ? marker : null;
  }

  function writeHistory(route, overlay, replace) {
    const existing = window.history.state && typeof window.history.state === 'object' ? window.history.state : {};
    const index = replace ? state.index : state.index + 1;
    const marker = { route, overlay: overlay || null, index };
    const url = `${window.location.pathname}${window.location.search}#${route}`;
    try {
      window.history[replace ? 'replaceState' : 'pushState']({ ...existing, dongneMobile: marker }, '', url);
      state.index = index;
    } catch {
      // file: and embedded viewers may deny history writes; screen navigation
      // and the explicit back button must still work.
    }
  }

  function screenEvent(screen) {
    window.dispatchEvent(new CustomEvent('lens:screen-change', { detail: { screen } }));
  }

  function moveJourney(toHome) {
    const scene = $('journey-scene'), slot = $(toHome ? 'home-scene-slot' : 'welcome-scene-slot');
    if (scene && slot && scene.parentNode !== slot) slot.append(scene);
  }

  function focusRoute() {
    const target = $(`screen-${state.route}`)?.querySelector('[data-screen-title]');
    if (target) target.focus({ preventScroll: true });
  }

  function showRoute(route, { history = 'push', focus = true } = {}) {
    if (!state.entered) return;
    const next = ROUTES.includes(route) ? route : 'home';
    const changed = next !== state.route;
    if (state.dialog) closeDialogVisual(false);
    state.route = next;
    document.querySelectorAll('#app-shell [data-screen]').forEach((page) => {
      const active = page.dataset.screen === next;
      page.hidden = !active; page.inert = !active;
      page.classList.toggle('is-route-enter', active && changed);
    });
    document.body.dataset.screen = next;
    document.querySelectorAll('.app-nav [data-route]').forEach((button) => {
      const active = button.dataset.route === (next === 'plan' ? 'market' : next);
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    put('app-header-title', routeLabels[next]);
    const skip = document.querySelector('.skip-link');
    if (skip) { skip.href = `#${next}`; skip.dataset.route = next; skip.textContent = '본문으로 바로가기'; }
    if ($('screen-back')) $('screen-back').hidden = next === 'home';
    if (history !== 'none') writeHistory(next, null, history === 'replace' || !changed);
    if (changed) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    if (next === 'saved') renderSaved();
    if (focus) focusRoute();
    screenEvent(next);
  }

  function updateProfile() {
    const name = state.guest ? '탐험가' : state.nickname;
    put('home-greeting', `${name}님, 다음 집을 찾아볼까요?`);
    put('profile-display-name', state.guest ? '게스트 탐험가' : state.nickname);
    put('profile-session-label', state.guest ? '게스트 체험 · 실제 계정 아님' : '기기 내 체험 프로필 · 실제 계정 아님');
    updateStorageMessage();
  }

  function enterApp(nickname = '') {
    state.nickname = cleanName(nickname); state.guest = !state.nickname; state.entered = true;
    if (!state.guest) writeStorage(STORAGE.profile, { nickname: state.nickname });
    $('welcome-screen').hidden = true; $('welcome-screen').inert = true;
    $('app-shell').hidden = false; $('app-shell').inert = false;
    document.body.dataset.auth = state.guest ? 'guest' : 'demo';
    moveJourney(true); updateProfile();
    showRoute(state.initialRoute, { history: 'replace' });
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }

  function endSession() {
    closeDialogVisual(false);
    state.entered = false; state.nickname = ''; state.guest = true;
    state.initialRoute = 'home'; state.route = 'home'; state.suppressSearchRoute = true;
    globalThis.DongneApp?.cancelPendingNavigation?.();
    $('app-shell').hidden = true; $('app-shell').inert = true;
    $('welcome-screen').hidden = false; $('welcome-screen').inert = false;
    document.body.dataset.auth = 'welcome'; document.body.dataset.screen = 'welcome';
    moveJourney(false); writeHistory('home', null, true);
    const skip = document.querySelector('.skip-link');
    if (skip) { skip.href = '#profile-form'; delete skip.dataset.route; skip.textContent = '시작 방법으로 바로가기'; }
    put('profile-error', ''); if ($('profile-error')) $('profile-error').hidden = true;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    $('profile-name')?.focus({ preventScroll: true });
    screenEvent('welcome');
    notify('체험을 마쳤습니다. 저장한 관심 단지는 유지됩니다.');
  }

  function setDialogVisual(id) {
    const dialog = $(id);
    if (!dialog) return;
    state.dialog = id;
    document.body.classList.add('has-dialog');
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', ''); dialog.dataset.fallbackOpen = 'true';
      dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
    }
    if (id === 'search-dialog') {
      renderRecent(); renderSuggestions();
      $('region-input')?.focus({ preventScroll: true });
    } else {
      dialog.querySelector('[data-close-dialog]')?.focus({ preventScroll: true });
    }
  }

  function openDialog(id) {
    if (!state.entered || state.dialog === id) return;
    const replacing = Boolean(state.dialog);
    if (state.dialog) closeDialogVisual(false);
    state.dialogFocus = document.activeElement;
    if (id === 'search-dialog') {
      state.suppressSearchRoute = false; put('search-error', '');
      if ($('search-error')) $('search-error').hidden = true;
    }
    setDialogVisual(id);
    writeHistory(state.route, id, replacing);
  }

  function closeDialogVisual(restoreFocus = true) {
    const id = state.dialog;
    if (!id) return;
    const dialog = $(id), oldFocus = state.dialogFocus;
    state.dialog = null; state.dialogFocus = null; state.closingNative = true;
    if (dialog) {
      if (typeof dialog.close === 'function' && dialog.open) dialog.close();
      else dialog.removeAttribute('open');
      delete dialog.dataset.fallbackOpen;
    }
    state.closingNative = false; document.body.classList.remove('has-dialog');
    if (restoreFocus) {
      if (oldFocus?.isConnected && !oldFocus.closest('[hidden]')) oldFocus.focus({ preventScroll: true });
      else focusRoute();
    }
  }

  function dismissDialog() {
    const id = state.dialog;
    if (!id) return;
    if (id === 'search-dialog') { state.suppressSearchRoute = true; globalThis.DongneApp?.cancelPendingNavigation?.(); }
    const marker = currentHistory();
    closeDialogVisual(true);
    if (marker?.overlay === id && marker.index > 0) window.history.back();
    else writeHistory(state.route, null, true);
  }

  function routeFromDialog(route) {
    const hadDialog = Boolean(state.dialog);
    closeDialogVisual(false);
    showRoute(route, { history: hadDialog ? 'replace' : 'push' });
  }

  function restoreHistory() {
    const marker = currentHistory();
    if (marker) state.index = marker.index;
    if (!state.entered) return;
    const next = routeFromHash(window.location.hash);
    const overlay = ['search-dialog', 'apartment-dialog'].includes(marker?.overlay) ? marker.overlay : null;
    if (state.dialog && state.dialog !== overlay) {
      if (state.dialog === 'search-dialog') { state.suppressSearchRoute = true; globalThis.DongneApp?.cancelPendingNavigation?.(); }
      closeDialogVisual(false);
    }
    const changed = state.route !== next;
    if (changed) {
      state.suppressSearchRoute = true; globalThis.DongneApp?.cancelPendingNavigation?.();
      showRoute(next, { history: 'none' });
    }
    if (overlay && !state.dialog && (overlay !== 'apartment-dialog' || state.activeSnapshot)) setDialogVisual(overlay);
    else if (!overlay && !changed) focusRoute();
  }

  function search(query) {
    if (state.busy) return;
    if (!globalThis.DongneApp?.search) { notify('지역 목록을 준비하고 있어요. 잠시 후 다시 시도해 주세요.'); return; }
    state.suppressSearchRoute = false;
    if ($('region-input')) $('region-input').value = query;
    put('search-error', ''); if ($('search-error')) $('search-error').hidden = true;
    globalThis.DongneApp.search(query, { navigate: true });
  }

  function renderRecent() {
    const root = $('recent-searches'); if (!root) return;
    root.replaceChildren();
    if (!state.recent.length) { root.append(make('p', 'search-empty-note', '처음 둘러볼 동네를 검색해 보세요.')); return; }
    for (const query of state.recent) {
      const button = make('button', 'recent-search-chip', query); button.type = 'button';
      button.disabled = state.busy; button.addEventListener('click', () => search(query)); root.append(button);
    }
  }

  function renderSuggestions() {
    const root = $('search-suggestions'); if (!root) return;
    root.replaceChildren();
    const query = normalizeQuery($('region-input')?.value);
    if (!state.regions.length) { root.append(make('p', 'search-empty-note', '지원 지역 목록을 준비하고 있어요.')); return; }
    const candidates = [], seen = new Set();
    for (const region of state.regions) {
      if (!region || typeof region.name !== 'string') continue;
      const district = region.name.split(/\s+/).at(-1);
      const haystack = [region.name, ...(Array.isArray(region.aliases) ? region.aliases : [])];
      if (!query || haystack.some((name) => normalizeQuery(name).includes(query))) {
        candidates.push({ name: district, meta: `${region.name} 전체`, query: region.name });
      }
      if (query) for (const name of Array.isArray(region.neighborhoods) ? region.neighborhoods : []) {
        if (typeof name === 'string' && (normalizeQuery(name).includes(query) || normalizeQuery(`${region.name} ${name}`).includes(query))) candidates.push({ name, meta: region.name, query: `${region.name} ${name}` });
      }
    }
    for (const item of candidates) {
      if (seen.has(item.query)) continue;
      seen.add(item.query);
      const button = make('button', 'search-suggestion'); button.type = 'button'; button.disabled = state.busy;
      const copy = make('span', 'suggestion-copy');
      copy.append(make('strong', 'suggestion-name', item.name), make('span', 'suggestion-meta', item.meta));
      const arrow = make('span', 'suggestion-arrow', '↗'); arrow.setAttribute('aria-hidden', 'true');
      button.append(copy, arrow); button.addEventListener('click', () => search(item.query)); root.append(button);
      if (root.children.length >= 8) break;
    }
    if (!root.children.length) root.append(make('p', 'search-empty-note', '검색어를 다시 확인해 주세요. 현재 서울 25개 구를 지원합니다.'));
  }

  function sanitizeForUse(payload) {
    return normalizeSnapshot({ ...payload, saved_at: payload?.saved_at || new Date().toISOString() });
  }

  function emitSaved() {
    window.dispatchEvent(new CustomEvent('lens:saved-changed', { detail: { keys: state.saved.map((item) => item.key) } }));
    put('saved-count', `${state.saved.length}개`);
    if (state.activeSnapshot && $('detail-save')) {
      const selected = state.saved.some((item) => item.key === state.activeSnapshot.key);
      $('detail-save').setAttribute('aria-pressed', String(selected));
      $('detail-save').textContent = selected ? '관심 단지 해제' : '관심 단지 저장';
    }
  }

  function toggleSaved(payload) {
    const snapshot = sanitizeForUse(payload);
    if (!snapshot) { notify('이 단지는 저장할 자료가 완전하지 않습니다.', true); return; }
    const existing = state.saved.findIndex((item) => item.key === snapshot.key);
    if (existing >= 0) state.saved.splice(existing, 1);
    else {
      if (state.saved.length >= MAX_SAVED) { notify(`관심 단지는 ${MAX_SAVED}개까지 저장할 수 있어요. 먼저 하나를 해제해 주세요.`); return; }
      state.saved.unshift(snapshot);
    }
    const persisted = writeStorage(STORAGE.saved, state.saved);
    renderSaved(); emitSaved();
    notify(existing >= 0 ? '관심 단지를 해제했습니다.' : persisted ? '관심 단지를 이 기기에 저장했습니다.' : '지금 창에 저장했습니다. 브라우저를 닫으면 사라질 수 있어요.');
  }

  function buildFeaturedPayload(detail, apartment) {
    const full = globalThis.DongneApp?.getApartmentPayload?.(apartment);
    if (full) return { ...full, apartment: { ...full.apartment, transaction_type: 'sale' } };
    const area = detail.filters?.area_band || 'all';
    const { market } = detail;
    return {
      key: JSON.stringify([market.mode, market.region.code, apartment.neighborhood, apartment.name, area]),
      apartment: { ...apartment, area_label: ({ all: '전체 면적', small: '60㎡ 이하', medium: '60~85㎡', large: '85㎡ 초과' })[area], transaction_type: 'sale', observed_at: market.fetched_at || new Date().toISOString() },
      region: market.region, mode: market.mode, period: market.period, filters: { area_band: area }
    };
  }

  function renderFeatured(detail) {
    const root = $('home-featured'); if (!root) return;
    root.replaceChildren();
    if (!detail?.market || !Array.isArray(detail.analysis?.apartments)) return;
    for (const apartment of detail.analysis.apartments.slice(0, 3)) {
      const payload = buildFeaturedPayload(detail, apartment);
      const card = make('button', 'featured-region-card'); card.type = 'button';
      const meta = make('span', 'featured-card-meta', `${detail.market.mode === 'demo' ? '가상 예시' : '신고 거래'} · ${apartment.neighborhood}`);
      card.append(meta, make('strong', 'featured-card-name', apartment.name), make('span', 'featured-card-price', money(apartment.sale_krw)), make('span', 'featured-card-caption', `매매 중앙값 · ${apartment.sale_count || 0}건`));
      card.addEventListener('click', () => openApartment(payload)); root.append(card);
    }
  }

  function snapshotPrice(snapshot) {
    const apartment = snapshot.apartment;
    if (apartment.transaction_type === 'jeonse') return `전세 ${money(apartment.jeonse_krw)}`;
    if (apartment.transaction_type === 'monthly') return `월세 ${money(apartment.monthly_rent_krw)}`;
    return `매매 ${money(apartment.sale_krw)}`;
  }

  function renderSaved() {
    const root = $('saved-list'); if (!root) return;
    root.replaceChildren();
    if ($('saved-empty')) $('saved-empty').hidden = state.saved.length > 0;
    put('saved-count', `${state.saved.length}개`);
    for (const snapshot of state.saved) {
      const card = make('article', 'saved-card');
      const top = make('div', 'saved-card-top');
      top.append(make('span', 'saved-card-source', snapshot.mode === 'demo' ? '가상 예시 · 저장 당시 자료' : '신고 거래 · 저장 당시 자료'));
      const remove = make('button', 'saved-card-remove', '해제'); remove.type = 'button';
      remove.setAttribute('aria-label', `${snapshot.apartment.name} 관심 단지 해제`);
      remove.addEventListener('click', () => {
        toggleSaved(snapshot);
        const next = $('saved-list')?.querySelector('button');
        if (next) next.focus({ preventScroll: true }); else focusRoute();
      });
      top.append(remove);
      const button = make('button', 'saved-card-main'); button.type = 'button';
      button.append(make('strong', 'saved-card-name', snapshot.apartment.name), make('span', 'saved-card-meta', `${snapshot.region.name} · ${snapshot.apartment.neighborhood} · ${snapshot.apartment.area_label}`), make('span', 'saved-card-price', snapshotPrice(snapshot)));
      button.addEventListener('click', () => openApartment(snapshot)); card.append(top, button); root.append(card);
    }
  }

  function renderApartment(snapshot) {
    const root = $('apartment-detail-content'); if (!root) return;
    root.replaceChildren();
    const apartment = snapshot.apartment;
    root.append(make('p', 'detail-eyebrow', snapshot.mode === 'demo' ? 'VIRTUAL HOME · 가상 단지' : 'REPORTED TRANSACTIONS · 신고 거래'));
    const title = make('h2', 'detail-title', apartment.name); title.id = 'apartment-detail-title';
    root.append(title, make('p', 'detail-location', `${snapshot.region.name} · ${apartment.neighborhood}`));
    $('apartment-dialog')?.setAttribute('aria-labelledby', title.id);
    const grid = make('div', 'detail-price-grid');
    for (const [label, field, count] of [['매매 중앙값', 'sale_krw', 'sale_count'], ['전세 중앙값', 'jeonse_krw', 'jeonse_count'], ['월세 중앙값', 'monthly_rent_krw', 'monthly_count']]) {
      const cell = make('div', 'detail-price');
      cell.append(make('span', '', label), make('strong', '', money(apartment[field])), make('small', '', `${apartment[count]}건`)); grid.append(cell);
    }
    root.append(grid);
    if (apartment.monthly_count > 0) root.append(make('p', 'detail-note', `월세 보증금 중앙값 ${money(apartment.monthly_deposit_krw)} · 월세와 보증금은 각각 계산한 중앙값입니다.`));
    const facts = make('dl', 'detail-facts');
    for (const [label, value] of [['면적 조건', apartment.area_label], ['전용면적 중앙값', finite(apartment.area_m2) ? `${apartment.area_m2.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}㎡` : '자료 없음'], ['조회 기간', `${snapshot.period.start} ~ ${snapshot.period.end}`], ['자료 생성·조회', new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(apartment.observed_at))]]) {
      const row = make('div'); row.append(make('dt', '', label), make('dd', '', value)); facts.append(row);
    }
    root.append(facts, make('p', 'detail-note', snapshot.mode === 'demo' ? '단지명과 모든 거래 금액은 가상 예시입니다. 실제로 판매 중인 집이나 현재 시세가 아닙니다.' : '신고된 과거 계약의 집계입니다. 현재 판매 매물·호가·같은 세대의 매매와 임대 차액을 뜻하지 않습니다.'));
    const currentRegion = globalThis.DongneApp?.getSnapshot?.()?.market?.region?.name;
    root.append(make('p', 'detail-note', currentRegion ? `자금 계획은 현재 조회한 ${currentRegion}의 매매 중앙값으로 계산합니다. 이 단지 가격을 적용하는 기능은 아닙니다.` : '자금 계획을 계산하려면 먼저 지역을 검색해 주세요. 선택한 단지 가격을 직접 적용하는 기능은 아닙니다.'));
  }

  function openApartment(payload) {
    const snapshot = sanitizeForUse(payload);
    if (!snapshot) { notify('단지 정보를 확인하지 못했습니다. 지역을 다시 조회해 주세요.', true); return; }
    state.activeSnapshot = snapshot; renderApartment(snapshot); emitSaved(); openDialog('apartment-dialog');
  }

  function clearLocalData() {
    state.saved = []; state.recent = []; state.nickname = ''; state.guest = true;
    const deleted = Object.values(STORAGE).map((key) => writeStorage(key, null)).every(Boolean);
    if ($('profile-name')) $('profile-name').value = '';
    document.body.dataset.auth = state.entered ? 'guest' : 'welcome';
    updateProfile(); renderSaved(); renderRecent(); emitSaved();
    notify(deleted ? '이 기기의 체험 이름·최근 지역·관심 단지를 지웠습니다.' : '현재 창의 체험 자료를 초기화했습니다. 브라우저가 기기 저장소 삭제를 허용하지 않았어요.');
  }

  function init() {
    if (state.initialized || !$('welcome-screen') || !$('app-shell')) return;
    state.initialized = true;
    const profile = normalizeProfile(readStorage(STORAGE.profile));
    state.saved = normalizeFavorites(readStorage(STORAGE.saved));
    state.recent = normalizeRecent(readStorage(STORAGE.recent));
    if (profile && $('profile-name')) $('profile-name').value = profile.nickname;
    state.index = currentHistory()?.index || 0;
    $('welcome-screen').hidden = false; $('welcome-screen').inert = false;
    $('app-shell').hidden = true; $('app-shell').inert = true;
    document.body.dataset.auth = 'welcome'; document.body.dataset.screen = 'welcome';
    updateProfile(); renderSaved(); emitSaved();

    globalThis.DongneShell = Object.freeze({ isSaved: (key) => state.saved.some((item) => item.key === key) });

    $('profile-form')?.addEventListener('submit', (event) => {
      event.preventDefault(); const nickname = cleanName($('profile-name')?.value);
      if (!nickname) { put('profile-error', '체험에 사용할 이름을 입력하거나 게스트로 둘러보세요.'); if ($('profile-error')) $('profile-error').hidden = false; $('profile-name')?.focus(); return; }
      put('profile-error', ''); if ($('profile-error')) $('profile-error').hidden = true; enterApp(nickname);
    });
    $('guest-start')?.addEventListener('click', () => enterApp());
    $('profile-logout')?.addEventListener('click', endSession);
    $('clear-local-data')?.addEventListener('click', clearLocalData);
    $('screen-back')?.addEventListener('click', () => {
      if (state.dialog) { dismissDialog(); return; }
      state.suppressSearchRoute = true; globalThis.DongneApp?.cancelPendingNavigation?.();
      const marker = currentHistory();
      if (marker && marker.index > 0) window.history.back();
      else showRoute('home', { history: 'replace' });
    });
    $('region-input')?.addEventListener('input', () => { put('search-error', ''); if ($('search-error')) $('search-error').hidden = true; renderSuggestions(); });
    $('region-input')?.setAttribute('aria-controls', 'search-suggestions');
    $('search-form')?.addEventListener('submit', () => { state.suppressSearchRoute = false; }, true);
    $('detail-save')?.addEventListener('click', () => { if (state.activeSnapshot) toggleSaved(state.activeSnapshot); });
    $('detail-plan')?.addEventListener('click', () => {
      state.suppressSearchRoute = true; routeFromDialog('plan');
      const current = globalThis.DongneApp?.getSnapshot?.();
      notify(current?.analysis ? `${current.market.region.name}의 매매 중앙값으로 자금 계획을 계산합니다.` : '먼저 지역을 검색하면 해당 지역 기준 자금 계획을 계산할 수 있어요.');
    });

    document.addEventListener('click', (event) => {
      const target = event.target?.closest?.('[data-route], [data-open-search], [data-close-dialog], [data-region-query]');
      if (!target) return;
      if (target.hasAttribute('data-region-query')) { state.suppressSearchRoute = false; return; }
      if (target.hasAttribute('data-close-dialog')) { event.preventDefault(); dismissDialog(); return; }
      if (target.hasAttribute('data-open-search')) { event.preventDefault(); openDialog('search-dialog'); return; }
      if (target.hasAttribute('data-route')) { event.preventDefault(); state.suppressSearchRoute = true; globalThis.DongneApp?.cancelPendingNavigation?.(); routeFromDialog(target.dataset.route); }
    });

    for (const id of ['search-dialog', 'apartment-dialog']) {
      const dialog = $(id); if (!dialog) continue;
      dialog.addEventListener('cancel', (event) => { event.preventDefault(); dismissDialog(); });
      dialog.addEventListener('click', (event) => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dismissDialog();
      });
    }

    document.addEventListener('keydown', (event) => {
      const dialog = state.dialog && $(state.dialog);
      if (!dialog) return;
      if (event.key === 'Escape') { event.preventDefault(); dismissDialog(); return; }
      if (!dialog.dataset.fallbackOpen) return;
      if (event.key !== 'Tab') return;
      const nodes = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')].filter((node) => !node.closest('[hidden]'));
      if (!nodes.length) { event.preventDefault(); return; }
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });

    window.addEventListener('popstate', restoreHistory);
    window.addEventListener('hashchange', restoreHistory);
    window.addEventListener('lens:ready', (event) => {
      state.regions = Array.isArray(event.detail?.regions) ? event.detail.regions : [];
      renderSuggestions();
    });
    window.addEventListener('lens:busy', (event) => {
      state.busy = Boolean(event.detail?.loading || event.detail?.analyzing);
      $('app-shell')?.classList.toggle('is-busy', state.busy);
      for (const button of document.querySelectorAll('#search-suggestions button, #recent-searches button')) button.disabled = state.busy;
    });
    window.addEventListener('lens:search-success', (event) => {
      const next = routeAfterEvent(event.type, state.route, state.entered && !state.suppressSearchRoute);
      const query = cleanText(event.detail?.neighborhood ? `${event.detail.region.name} ${event.detail.neighborhood}` : event.detail?.region?.name || event.detail?.query, 80);
      if (query) { state.recent = normalizeRecent([query, ...state.recent]); writeStorage(STORAGE.recent, state.recent); renderRecent(); }
      put('search-error', ''); if ($('search-error')) $('search-error').hidden = true;
      if (state.entered && !state.suppressSearchRoute) {
        routeFromDialog(next);
        // A new search starts a new result set, including when the user was
        // already part-way down the market screen. Filters keep their scroll.
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      }
    });
    window.addEventListener('lens:search-error', (event) => {
      if (state.entered && !state.dialog && !state.suppressSearchRoute) openDialog('search-dialog');
      put('search-error', cleanText(event.detail?.message, 500) || '지역을 다시 확인해 주세요.');
      if ($('search-error')) $('search-error').hidden = false;
    });
    window.addEventListener('lens:analysis', (event) => { renderFeatured(event.detail); });
    window.addEventListener('lens:clear', () => { $('home-featured')?.replaceChildren(); });
    window.addEventListener('lens:apartment', (event) => { openApartment(event.detail); });
    window.addEventListener('lens:save', (event) => { toggleSaved(event.detail); });
    // If the hosting page initializes scripts in an unusual order, hydrate only
    // the visible summaries, never infer a user navigation intent from data.
    const initial = globalThis.DongneApp?.getSnapshot?.();
    if (initial?.regions) state.regions = initial.regions;
    if (initial?.analysis) renderFeatured(initial);
    screenEvent('welcome');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
