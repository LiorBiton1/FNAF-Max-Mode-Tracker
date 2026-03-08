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
let currentList = 'ml';
let currentPage = 1;
let totalPages = 17;
let totalCount = 845;
let fullListTotalML = 845;
let fullListTotalUL = 0;
let motw = null;

// DOM elements
let headerProgress, progressFill, cardContainer, paginationPrev, paginationNext, paginationInfo, searchInput, searchBtn;
let tabML, tabUL;

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

function toggleCompletion(id) {
  if (completions.has(id)) {
    completions.delete(id);
  } else {
    completions.add(id);
  }
  saveCompletions();
  updateProgress();
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
  return completions.size;
}

function getFullListTotal() {
  return currentList === 'ml' ? fullListTotalML : fullListTotalUL;
}

function updateProgress() {
  const count = getCompletionsCount(currentList);
  const fullTotal = getFullListTotal();
  const pct = fullTotal > 0 ? Math.round((count / fullTotal) * 100) : 0;
  headerProgress.textContent = `${count} / ${fullTotal} completed (${pct}%)`;
  if (progressFill && fullTotal > 0) {
    progressFill.style.width = `${pct}%`;
  }
}

async function fetchPage(list, page, search = '') {
  const params = new URLSearchParams({ list, page: String(page) });
  if (search.trim()) params.set('search', search.trim());
  const url = `${API_BASE}/maxmodes/list?${params}`;
  const res = await fetchWithCorsFallback(url);
  return res.json();
}

async function fetchMOTW() {
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

function renderCard(m, list) {
  const completed = completions.has(m.id);
  const rank = m.ml_rank ?? m.ul_rank ?? m.list_entry?.position ?? '—';
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
      <h3 class="card-title">#${rank} ${escapeHtml(m.title)}</h3>
      <p class="card-meta">${escapeHtml(m.game?.title || '—')} · ${escapeHtml(m.creator_name || '—')}</p>
      ${tags.length ? `<p class="card-tags">${tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</p>` : ''}
      <p class="card-stats">Enjoyment: ${enjoyment} · RNG: ${rng} · ~${duration}</p>
    </div>
  `;

  card.addEventListener('click', () => toggleCompletion(m.id));
  return card;
}

function escapeHtml(s) {
  if (s == null) return '';
  const div = document.createElement('div');
  div.textContent = String(s);
  return div.innerHTML;
}

function renderCards(maxmodes, list) {
  cardContainer.innerHTML = '';
  for (const m of maxmodes || []) {
    cardContainer.appendChild(renderCard(m, list));
  }
}

function setLoading(loading) {
  cardContainer.classList.toggle('loading', loading);
  if (loading) cardContainer.innerHTML = '<p class="loading-msg">Loading…</p>';
}

async function loadPage(page = currentPage, search = '') {
  if (window.location.protocol === 'file:') {
    setLoading(false);
    cardContainer.innerHTML = '<p class="error-msg">Run <code>npm start</code> in this folder and visit the URL shown (e.g. http://localhost:3000) to use the app.</p>';
    return;
  }
  setLoading(true);
  try {
    const data = await fetchPage(currentList, page, search);
    totalPages = data.totalPages ?? 17;
    totalCount = data.totalCount ?? 845;
    if (!search.trim()) {
      if (currentList === 'ml') fullListTotalML = data.totalCount ?? 845;
      else fullListTotalUL = data.totalCount ?? 0;
    }
    renderCards(data.maxmodes || [], currentList);
    updateProgress();
    updatePagination();
    updateTabs();
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
  } else {
    guest.classList.remove('hidden');
    if (apiAvailable) {
      document.getElementById('auth-show-btn').textContent = 'Login / Register';
    } else {
      document.getElementById('auth-show-btn').textContent = 'Server offline';
      document.getElementById('auth-show-btn').disabled = true;
    }
    logged.classList.add('hidden');
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

  document.getElementById('auth-logout-btn')?.addEventListener('click', () => {
    authToken = null;
    localStorage.removeItem(TOKEN_KEY);
    updateAuthUI();
    loadCompletions();
    updateProgress();
    const cards = cardContainer?.querySelectorAll('.card');
    cards?.forEach((c) => {
      const id = c.dataset.id;
      c.classList.toggle('completed', completions.has(id));
    });
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
      showAuthModal(false);
      document.getElementById('auth-username-input').value = '';
      document.getElementById('auth-password-input').value = '';
      updateAuthUI();
      await loadCompletions();
      updateProgress();
      const cards = cardContainer?.querySelectorAll('.card');
      cards?.forEach((card) => {
        const id = card.dataset.id;
        const done = completions.has(id);
        card.classList.toggle('completed', done);
        const thumb = card.querySelector('.card-thumb');
        const check = thumb?.querySelector('.check');
        if (done) {
          if (!check) {
            const span = document.createElement('span');
            span.className = 'check';
            span.setAttribute('aria-hidden', 'true');
            span.textContent = '✓';
            thumb?.appendChild(span);
          }
        } else if (check) check.remove();
      });
    } catch (err) {
      errEl.textContent = 'Network error';
      errEl.classList.remove('hidden');
    }
  });

  await loadCompletions();

  tabML?.addEventListener('click', () => switchList('ml'));
  tabUL?.addEventListener('click', () => switchList('ul'));

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

  motw = await fetchMOTW();
  loadPage(1);
}

document.addEventListener('DOMContentLoaded', init);
