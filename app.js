/**
 * FNAF Max Mode Tracker
 * Fetches list from fnafmml.com API. Completions: localStorage (guest) or database (logged in).
 */

const API_BASE = 'https://fnafmml.com/api';
const STORAGE_KEY = 'fnaf-maxmode-completions';
const STORAGE_KEY_ML = 'fnaf-mml-completions';
const STORAGE_KEY_UL = 'fnaf-mul-completions';
const TOKEN_KEY = 'fnaf-auth-token';

let apiAvailable = false;
let authToken = null;

const CORS_PROXIES = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  (u) => `https://cors.bridged.cc/${u}`,
];

async function fetchWithCorsFallback(url) {
  const attempts = [
    () => fetch(url),
    ...CORS_PROXIES.map((fn) => () => fetch(fn(url))),
  ];
  let lastErr;
  for (const attempt of attempts) {
    try {
      const res = await attempt();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Failed to fetch');
}

let completions = new Set();
let idsInML = new Set();
let idsInUL = new Set();
const maxmodeDetailsById = new Map();
let currentList = 'ml';
let completedRankMode = 'ml';
let currentPage = 1;
let totalPages = 17;
let totalCount = 845;
let fullListTotalML = 845;
let fullListTotalUL = 0;
let motw = null;

const pageCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;
const COMPLETED_PAGE_SIZE = 35;

function cacheKey(list, page, search) {
  return `${list}:${page}:${(search || '').trim()}`;
}

// DOM elements
let headerProgress, progressFill, cardContainer, paginationPrev, paginationNext, paginationInfo, searchInput, searchBtn;
let tabML, tabUL, tabCompleted;

async function loadCompletions() {
  try {
    let stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const ml = JSON.parse(localStorage.getItem(STORAGE_KEY_ML) || '[]');
    const ul = JSON.parse(localStorage.getItem(STORAGE_KEY_UL) || '[]');
    if (ml.length > 0 || ul.length > 0) {
      stored = [...new Set([...(Array.isArray(stored) ? stored : []), ...(Array.isArray(ml) ? ml : []), ...(Array.isArray(ul) ? ul : [])])];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
      localStorage.removeItem(STORAGE_KEY_ML);
      localStorage.removeItem(STORAGE_KEY_UL);
    }
    completions = new Set(Array.isArray(stored) ? stored : []);

    if (apiAvailable && authToken) {
      const res = await fetch('/api/completions', { headers: { Authorization: `Bearer ${authToken}` } });
      if (res.ok) {
        const data = await res.json();
        completions = new Set(data.completions || []);
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...completions]));
      }
    }
  } catch (e) {
    completions = new Set();
  }
}

function saveCompletionsLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...completions]));
}

async function saveCompletions() {
  saveCompletionsLocal();
  if (apiAvailable && authToken) {
    try {
      await fetch('/api/completions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ completions: [...completions] }),
      });
    } catch (_) {}
  }
}

let pendingRemoveId = null;

function showRemoveModal(id) {
  const d = maxmodeDetailsById.get(id);
  const title = d?.title || 'this challenge';
  pendingRemoveId = id;
  document.getElementById('remove-modal-title').textContent = `Remove "${title}" from your completed list?`;
  document.getElementById('remove-modal').classList.remove('hidden');
}

function hideRemoveModal() {
  pendingRemoveId = null;
  document.getElementById('remove-modal').classList.add('hidden');
}

function confirmRemove() {
  if (!pendingRemoveId) return;
  const id = pendingRemoveId;
  hideRemoveModal();
  completions.delete(id);
  saveCompletions();
  updateProgress();
  loadPage(currentPage, searchInput?.value || '');
}

function toggleCompletion(id) {
  if (completions.has(id)) {
    if (currentList === 'completed') {
      showRemoveModal(id);
      return;
    }
    completions.delete(id);
  } else {
    completions.add(id);
  }
  saveCompletions();
  updateProgress();
  if (currentList === 'completed') {
    loadPage(currentPage, searchInput?.value || '');
    return;
  }
  const cards = cardContainer?.querySelectorAll(`[data-id="${id}"]`);
  cards?.forEach((card) => {
    card.classList.toggle('completed', completions.has(id));
    const thumb = card.querySelector('.card-thumb');
    const check = thumb?.querySelector('.check');
    if (completions.has(id)) {
      if (!check) {
        const span = document.createElement('span');
        span.className = 'check';
        span.setAttribute('aria-hidden', 'true');
        span.textContent = '✓';
        thumb?.appendChild(span);
      }
    } else if (check) {
      check.remove();
    }
  });
}

function getCompletionsCount(list) {
  if (list === 'completed') return completions.size;
  const ids = list === 'ml' ? idsInML : idsInUL;
  if (ids.size === 0) return completions.size;
  let count = 0;
  for (const id of completions) {
    if (ids.has(id)) count++;
  }
  return count;
}

function getFullListTotal() {
  if (currentList === 'completed') return completions.size;
  return currentList === 'ml' ? fullListTotalML : fullListTotalUL;
}

function updateProgress() {
  const count = getCompletionsCount(currentList);
  const fullTotal = getFullListTotal();
  if (currentList === 'completed') {
    headerProgress.textContent = `${count} completed`;
    if (progressFill) progressFill.style.width = '100%';
    return;
  }
  const pct = fullTotal > 0 ? Math.round((count / fullTotal) * 100) : 0;
  headerProgress.textContent = `${count} / ${fullTotal} completed (${pct}%)`;
  if (progressFill && fullTotal > 0) {
    progressFill.style.width = `${pct}%`;
  }
}

function getCompletedPageData(page, search) {
  const searchVal = (search || '').trim().toLowerCase();
  const fallback = (id) => ({
    id,
    slug: '',
    title: 'Unknown',
    game: null,
    creator_name: '—',
    description: '',
    thumbnail_url: '',
    ml_rank: null,
    ul_rank: null,
    list_entry: null,
    maxmode_tags: [],
    calculated_enjoyment: null,
    rng_rating: null,
    avg_length_seconds: null,
  });
  let items = [...completions].map((id) => {
    const d = maxmodeDetailsById.get(id);
    const m = d ? { ...d, list_entry: { position: d.ml_rank ?? d.ul_rank } } : fallback(id);
    return m;
  });
  if (searchVal) {
    items = items.filter(
      (m) =>
        (m.title || '').toLowerCase().includes(searchVal) ||
        (m.game?.title || '').toLowerCase().includes(searchVal) ||
        (m.creator_name || '').toLowerCase().includes(searchVal)
    );
  }
  const rankKey = completedRankMode === 'ml' ? 'ml_rank' : 'ul_rank';
  items.sort((a, b) => {
    const ra = a[rankKey] ?? 999999;
    const rb = b[rankKey] ?? 999999;
    if (ra !== rb) return ra - rb;
    return (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' });
  });
  const totalCount = items.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / COMPLETED_PAGE_SIZE));
  const start = (page - 1) * COMPLETED_PAGE_SIZE;
  const maxmodes = items.slice(start, start + COMPLETED_PAGE_SIZE);
  return { maxmodes, totalCount, totalPages };
}

async function fetchPage(list, page, search = '') {
  const key = cacheKey(list, page, search);
  const cached = pageCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;
  const params = new URLSearchParams({ list, page: String(page) });
  if ((search || '').trim()) params.set('search', search.trim());
  try {
    const res = await fetch(`/api/maxmodes/list?${params}`);
    if (res.ok) {
      const data = await res.json();
      pageCache.set(key, { data, at: Date.now() });
      return data;
    }
    if (res.status === 503) throw new Error('Cache empty');
  } catch (_) {
    const url = `${API_BASE}/maxmodes/list?${params}`;
    const res = await fetchWithCorsFallback(url);
    const data = await res.json();
    pageCache.set(key, { data, at: Date.now() });
    return data;
  }
  throw new Error('Failed to fetch');
}

function prefetchPage(list, page, search) {
  const key = cacheKey(list, page, search);
  if (pageCache.has(key)) return;
  fetchPage(list, page, search).catch(() => {});
}

async function fetchMOTW() {
  try {
    const res = await fetch('/api/motw');
    if (res.ok) {
      const data = await res.json();
      return data.motw;
    }
  } catch (_) {
    //
  }
  const res = await fetchWithCorsFallback(`${API_BASE}/motw`);
  const data = await res.json();
  return data.motw;
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function rankLabel(m, list) {
  if (list === 'completed') {
    const r = completedRankMode === 'ml' ? m.ml_rank : m.ul_rank;
    return r != null ? `#${r}` : '—';
  }
  const r = m.ml_rank ?? m.ul_rank ?? m.list_entry?.position ?? '—';
  return r === '—' ? '—' : `#${r}`;
}

function renderCard(m, list) {
  const completed = completions.has(m.id);
  const rank = rankLabel(m, list);
  const tags = (m.maxmode_tags || []).map(t => t.tag?.name).filter(Boolean);
  const enjoyment = m.calculated_enjoyment ?? '—';
  const rng = m.rng_rating ?? '—';
  const duration = formatDuration(m.avg_length_seconds);
  const isMOTW = motw && motw.id === m.id;

  const card = document.createElement('article');
  card.className = 'card' + (completed ? ' completed' : '') + (isMOTW ? ' motw' : '');
  card.dataset.id = m.id;
  card.dataset.list = list;

  card.innerHTML = `
    <div class="card-thumb">
      <img src="${m.thumbnail_url || ''}" alt="" loading="lazy" onerror="this.style.background='var(--bg-card)'">
      ${completed ? '<span class="check" aria-hidden="true">✓</span>' : ''}
      ${isMOTW ? '<span class="motw-badge">MOTW</span>' : ''}
    </div>
    <div class="card-body">
      <h3 class="card-title">${rank !== '—' ? rank + ' ' : ''}${escapeHtml(m.title)}</h3>
      <p class="card-meta">${escapeHtml(m.game?.title || '—')} · ${escapeHtml(m.creator_name || '—')}</p>
      ${tags.length ? `<p class="card-tags">${tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</p>` : ''}
      <p class="card-stats">Enjoyment: ${enjoyment} · RNG: ${rng} · ~${duration}</p>
    </div>
  `;

  card.addEventListener('click', () => openDetailModal(m));
  return card;
}

function youtubeIdFromThumbnail(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(/img\.youtube\.com\/vi\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function openDetailModal(m) {
  const d = typeof m === 'string' ? maxmodeDetailsById.get(m) : m;
  if (!d) return;
  const id = d.id;
  const title = d.title || 'Unknown';
  const meta = [d.game?.title ?? '', d.creator_name ?? ''].filter(Boolean).join(' · ') || '—';
  const tags = (d.maxmode_tags || []).map(t => t.tag?.name).filter(Boolean);
  const mlRank = d.ml_rank;
  const ulRank = d.ul_rank;
  const points = d.list_entry?.points_snapshot;
  const enjoyment = d.calculated_enjoyment ?? '—';
  const rng = d.rng_rating ?? '—';
  const duration = formatDuration(d.avg_length_seconds);
  const desc = d.description || '';
  const completed = completions.has(id);
  const videoId = youtubeIdFromThumbnail(d.thumbnail_url);

  document.getElementById('detail-thumb').src = d.thumbnail_url || '';
  document.getElementById('detail-title').textContent = title;
  document.getElementById('detail-meta').textContent = meta;
  document.getElementById('detail-tags').innerHTML = tags.length
    ? tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')
    : '';
  const statsParts = [];
  if (mlRank != null) statsParts.push(`ML #${mlRank}`);
  if (ulRank != null) statsParts.push(`UL #${ulRank}`);
  if (points != null) statsParts.push(`Points: ${points}`);
  statsParts.push(`RNG: ${rng}/5`);
  statsParts.push(`Enjoyment: ${enjoyment}`);
  statsParts.push(`~${duration}`);
  document.getElementById('detail-stats').textContent = statsParts.join(' · ');
  document.getElementById('detail-desc').textContent = desc;
  document.getElementById('detail-desc').classList.toggle('hidden', !desc);

  const videoEl = document.getElementById('detail-video');
  if (videoId) {
    videoEl.classList.remove('hidden');
    videoEl.innerHTML = `
      <a href="https://www.youtube.com/watch?v=${escapeHtml(videoId)}" target="_blank" rel="noopener" class="detail-video-link">
        Watch video guide on YouTube →
      </a>
    `;
  } else {
    videoEl.classList.add('hidden');
    videoEl.innerHTML = '';
  }

  const toggleBtn = document.getElementById('detail-toggle-btn');
  toggleBtn.textContent = completed ? 'Remove from completed' : 'Mark complete';
  toggleBtn.dataset.id = id;

  document.getElementById('detail-modal').classList.remove('hidden');
}

function hideDetailModal() {
  document.getElementById('detail-modal').classList.add('hidden');
}

function escapeHtml(s) {
  if (s == null) return '';
  const div = document.createElement('div');
  div.textContent = String(s);
  return div.innerHTML;
}

function renderCards(maxmodes, list) {
  cardContainer.innerHTML = '';
  const items = maxmodes || [];
  if (items.length === 0 && list === 'completed') {
    cardContainer.innerHTML = '<p class="empty-state">No completed challenges yet. Complete some from the Main or Unlimited list!</p>';
    return;
  }
  for (const m of items) {
    cardContainer.appendChild(renderCard(m, list));
  }
}

function setLoading(loading) {
  cardContainer.classList.toggle('loading', loading);
  if (loading) cardContainer.innerHTML = '<p class="loading-msg">Loading…</p>';
}

function addIdsFromPage(list, maxmodes) {
  const ids = list === 'ml' ? idsInML : idsInUL;
  for (const m of maxmodes || []) {
    if (m?.id) {
      ids.add(m.id);
      const existing = maxmodeDetailsById.get(m.id);
      maxmodeDetailsById.set(m.id, {
        id: m.id,
        slug: m.slug || existing?.slug || '',
        title: m.title || existing?.title || '—',
        game: m.game ? { title: m.game.title } : existing?.game || null,
        creator_name: m.creator_name || existing?.creator_name || '—',
        description: m.description || existing?.description || '',
        thumbnail_url: m.thumbnail_url || existing?.thumbnail_url || '',
        ml_rank: m.ml_rank ?? existing?.ml_rank,
        ul_rank: m.ul_rank ?? existing?.ul_rank,
        list_entry: m.list_entry ?? existing?.list_entry,
        maxmode_tags: m.maxmode_tags ?? existing?.maxmode_tags,
        calculated_enjoyment: m.calculated_enjoyment ?? existing?.calculated_enjoyment,
        rng_rating: m.rng_rating ?? existing?.rng_rating,
        avg_length_seconds: m.avg_length_seconds ?? existing?.avg_length_seconds,
      });
    }
  }
}

let listIdSetsBuilt = false;

async function buildListIdSets() {
  if (listIdSetsBuilt) return;
  async function fetchAllIds(list) {
    const ids = list === 'ml' ? idsInML : idsInUL;
    let page = 1;
    let total = 1;
    while (page <= total) {
      try {
        const data = await fetchPage(list, page, '');
        total = data.totalPages ?? 1;
        addIdsFromPage(list, data.maxmodes);
        page++;
      } catch {
        break;
      }
    }
  }
  await Promise.all([fetchAllIds('ml'), fetchAllIds('ul')]);
  listIdSetsBuilt = true;
  updateProgress();
}

async function loadPage(page = currentPage, search = '') {
  if (window.location.protocol === 'file:') {
    setLoading(false);
    cardContainer.innerHTML = '<p class="error-msg">Run <code>npm start</code> in this folder and visit the URL shown (e.g. http://localhost:3000) to use the app.</p>';
    return;
  }
  const searchVal = (search || searchInput?.value || '').trim();
  setLoading(true);
  try {
    let data;
    if (currentList === 'completed') {
      data = getCompletedPageData(page, searchVal);
    } else {
      data = await fetchPage(currentList, page, searchVal);
      if (!searchVal) {
        if (currentList === 'ml') fullListTotalML = data.totalCount ?? 845;
        else fullListTotalUL = data.totalCount ?? 0;
        addIdsFromPage(currentList, data.maxmodes);
      }
    }
    totalPages = data.totalPages ?? 17;
    totalCount = data.totalCount ?? 845;
    renderCards(data.maxmodes || [], currentList);
    updateProgress();
    updatePagination();
    updateTabs();
    if (currentList !== 'completed') {
      prefetchPage(currentList, page + 1, searchVal);
      if (page > 1) prefetchPage(currentList, page - 1, searchVal);
    }
  } catch (e) {
    const isFile = window.location.protocol === 'file:';
    const hint = isFile
      ? ' Open this page via a local server instead (e.g. <code>python3 -m http.server 8000</code> then visit http://localhost:8000).'
      : '';
    cardContainer.innerHTML = `<p class="error-msg">Failed to load: ${e.message}.${hint}</p>`;
  } finally {
    setLoading(false);
  }
}

function updatePagination() {
  paginationPrev.disabled = currentPage <= 1;
  paginationNext.disabled = currentPage >= totalPages;
  paginationInfo.textContent = `Page ${currentPage} of ${totalPages}`;
}

function updateTabs() {
  tabML.classList.toggle('active', currentList === 'ml');
  tabUL.classList.toggle('active', currentList === 'ul');
  tabCompleted?.classList.toggle('active', currentList === 'completed');
  const rankToggle = document.getElementById('completed-rank-toggle');
  rankToggle?.classList.toggle('hidden', currentList !== 'completed');
  document.getElementById('completed-rank-ml')?.classList.toggle('active', completedRankMode === 'ml');
  document.getElementById('completed-rank-ul')?.classList.toggle('active', completedRankMode === 'ul');
}

function switchList(list) {
  currentList = list;
  currentPage = 1;
  loadPage(1, searchInput?.value || '');
}

function showAuthModal(show) {
  const modal = document.getElementById('auth-modal');
  if (show) modal.classList.remove('hidden');
  else modal.classList.add('hidden');
}

function updateAuthUI() {
  const guest = document.getElementById('auth-guest');
  const logged = document.getElementById('auth-logged');
  const usernameEl = document.getElementById('auth-username');
  if (authToken && apiAvailable) {
    try {
      const payload = JSON.parse(atob(authToken.split('.')[1]));
      usernameEl.textContent = payload.username || 'User';
    } catch {
      usernameEl.textContent = 'User';
    }
    guest.classList.add('hidden');
    logged.classList.remove('hidden');
    tabCompleted?.classList.remove('hidden');
  } else {
    guest.classList.remove('hidden');
    if (apiAvailable) {
      document.getElementById('auth-show-btn').textContent = 'Login / Register';
    } else {
      document.getElementById('auth-show-btn').textContent = 'Server offline';
      document.getElementById('auth-show-btn').disabled = true;
    }
    logged.classList.add('hidden');
    tabCompleted?.classList.add('hidden');
    if (currentList === 'completed') {
      currentList = 'ml';
      loadPage(1, searchInput?.value || '');
    }
  }
}

async function init() {
  headerProgress = document.getElementById('header-progress');
  progressFill = document.getElementById('progress-fill');
  cardContainer = document.getElementById('card-container');
  paginationPrev = document.getElementById('pagination-prev');
  paginationNext = document.getElementById('pagination-next');
  paginationInfo = document.getElementById('pagination-info');
  searchInput = document.getElementById('search-input');
  searchBtn = document.getElementById('search-btn');
  tabML = document.getElementById('tab-ml');
  tabUL = document.getElementById('tab-ul');
  tabCompleted = document.getElementById('tab-completed');

  try {
    const health = await fetch('/api/health');
    apiAvailable = health.ok;
  } catch {
    apiAvailable = false;
  }

  authToken = localStorage.getItem(TOKEN_KEY);
  updateAuthUI();

  document.getElementById('auth-show-btn')?.addEventListener('click', () => showAuthModal(true));
  document.getElementById('auth-close-btn')?.addEventListener('click', () => showAuthModal(false));
  document.querySelector('.auth-modal-backdrop')?.addEventListener('click', () => showAuthModal(false));

  document.getElementById('detail-modal-close')?.addEventListener('click', hideDetailModal);
  document.querySelector('.detail-modal-backdrop')?.addEventListener('click', hideDetailModal);

  document.getElementById('detail-toggle-btn')?.addEventListener('click', (e) => {
    const id = e.target.dataset.id;
    if (!id) return;
    if (completions.has(id) && currentList === 'completed') {
      hideDetailModal();
      showRemoveModal(id);
      return;
    }
    toggleCompletion(id);
    const completed = completions.has(id);
    e.target.textContent = completed ? 'Remove from completed' : 'Mark complete';
    const cards = cardContainer?.querySelectorAll(`[data-id="${id}"]`);
    cards?.forEach((card) => {
      card.classList.toggle('completed', completed);
      const thumb = card.querySelector('.card-thumb');
      const check = thumb?.querySelector('.check');
      if (completed) {
        if (!check) {
          const span = document.createElement('span');
          span.className = 'check';
          span.setAttribute('aria-hidden', 'true');
          span.textContent = '✓';
          thumb?.appendChild(span);
        }
      } else if (check) check.remove();
    });
    updateProgress();
  });

  document.getElementById('remove-modal-cancel')?.addEventListener('click', hideRemoveModal);
  document.getElementById('remove-modal-close')?.addEventListener('click', hideRemoveModal);
  document.querySelector('.remove-modal-backdrop')?.addEventListener('click', hideRemoveModal);
  document.getElementById('remove-modal-confirm')?.addEventListener('click', confirmRemove);

  document.getElementById('auth-logout-btn')?.addEventListener('click', () => {
    authToken = null;
    localStorage.removeItem(TOKEN_KEY);
    location.reload();
  });

  document.getElementById('auth-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('auth-username-input').value.trim().toLowerCase();
    const password = document.getElementById('auth-password-input').value;
    const action = e.submitter?.value || 'login';
    const errEl = document.getElementById('auth-error');
    errEl.classList.add('hidden');
    try {
      const res = await fetch(`/api/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        errEl.textContent = data.error || 'Request failed';
        errEl.classList.remove('hidden');
        return;
      }
      authToken = data.token;
      localStorage.setItem(TOKEN_KEY, authToken);
      location.reload();
    } catch (err) {
      errEl.textContent = 'Network error';
      errEl.classList.remove('hidden');
    }
  });

  await loadCompletions();

  tabML?.addEventListener('click', () => switchList('ml'));
  tabUL?.addEventListener('click', () => switchList('ul'));
  tabCompleted?.addEventListener('click', () => switchList('completed'));

  document.getElementById('completed-rank-ml')?.addEventListener('click', () => {
    completedRankMode = 'ml';
    updateTabs();
    if (currentList === 'completed') loadPage(currentPage, searchInput?.value || '');
  });
  document.getElementById('completed-rank-ul')?.addEventListener('click', () => {
    completedRankMode = 'ul';
    updateTabs();
    if (currentList === 'completed') loadPage(currentPage, searchInput?.value || '');
  });

  paginationPrev?.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      loadPage(currentPage, searchInput?.value || '');
    }
  });

  paginationNext?.addEventListener('click', () => {
    if (currentPage < totalPages) {
      currentPage++;
      loadPage(currentPage, searchInput?.value || '');
    }
  });

  searchBtn?.addEventListener('click', () => {
    currentPage = 1;
    loadPage(1, searchInput?.value || '');
  });

  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      currentPage = 1;
      loadPage(1, searchInput.value || '');
    }
  });

  let searchDebounce;
  searchInput?.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      currentPage = 1;
      loadPage(1, searchInput.value || '');
    }, 350);
  });

  await Promise.all([
    loadCompletions(),
    (async () => { motw = await fetchMOTW(); })(),
    fetchPage('ml', 1, '').catch(() => null),
  ]);
  await loadPage(1);
  buildListIdSets().then(() => updateProgress());

  async function checkForUpdates() {
    try {
      const res = await fetch('/api/check-updates');
      if (!res.ok) return;
      const data = await res.json();
      if (data.updated) {
        pageCache.clear();
        idsInML.clear();
        idsInUL.clear();
        maxmodeDetailsById.clear();
        listIdSetsBuilt = false;
        motw = null;
        const motwData = await fetchMOTW();
        if (motwData) motw = motwData;
        await loadPage(currentPage, searchInput?.value || '');
        await buildListIdSets();
        updateProgress();
      }
    } catch (_) {}
  }
  window.addEventListener('focus', checkForUpdates);
  setInterval(checkForUpdates, 6 * 60 * 60 * 1000);
}

document.addEventListener('DOMContentLoaded', init);
