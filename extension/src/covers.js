// covers.js
import { isCapturableUrl } from './utils.js';

// Covers: a picture of a web page, taken while it was in front of you, shown
// on its card. The service worker takes one with chrome.tabs.captureVisibleTab
// when you switch to a tab, it finishes loading or changes address, or its
// window gets focus, then again a few seconds later (an app may show a
// loading screen first), and when you open Tab Mission from it. Pictures are
// shrunk and kept in
// chrome.storage.session (in memory, cleared when the browser quits), one key
// per tab plus a small index of their sizes, so the oldest go first when the
// budget is full. Incognito tabs, browser pages and other windows' tabs (a
// popup, a window without focus) are never captured.
export const COVER_PREFIX = 'cover:';
export const INDEX_KEY = 'coverIndex';
export const SETTLE_MS = 500; // after a switch or a load, let the page paint
// Pictures again after these further delays while the tab stays in front:
// 3 s and 15 s after the first, then none until something happens.
export const FOLLOW_UP_MS = [2500, 12000];
export const CAPTURE_GAP_MS = 550; // Chrome allows two captures a second
export const MAX_BYTES = 6 * 1024 * 1024; // of session storage's 10 MB
export const COVER_WIDTH = 640; // a card is at most about 320 px wide

export const coverKey = (tabId) => `${COVER_PREFIX}${tabId}`;

let shrink = shrinkImage;
let nextSlot = 0; // the earliest time (performance.now) the next capture may start
let writes = Promise.resolve(); // storage updates, one at a time
const timers = new Map(); // tab id to its pending capture

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Register the listeners. Called once when the service worker starts; tests
// pass their own shrink, since images cannot be decoded outside a browser.
export function startCovers(options = {}) {
  shrink = options.shrink ?? shrinkImage;
  chrome.tabs.onActivated.addListener(({ tabId }) => schedule(tabId));
  chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (tab.active && (change.status === 'complete' || change.url)) schedule(tabId);
  });
  chrome.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return;
    try {
      const [tab] = await chrome.tabs.query({ active: true, windowId });
      if (tab) schedule(tab.id);
    } catch {}
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    clearTimeout(timers.get(tabId));
    timers.delete(tabId);
    update(() => [String(tabId)]);
  });
}

// Capture a tab once it has stayed in front for a moment, so a quick run of
// switches takes one picture, of the tab you stopped at; then follow up while
// it stays in front. Each new event starts over.
function schedule(tabId, step = 0) {
  clearTimeout(timers.get(tabId));
  timers.set(tabId, setTimeout(async () => {
    timers.delete(tabId);
    const taken = await capture(tabId).catch(() => false);
    if (taken && step < FOLLOW_UP_MS.length && !timers.has(tabId)) schedule(tabId, step + 1);
  }, step === 0 ? SETTLE_MS : FOLLOW_UP_MS[step - 1]));
}

// The tab in front of you when you press the shortcut or click the toolbar
// button: the one you are leaving, and so the likeliest one to come back to.
// Captured at once, before Tab Mission's window can cover it or take focus.
export async function coverFrontTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true, windowType: 'normal' });
    if (tab) await capture(tab.id, { front: true });
  } catch {}
}

function canCover(tab) {
  return Boolean(tab?.active && tab.status === 'complete' && !tab.incognito && isCapturableUrl(tab.url));
}

// The same page, still in front in the same window.
const unchanged = (tab, now) =>
  canCover(now) && now.url === tab.url && now.windowId === tab.windowId;

// Resolves true when a picture was stored.
async function capture(tabId, { front = false } = {}) {
  const tab = await chrome.tabs.get(tabId);
  if (!canCover(tab)) return false;
  const win = await chrome.windows.get(tab.windowId);
  if (win.type !== 'normal' || (!front && !win.focused) || win.state === 'minimized') return false;
  // Chrome rejects a third capture within a second, so captures take turns
  // (on a clock that never jumps back); after waiting for one, check that
  // the page is still in front.
  const now = performance.now();
  const start = Math.max(now, nextSlot);
  nextSlot = start + CAPTURE_GAP_MS;
  if (start > now) {
    await sleep(start - now);
    if (!unchanged(tab, await chrome.tabs.get(tabId))) return false;
  }
  const shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 85 });
  // Switched away, moved to another window or on to another page meanwhile:
  // the picture may show something else.
  if (!unchanged(tab, await chrome.tabs.get(tabId))) return false;
  const img = await shrink(shot);
  return update((index) => {
    index[tabId] = { bytes: img.length, at: Date.now() };
    return overBudget(index, MAX_BYTES);
  }, { [coverKey(tabId)]: { url: tab.url, img } },
  // A tab closed while its picture was being shrunk is not stored again
  // after its clean-up.
  () => chrome.tabs.get(tabId).then(() => true, () => false));
}

// Change the index (the change returns the tab ids whose pictures to drop)
// and store it with any new pictures, unless the optional check says no. If
// storage is full anyway, the older pictures are dropped and the new ones
// stored again. Resolves true once stored.
function update(change, items = {}, check = null) {
  writes = writes.then(async () => {
    if (check && !(await check())) return false;
    const stored = await chrome.storage.session.get(INDEX_KEY);
    const index = stored[INDEX_KEY] || {};
    const dropped = change(index);
    for (const id of dropped) delete index[id];
    if (dropped.length) await chrome.storage.session.remove(dropped.map(coverKey));
    try {
      await chrome.storage.session.set({ ...items, [INDEX_KEY]: index });
    } catch {
      const kept = Object.keys(items).map((key) => key.slice(COVER_PREFIX.length));
      const old = Object.keys(index).filter((id) => !kept.includes(id));
      await chrome.storage.session.remove(old.map(coverKey));
      for (const id of old) delete index[id];
      await chrome.storage.session.set({ ...items, [INDEX_KEY]: index });
    }
    return true;
  }).catch(() => false);
  return writes;
}

// The tab ids to drop, oldest first, until the pictures fit the budget.
export function overBudget(index, maxBytes) {
  const entries = Object.entries(index).sort(([, a], [, b]) => a.at - b.at);
  let total = entries.reduce((sum, [, e]) => sum + e.bytes, 0);
  const drop = [];
  for (const [id, e] of entries) {
    if (total <= maxBytes) break;
    drop.push(id);
    total -= e.bytes;
  }
  return drop;
}

// Shrink a capture to card size, keeping the top of the page in the cards'
// 16:10 shape (a taller window is cut at the bottom; a wider one is kept
// whole and the card crops its sides).
async function shrinkImage(dataUrl) {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const sourceHeight = Math.min(bitmap.height, Math.round(bitmap.width * 10 / 16));
  const width = Math.min(COVER_WIDTH, bitmap.width);
  const height = Math.round(sourceHeight * width / bitmap.width);
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, bitmap.width, sourceHeight, 0, 0, width, height);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.7 });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// The overview's side: the picture for a tab, if one was taken of the page
// the tab shows now.
export async function readCover(tab) {
  try {
    const key = coverKey(tab.id);
    const entry = (await chrome.storage.session.get(key))[key];
    return entry?.url === tab.url && typeof entry.img === 'string' ? entry.img : null;
  } catch {
    return null;
  }
}
