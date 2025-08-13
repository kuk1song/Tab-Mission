const gridEl = document.getElementById('grid');
const searchInput = document.getElementById('search');
const toggleShots = document.getElementById('toggle-shots');
const toggleHideDiscarded = document.getElementById('toggle-hide-discarded');
const ric = window.requestIdleCallback || (cb => setTimeout(() => cb({ timeRemaining: () => 0, didTimeout: false }), 0));

let tabs = [];
let filtered = [];
let selectedIndex = 0;
let io = null;
const capturedTabIds = new Set();
let concurrent = 0;
const MAX_CONCURRENT = 4;
const captureQueue = [];

async function fetchAllTabs() {
  const [all, currentId, discardedList] = await Promise.all([
    chrome.tabs.query({}),
    awaitCurrentWindowId(),
    chrome.tabs.query({ discarded: true })
  ]);
  const hideDiscarded = toggleHideDiscarded.checked;
  let usable = all;
  if (hideDiscarded) {
    const discardedIds = new Set(discardedList.map(t => t.id));
    const now = Date.now();
    const HIDE_AGE_MS = 1000 * 60 * 60 * 24; // 24h threshold for long-unused
    usable = all.filter(t => {
      const isDiscarded = discardedIds.has(t.id);
      const last = typeof t.lastAccessed === 'number' ? t.lastAccessed : 0;
      const tooOld = last > 0 ? (now - last) > HIDE_AGE_MS : false;
      return !isDiscarded && !tooOld;
    });
  }
  // Sort: current window first, then most recently active
  usable.sort((a, b) => {
    if (a.windowId !== b.windowId) return a.windowId === currentId ? -1 : (b.windowId === currentId ? 1 : 0);
    return (b.lastAccessed || 0) - (a.lastAccessed || 0);
  });
  return usable;
}

let currentWindowIdCache = null;
async function awaitCurrentWindowId() {
  if (currentWindowIdCache !== null) return currentWindowIdCache;
  const win = await chrome.windows.getCurrent();
  currentWindowIdCache = win.id;
  return currentWindowIdCache;
}

function render() {
  gridEl.innerHTML = '';
  filtered.forEach((t, idx) => {
    const tile = document.createElement('button');
    tile.className = 'tile' + (idx === selectedIndex ? ' selected' : '');
    tile.setAttribute('data-tab-id', String(t.id));
    tile.setAttribute('data-window-id', String(t.windowId));
    if (t.url) tile.setAttribute('data-url', t.url);
    tile.addEventListener('click', () => activateTab(t));

    const img = document.createElement('img');
    img.className = 'shot';
    img.alt = '';
    // use neutral placeholder for big shot; don't stretch favicon
    img.src = '';
    tile.appendChild(img);

    const meta = document.createElement('div');
    meta.className = 'meta';
    const titleRow = document.createElement('div');
    titleRow.className = 'row';

    const fav = document.createElement('img');
    fav.className = 'favicon';
    const favUrl = safeFaviconUrl(t.favIconUrl);
    if (favUrl) fav.src = favUrl; else fav.style.opacity = '0.2';

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = t.title || '(untitled)';
    titleRow.appendChild(fav);
    titleRow.appendChild(title);
    const url = document.createElement('div');
    url.className = 'url';
    url.textContent = safeHostname(t.url);
    meta.appendChild(titleRow);
    meta.appendChild(url);
    tile.appendChild(meta);

    gridEl.appendChild(tile);
  });

  if (toggleShots.checked) ric(() => startLazyCapture());
}

function safeHostname(u) {
  try { return new URL(u).hostname; } catch { return u || ''; }
}

function safeFaviconUrl(u) {
  if (!u) return '';
  try {
    const url = new URL(u);
    // allow http(s) and data URLs; block chrome:// and extension URLs to avoid Not allowed to load local resource
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'data:') {
      return u;
    }
    return '';
  } catch {
    return '';
  }
}

function isCapturableUrl(u) {
  if (!u) return false;
  try {
    const url = new URL(u);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch { return false; }
}

async function activateTab(t) {
  await chrome.tabs.update(t.id, { active: true });
  await chrome.windows.update(t.windowId, { focused: true });
  chrome.runtime.sendMessage({ type: 'close-overview-window' });
}

function filterTabs(q) {
  const s = q.trim().toLowerCase();
  if (!s) return tabs;
  return tabs.filter(t => (t.title || '').toLowerCase().includes(s) || (t.url || '').toLowerCase().includes(s));
}

function startLazyCapture() {
  capturedTabIds.clear();
  if (io) { io.disconnect(); io = null; }
  io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const tile = entry.target;
        scheduleCapture(tile);
        io.unobserve(tile);
      }
    }
  }, { root: gridEl, threshold: 0.2 });

  const tiles = Array.from(gridEl.querySelectorAll('.tile'));
  tiles.forEach(tile => io.observe(tile));
}

function scheduleCapture(tile) {
  const tabId = Number(tile.getAttribute('data-tab-id'));
  const url = tile.getAttribute('data-url') || '';
  if (!isCapturableUrl(url) || capturedTabIds.has(tabId)) return;
  captureQueue.push(tile);
  processCaptureQueue();
}

async function processCaptureQueue() {
  if (concurrent >= MAX_CONCURRENT) return;
  const tile = captureQueue.shift();
  if (!tile) return;
  concurrent++;
  try {
    const tabId = Number(tile.getAttribute('data-tab-id'));
    const img = tile.querySelector('.shot');
    const dataUrl = await captureTabViaDebugger(tabId);
    if (dataUrl && img) {
      img.src = `data:image/jpeg;base64,${dataUrl}`;
      img.classList.add('ready');
      capturedTabIds.add(tabId);
    }
  } catch {}
  finally {
    concurrent--;
    if (captureQueue.length) processCaptureQueue();
  }
}

async function captureTabViaDebugger(tabId) {
  // Use Chrome DevTools Protocol via debugger to capture a one-shot screenshot without focusing the tab
  // Returns base64 content or '' on failure
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    const { data } = await chrome.debugger.sendCommand({ tabId }, 'Page.captureScreenshot', { format: 'jpeg', quality: 60, fromSurface: true });
    await chrome.debugger.detach({ tabId });
    return data || '';
  } catch (e) {
    try { await chrome.debugger.detach({ tabId }); } catch {}
    return '';
  }
}

async function getActiveTabInWindow(windowId) {
  const tt = await chrome.tabs.query({ windowId, active: true });
  return tt[0];
}

function updateSelection(delta) {
  if (filtered.length === 0) return;
  selectedIndex = (selectedIndex + delta + filtered.length) % filtered.length;
  render();
  scrollSelectedIntoView();
}

function scrollSelectedIntoView() {
  const el = gridEl.children[selectedIndex];
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function onKey(e) {
  if (e.key === 'Escape') {
    chrome.runtime.sendMessage({ type: 'close-overview-window' });
    return;
  }
  if (e.key === 'Enter') {
    const t = filtered[selectedIndex];
    if (t) activateTab(t);
    return;
  }
  // Arrow navigation with grid awareness
  const cols = getGridColumnCount();
  if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); updateSelection(1); }
  else if (e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)) { e.preventDefault(); updateSelection(-1); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); updateSelection(cols); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); updateSelection(-cols); }
}

async function init() {
  await awaitCurrentWindowId();
  tabs = await fetchAllTabs();
  filtered = tabs.slice();
  render();
  searchInput.focus();

  searchInput.addEventListener('input', () => {
    filtered = filterTabs(searchInput.value);
    selectedIndex = 0;
    render();
  });

  document.addEventListener('keydown', onKey);

  toggleShots.addEventListener('change', () => {
    // rerender to stop or start capture observers
    render();
  });

  toggleHideDiscarded.addEventListener('change', async () => {
    tabs = await fetchAllTabs();
    filtered = filterTabs(searchInput.value);
    selectedIndex = 0;
    render();
  });
}

init();

function getGridColumnCount() {
  const style = getComputedStyle(gridEl);
  const tpl = style.gridTemplateColumns || '';
  const count = tpl.split(' ').filter(Boolean).length;
  return Math.max(1, count || 1);
}


