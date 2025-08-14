const gridEl = document.getElementById('grid');
const searchInput = document.getElementById('search');
const toggleShots = document.getElementById('toggle-shots');
const toggleHideDiscarded = document.getElementById('toggle-hide-discarded');
const toggleCurrentWindow = document.getElementById('toggle-current-window');
const toggleDebug = document.getElementById('toggle-debug');
const toggleDomShots = document.getElementById('toggle-dom-shots');
const toggleArt = document.getElementById('toggle-art');
const ric = window.requestIdleCallback || (cb => setTimeout(() => cb({ timeRemaining: () => 0, didTimeout: false }), 0));

let tabs = [];
let filtered = [];
let selectedIndex = 0;
let io = null;
let ioDom = null;
const capturedTabIds = new Set();
const uncapturableTabIds = new Set();
let rerenderPending = false;
let concurrent = 0;
const CPU_HALF = Math.max(1, Math.floor((navigator.hardwareConcurrency || 4) / 2));
const MAX_CONCURRENT = Math.max(2, Math.min(4, CPU_HALF));
const captureQueue = [];
const domCaptureQueue = [];
let domConcurrent = 0;
const DOM_MAX_CONCURRENT = Math.max(2, Math.min(4, CPU_HALF));
const DOM_CACHE_TTL_MS = 60 * 1000;
const domThumbCache = new Map(); // key = `${tabId}|${url}` -> { dataUrl, t }

async function fetchAllTabs() {
  const currentId = await awaitCurrentWindowId();
  const scopeQuery = toggleCurrentWindow.checked ? { windowId: currentId } : {};
  const [all, discardedList] = await Promise.all([
    chrome.tabs.query(scopeQuery),
    chrome.tabs.query({ discarded: true, ...scopeQuery })
  ]);
  const hideDiscarded = toggleHideDiscarded.checked;
  let usable = all;
  if (hideDiscarded) {
    const discardedIds = new Set(discardedList.map(t => t.id));
    usable = all.filter(t => !discardedIds.has(t.id));
  }
  // Sort: current window first, then most recently active
  usable.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  return usable;
}

async function awaitCurrentWindowId() {
  // Always fetch fresh; do not cache to avoid stale selection while popup is focused
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    return win.id;
  } catch {
    const win = await chrome.windows.getCurrent();
    return win.id;
  }
}

function render() {
  gridEl.innerHTML = '';
  gridEl.classList.toggle('art', !!toggleArt.checked);
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
    // lightweight local placeholder to avoid black tiles before capture
    img.src = makePlaceholderDataUrl(t.title || safeHostname(t.url), safeHostname(t.url));
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
    if (toggleDebug.checked) {
      const dbg = document.createElement('div');
      dbg.className = 'url';
      const last = typeof t.lastAccessed === 'number' ? ((Date.now() - t.lastAccessed) / 60000) : null;
      dbg.textContent = `[id:${t.id}] discarded=${!!t.discarded} autoDiscardable=${!!t.autoDiscardable} last=${last!==null?last.toFixed(1)+'m ago':'n/a'}`;
      meta.appendChild(dbg);
    }
    meta.appendChild(titleRow);
    meta.appendChild(url);
    tile.appendChild(meta);

    // Optional art mode span handled later
    gridEl.appendChild(tile);
  });

  if (toggleShots.checked && !toggleDomShots.checked) ric(() => startLazyCapture());
  if (toggleDomShots.checked && !toggleShots.checked) ric(() => startLazyDomCapture());
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

function makePlaceholderDataUrl(title, host) {
  try {
    const canvas = document.createElement('canvas');
    const W = 640, H = 400;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0e1116'); g.addColorStop(1, '#1a1f2b');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.font = '16px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial';
    ctx.fillText((title || '').slice(0, 60), 12, 18);
    ctx.fillStyle = '#9aa0a6';
    ctx.font = '12px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial';
    ctx.fillText(host || '', 12, H - 20);
    return canvas.toDataURL('image/jpeg', 0.6);
  } catch { return ''; }
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
  }, { root: gridEl, threshold: 0.1, rootMargin: '400px 0px' });

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
    // ensure Page domain enabled to reduce overhead
    try { await chrome.debugger.sendCommand({ tabId }, 'Page.enable'); } catch {}
    const { data } = await chrome.debugger.sendCommand({ tabId }, 'Page.captureScreenshot', { format: 'jpeg', quality: 55, fromSurface: true, captureBeyondViewport: false });
    try { await chrome.debugger.sendCommand({ tabId }, 'Page.disable'); } catch {}
    await chrome.debugger.detach({ tabId });
    return data || '';
  } catch (e) {
    try { await chrome.debugger.detach({ tabId }); } catch {}
    return '';
  }
}

function startLazyDomCapture() {
  if (ioDom) { ioDom.disconnect(); ioDom = null; }
  ioDom = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const tile = entry.target;
        scheduleDomCapture(tile);
        ioDom.unobserve(tile);
      }
    }
  }, { root: gridEl, threshold: 0.1, rootMargin: '400px 0px' });

  const tiles = Array.from(gridEl.querySelectorAll('.tile'));
  // observe only within viewport + rootMargin
  tiles.forEach(tile => ioDom.observe(tile));
}

function scheduleDomCapture(tile) {
  const tabId = Number(tile.getAttribute('data-tab-id'));
  const url = tile.getAttribute('data-url') || '';
  const img = tile.querySelector('.shot');
  if (!isCapturableUrl(url) || !img) return;
  const key = `${tabId}|${url}`;
  const cached = domThumbCache.get(key);
  const now = Date.now();
  if (cached && (now - cached.t) < DOM_CACHE_TTL_MS) {
    img.src = cached.dataUrl;
    img.classList.add('ready');
    return;
  }
  domCaptureQueue.push(tile);
  processDomCaptureQueue();
}

async function processDomCaptureQueue() {
  if (domConcurrent >= DOM_MAX_CONCURRENT) return;
  const tile = domCaptureQueue.shift();
  if (!tile) return;
  domConcurrent++;
  try {
    const tabId = Number(tile.getAttribute('data-tab-id'));
    const url = tile.getAttribute('data-url') || '';
    const img = tile.querySelector('.shot');
    const key = `${tabId}|${url}`;
    const timeoutMs = 900;
    const exec = chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: async () => {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const W = Math.floor(640 * dpr);
        const H = Math.floor(400 * dpr);
        const title = (document.title || '').slice(0, 140);
        const host = location.hostname;

        // Helpers: pick best preview from many semantic sources
        const pickOg = () => {
          const metas = [
            'meta[property="og:image"]',
            'meta[name="og:image"]',
            'meta[property="og:image:url"]',
            'meta[property="og:image:secure_url"]',
            'meta[name="twitter:image"]',
            'meta[name="twitter:image:src"]',
            'meta[itemprop="image"]'
          ];
          for (const sel of metas) {
            const m = document.querySelector(sel);
            if (m && m.content) return m.content;
          }
          return '';
        };

        const pickLinkImage = () => {
          const links = [
            'link[rel="image_src"]',
            'link[rel="thumbnail"]',
            'link[rel="preload"][as="image"]'
          ];
          for (const sel of links) {
            const l = document.querySelector(sel);
            if (l && (l.href || l.getAttribute('href'))) return l.href || l.getAttribute('href');
          }
          return '';
        };

        const pickVideoPoster = () => {
          const v = document.querySelector('video[poster]');
          return v ? (v.getAttribute('poster') || '') : '';
        };

        const getBgUrl = (el) => {
          const bg = getComputedStyle(el).backgroundImage || '';
          const m = bg.match(/url\(["']?(.*?)["']?\)/);
          return m ? m[1] : '';
        };

        const pickBackgroundImage = () => {
          const candidates = [
            '.hero', '.Hero', '.banner', '.Banner', '.cover', '.Cover', '.masthead', '.post-cover', '.featured', '.featured-image', 'header'
          ];
          for (const sel of candidates) {
            const el = document.querySelector(sel);
            if (el) {
              const u = getBgUrl(el);
              if (u) return u;
              const im = el.querySelector('img');
              if (im) return im.currentSrc || im.src || '';
            }
          }
          return '';
        };

        const parseSrc = (img) => {
          if (!img) return '';
          if (img.currentSrc) return img.currentSrc;
          const ss = img.getAttribute('srcset') || '';
          if (ss) {
            const parts = ss.split(',').map(s => s.trim());
            // pick largest descriptor
            const last = parts[parts.length - 1] || '';
            const url = (last.split(' ') || [])[0];
            if (url) return url;
          }
          return img.src || '';
        };

        const pickLargestImg = () => {
          let best = null; let bestArea = 0;
          const imgs = Array.from(document.images || []);
          for (const im of imgs) {
            const r = im.getBoundingClientRect();
            const area = Math.max(0, r.width) * Math.max(0, r.height);
            if (area > bestArea && r.width >= 160 && r.height >= 100) {
              best = im; bestArea = area;
            }
          }
          return best ? parseSrc(best) : '';
        };

        // First preference: return a direct preview URL to avoid canvas taint
        let previewUrl = '';
        try {
          let url = pickOg();
          if (!url) url = pickLinkImage();
          if (!url) url = pickVideoPoster();
          if (!url) url = pickBackgroundImage();
          if (!url) url = pickLargestImg();
          if (url) previewUrl = url;
        } catch {}
        if (previewUrl) return { previewUrl };
        // Fallback: return a lightweight text-only dataURL
        try {
          const canvas = document.createElement('canvas');
          canvas.width = W; canvas.height = H;
          const ctx = canvas.getContext('2d');
          const grad = ctx.createLinearGradient(0, 0, 0, H);
          grad.addColorStop(0, '#0e1116'); grad.addColorStop(1, '#1a1f2b');
          ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
          ctx.fillStyle = '#fff';
          ctx.font = `${Math.floor(16 * dpr)}px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial`;
          ctx.fillText(title || host, Math.floor(12 * dpr), Math.floor(18 * dpr));
          ctx.fillStyle = '#9aa0a6';
          ctx.font = `${Math.floor(12 * dpr)}px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial`;
          ctx.fillText(host, Math.floor(12 * dpr), H - Math.floor(20 * dpr));
          return { dataUrl: canvas.toDataURL('image/jpeg', 0.62) };
        } catch { return { dataUrl: '' }; }
      }
    });
    const resultArr = await Promise.race([
      exec,
      new Promise((_, rej) => setTimeout(() => rej(new Error('dom-capture-timeout')), timeoutMs))
    ]);
    const [{ result } = {}] = Array.isArray(resultArr) ? resultArr : [];
    if (result && typeof result === 'object') {
      if (result.previewUrl) {
        img.src = result.previewUrl;
        img.classList.add('ready');
        domThumbCache.set(key, { dataUrl: result.previewUrl, t: Date.now() });
      } else if (result.dataUrl) {
        img.src = result.dataUrl;
        img.classList.add('ready');
        domThumbCache.set(key, { dataUrl: result.dataUrl, t: Date.now() });
      }
    }
  } catch {}
  finally {
    domConcurrent--;
    if (domCaptureQueue.length) processDomCaptureQueue();
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

  toggleCurrentWindow.addEventListener('change', async () => {
    tabs = await fetchAllTabs();
    filtered = filterTabs(searchInput.value);
    selectedIndex = 0;
    render();
  });

  toggleDebug.addEventListener('change', async () => {
    render();
  });

  toggleDomShots.addEventListener('change', () => {
    render();
  });

  toggleArt.addEventListener('change', () => {
    applyArtLayout();
  });
}

init();

function getGridColumnCount() {
  const style = getComputedStyle(gridEl);
  const tpl = style.gridTemplateColumns || '';
  const count = tpl.split(' ').filter(Boolean).length;
  return Math.max(1, count || 1);
}

function applyArtLayout() {
  const enable = toggleArt.checked;
  const tiles = Array.from(gridEl.querySelectorAll('.tile'));
  if (!enable) {
    tiles.forEach(tile => tile.style.gridRowEnd = '');
    return;
  }
  // Simple heuristic: recent tabs larger; map index to span rows
  // Base row unit is 8px (see CSS). Span to approximate 16:10 cards of various sizes.
  const sizes = [24, 20, 20, 16, 16, 16, 12, 12, 12, 12];
  tiles.forEach((tile, i) => {
    const span = sizes[i % sizes.length];
    tile.style.gridRowEnd = `span ${span}`;
  });
}


