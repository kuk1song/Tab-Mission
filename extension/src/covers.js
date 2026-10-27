// covers.js
import { isCapturableUrl } from './utils.js';

// Covers: a picture of a web page, taken while it was in front of you, shown
// on its card. The service worker takes one with chrome.tabs.captureVisibleTab
// when you switch to a tab, it finishes loading or changes address, or its
// window gets focus, then again a few seconds later (an app may show a
// loading screen first), and when you open Tab Mission from it. Pictures are
// shrunk and kept in chrome.storage.local, one key per tab plus a small index
// of their pages, sizes and times, so the tabs that come back after a restart
// of the browser or an update keep theirs. A tab's picture goes when the tab
// closes, the rest when Tab Mission next opens (tidyCovers), and the oldest
// first when the budget is full. A tab Chrome puts to sleep comes back under
// a new id, and its picture moves with it. Incognito tabs, browser pages and
// other windows' tabs (a popup, a window without focus) are never captured.
const COVER_PREFIX = 'cover:';
const INDEX_KEY = 'coverIndex';
export const SETTLE_MS = 500; // after a switch or a load, let the page paint
// Pictures again after these further delays while the tab stays in front,
// each after the one before (about 3 s and 15 s after the switch), then none
// until something happens.
export const FOLLOW_UP_MS = [2500, 12000];
// A page in front that keeps changing (a video's address updating its time,
// an app's routes, a page or an ad frame reloading) would start over on every
// change. So each tab has a budget of captures: BURST at once, so a page you
// open soon after a capture is still pictured at once, and one more every
// REFILL_MS, so a page that keeps changing is captured about three times a
// minute.
export const BURST = 3;
export const REFILL_MS = 20_000;
export const CAPTURE_GAP_MS = 550; // Chrome allows two captures a second
// Chrome copies the page for a capture with no time limit. On GitHub's
// macOS runners it answered only once the page drew again, so a still
// page's picture took up to 2.7 s or never came back (PR #54); on a Mac's
// own display, and on Linux and Windows, it came back at once. One that has
// not come back within this time counts as refused, so the follow-ups try
// again.
export const CAPTURE_TIMEOUT_MS = 5000;
const MAX_BYTES = 6 * 1024 * 1024; // of local storage's 10 MB
const COVER_WIDTH = 640; // a card is at most about 320 px wide

const coverKey = (tabId) => `${COVER_PREFIX}${tabId}`;

let shrink = shrinkImage;
let nextSlot = 0; // the earliest time (performance.now) the next capture may start
let writes = Promise.resolve(); // storage updates, one at a time
const timers = new Map(); // tab id to its pending capture
const budgets = new Map(); // tab id to { left, at }: captures left at that time (performance.now)
let closing = null; // ids of tabs closed since the last storage update

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The promise's result, or a rejection once ms have passed without one.
function within(ms, promise) {
  let timer;
  const late = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

// Register the listeners. Called once when the service worker starts; tests
// pass their own shrink, since images cannot be decoded outside a browser.
export function startCovers(options = {}) {
  shrink = options.shrink ?? shrinkImage;
  chrome.tabs.onActivated.addListener(({ tabId }) => schedule(tabId));
  chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (tab.active && (change.status === 'complete' || change.url)) scheduleChange(tabId);
  });
  chrome.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return;
    try {
      const [tab] = await chrome.tabs.query({ active: true, windowId });
      if (tab) scheduleChange(tab.id);
    } catch {}
  });
  // Tabs closed together (a window) are dropped in one storage update.
  // Should storage fail before that update takes them, the next close still
  // starts a new one (tidyCovers drops the pictures left behind).
  chrome.tabs.onRemoved.addListener((tabId) => {
    forget(tabId);
    if (closing) return void closing.add(String(tabId));
    const batch = new Set([String(tabId)]);
    closing = batch;
    update(() => {
      closing = null;
      return [...batch];
    }).then(() => {
      if (closing === batch) closing = null;
    });
  });
  // Desktop Chrome puts a tab to sleep (Memory Saver, an extension) by
  // swapping it for a new one with a new id, and does not report the old id
  // closed: the picture moves to the new id, so closing the tab still
  // deletes it at once.
  chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
    forget(removedTabId);
    const moved = {}; // filled by the change, which update runs before it stores
    update(async (index) => {
      const entry = index[removedTabId] && await readEntry(removedTabId);
      if (entry) {
        index[addedTabId] = index[removedTabId];
        moved[coverKey(addedTabId)] = entry;
      }
      return [String(removedTabId)];
    }, moved);
  });
}

// A tab gone (closed, or swapped for another) takes no more pictures.
function forget(tabId) {
  clearTimeout(timers.get(tabId));
  timers.delete(tabId);
  budgets.delete(tabId);
}

// Capture a tab once it has stayed in front for a moment, so a quick run of
// switches takes one picture, of the tab you stopped at; then follow up while
// it stays in front. Each new event starts over.
function schedule(tabId, step = 0, delay = step === 0 ? SETTLE_MS : FOLLOW_UP_MS[step - 1]) {
  clearTimeout(timers.get(tabId));
  timers.set(tabId, setTimeout(async () => {
    timers.delete(tabId);
    const taken = await capture(tabId, { loading: step > 0 }).catch(() => false);
    if (taken && step < FOLLOW_UP_MS.length && !timers.has(tabId)) schedule(tabId, step + 1);
  }, delay));
}

// The page in front loaded or changed its address, or its window got focus:
// as for a switch while the tab's budget has a capture left. Otherwise a
// pending capture is left to take the change, or else one capture, with no
// follow-ups, comes once the budget has one again.
function scheduleChange(tabId) {
  const left = capturesLeft(tabId, performance.now());
  if (left >= 1) schedule(tabId);
  else if (!timers.has(tabId)) schedule(tabId, FOLLOW_UP_MS.length, (1 - left) * REFILL_MS);
}

function capturesLeft(tabId, now) {
  const budget = budgets.get(tabId);
  return budget ? Math.min(BURST, budget.left + (now - budget.at) / REFILL_MS) : BURST;
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

// A page that has not finished loading may not have painted yet, so the
// first capture waits for it; the follow-ups take it as it is (a slow ad or
// image can hold up the load for a long time), and a blank picture is never
// stored (shrinkImage).
function canCover(tab, loading = false) {
  const ready = tab?.status === 'complete' || (loading && tab?.status === 'loading');
  return Boolean(tab?.active && ready && !tab.incognito && isCapturableUrl(tab.url));
}

// Resolves true when a picture was stored, and 'loading', 'blank' or
// 'failed' when the page in front was not captured, or its picture not
// kept, only because it has not finished loading or painting or Chrome
// refused the capture or did not answer in time (the follow-ups try again;
// an answer that comes later is dropped).
async function capture(tabId, { front = false, loading = false } = {}) {
  const tab = await chrome.tabs.get(tabId);
  if (!canCover(tab, loading)) return canCover(tab, true) ? 'loading' : false;
  // The same page, still in front in the same window.
  const unchanged = (now) => canCover(now, true) && now.url === tab.url && now.windowId === tab.windowId;
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
    if (!unchanged(await chrome.tabs.get(tabId))) return false;
  }
  // Every capture takes from the budget, even if its picture is dropped below.
  const at = performance.now();
  budgets.set(tabId, { left: Math.max(0, capturesLeft(tabId, at) - 1), at });
  let raw;
  try {
    raw = await within(CAPTURE_TIMEOUT_MS, chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 85 }));
  } catch (error) {
    console.warn('Tab Mission: could not picture the tab:', error?.message ?? error);
    return 'failed';
  }
  // Switched away, moved to another window or on to another page meanwhile:
  // the picture may show something else.
  if (!unchanged(await chrome.tabs.get(tabId))) return false;
  const img = await shrink(raw);
  if (!img) return 'blank';
  return update((index) => {
    index[tabId] = { url: tab.url, bytes: img.length, at: Date.now() };
    return overBudget(index, MAX_BYTES);
  }, { [coverKey(tabId)]: { url: tab.url, img } },
  // A tab closed while its picture was being shrunk is not stored again
  // after its clean-up.
  () => chrome.tabs.get(tabId).then(() => true, () => false));
}

// Change the index (the change returns, or resolves to, the tab ids whose
// pictures to drop) and store it with any new pictures, unless the optional
// check says no. If storage is full anyway, the older pictures are dropped
// and the new ones stored again. Resolves true once stored.
function update(change, items = {}, check = null) {
  writes = writes.then(async () => {
    if (check && !(await check())) return false;
    const stored = await chrome.storage.local.get(INDEX_KEY);
    const index = stored[INDEX_KEY] || {};
    const dropped = (await change(index)).filter((id) => id in index);
    // Nothing to write (a tab without a picture closed): no disk write.
    if (!dropped.length && !Object.keys(items).length) return true;
    for (const id of dropped) delete index[id];
    if (dropped.length) await chrome.storage.local.remove(dropped.map(coverKey));
    try {
      await chrome.storage.local.set({ ...items, [INDEX_KEY]: index });
    } catch {
      const kept = Object.keys(items).map((key) => key.slice(COVER_PREFIX.length));
      const old = Object.keys(index).filter((id) => !kept.includes(id));
      await chrome.storage.local.remove(old.map(coverKey));
      for (const id of old) delete index[id];
      await chrome.storage.local.set({ ...items, [INDEX_KEY]: index });
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

// Tab ids last only as long as the browser session: after a restart, the
// pages come back in new tabs, and a picture of the page stays under the old
// id until that tab has its own (readCover finds it by address). Called when
// Tab Mission opens, once the tabs are back: keeps each tab's own picture
// and, for a tab without one, the newest picture of its page, and drops the
// rest, such as those of tabs that did not come back.
export function tidyCovers() {
  return update(async (index) => {
    const tabs = await chrome.tabs.query({});
    // A tab still on its way to its page (after a restart, say) counts with
    // the address it is going to.
    const address = (tab) => tab.url || tab.pendingUrl;
    const urls = new Map(tabs.map((tab) => [String(tab.id), address(tab)]));
    const own = new Set(Object.keys(index).filter((id) => urls.get(id) === index[id].url));
    const wanted = new Set(tabs.filter((tab) => !tab.incognito && !own.has(String(tab.id))).map(address));
    const newest = Object.entries(index).sort(([, a], [, b]) => b.at - a.at);
    return newest.filter(([id, entry]) => !own.has(id) && !wanted.delete(entry.url)).map(([id]) => id);
  });
}

// A picture of one colour throughout (a page not painted yet, or blank): at
// most 1 in 10,000 pixels differ from the first by more than a faint shade.
// Every pixel counts, so a page with only a short title is not blank (a
// sample of them could miss it). RGBA data, as from getImageData.
export function isBlank(data) {
  const allowed = data.length / 4 / 10_000;
  let differ = 0;
  for (let i = 4; i < data.length; i += 4) {
    if (Math.abs(data[i] - data[0]) > 12 || Math.abs(data[i + 1] - data[1]) > 12 || Math.abs(data[i + 2] - data[2]) > 12) {
      if (++differ > allowed) return false;
    }
  }
  return true;
}

// Shrink a capture to card size, keeping the top of the page in the cards'
// 16:10 shape (a taller window is cut at the bottom; a wider one is kept
// whole and the card crops its sides). Resolves null for a blank picture.
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
  if (isBlank(context.getImageData(0, 0, width, height).data)) return null;
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.7 });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// The overview's side: the picture for a tab, if one was taken of the page
// the tab shows now: its own, or one kept from before a restart (tidyCovers).
let pictured = null; // the index, read once per page

export async function readCover(tab) {
  if (tab.incognito) return null;
  try {
    const own = await readEntry(tab.id);
    if (own?.url === tab.url) return own.img;
    pictured ??= chrome.storage.local.get(INDEX_KEY).then((stored) => stored[INDEX_KEY] || {});
    const [match] = Object.entries(await pictured)
      .filter(([, entry]) => entry.url === tab.url)
      .sort(([, a], [, b]) => b.at - a.at);
    const kept = match && await readEntry(match[0]);
    return kept?.url === tab.url ? kept.img : null;
  } catch {
    return null;
  }
}

async function readEntry(tabId) {
  const key = coverKey(tabId);
  const entry = (await chrome.storage.local.get(key))[key];
  return typeof entry?.img === 'string' ? entry : null;
}
