// host.js: the overview shown elsewhere than in a window of its own. A trial
// (settings page, "Open as", with the cards spread out): as a layer over the
// page in front of you, so the browser's tab strip stays in view.
// Runs in the service worker (background.js); the overview page's part is
// in state.js, events.js and main.js (state.host).
//
// On a page, the overview is overlay.html (the same page as overview.html,
// under a name of its own) in a frame the size of the page's view, put
// there with chrome.scripting. Only overlay.html can be framed by pages
// (manifest.json, web_accessible_resources), and only under an address that
// changes with every browser session, so a page cannot tell from it that
// Tab Mission is installed. A page that learns the address still gets an
// empty frame: the overview shows in a frame only with a token this worker
// made for that tab moments before, and each token works once
// (claimOverlay).

const KEY = 'overviewHost';
export const OVERLAY_PAGE = 'overlay.html';
// A page that does not take the layer within this time (busy, or still on
// its way) gets the window instead.
export const MOUNT_WAIT_MS = 300;
// So does a page on which the layer's frame has not asked to be let in
// after this time (the page does not let the frame load): the layer would
// lie over the page, empty, and take its clicks.
export const CLAIM_WAIT_MS = 1500;
// A press goes to an overview that opened this recently even before it
// listens (the shortcut pressed twice quickly), asked again until it does.
const FRESH_MS = 2000;
const TOKEN_MS = 10000;
// A picture of the page started this soon after the layer was asked off
// could still show it.
const OFF_MARGIN_MS = 1000;

const after = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// { kind: 'page', tabId, windowId, at, token, claimed?, frameId? }
// or null. Kept in chrome.storage.session: it survives a service worker
// restart, not a browser restart (tab ids are unique only within one
// browser session).
export async function readHost() {
  try {
    const { [KEY]: host } = await chrome.storage.session.get({ [KEY]: null });
    return host && typeof host.tabId === 'number' ? host : null;
  } catch {
    return null;
  }
}

async function writeHost(host) {
  try {
    await chrome.storage.session.set({ [KEY]: host });
  } catch {}
}

const same = (a, b) => Boolean(a && b && a.tabId === b.tabId && a.at === b.at);

// The tab in front in the browser window the user is working in, or null.
export async function frontTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true, windowType: 'normal' });
    return tab ?? null;
  } catch {
    return null;
  }
}

// As a layer over the page in front. Resolves false when the page cannot
// take it (a browser page, a page that is busy or has not arrived): the
// caller opens the window then. So does orElse, later, when the layer's
// frame never shows up.
export async function openOnPage(front, pathFor, orElse) {
  const token = crypto.randomUUID();
  await writeHost({ kind: 'page', tabId: front.id, windowId: front.windowId, at: Date.now(), token });
  const mounting = chrome.scripting.executeScript({
    target: { tabId: front.id },
    injectImmediately: true,
    func: mountOverlay,
    args: [pathFor({ host: 'page', token }, OVERLAY_PAGE), token],
  }).then(([result]) => result?.result === true, () => false);
  const mounted = await Promise.race([mounting, after(MOUNT_WAIT_MS).then(() => false)]);
  if (mounted) {
    after(CLAIM_WAIT_MS).then(async () => {
      const host = await readHost();
      if (host?.token !== token || host.claimed) return;
      await dropHost(host);
      orElse?.();
    });
    return true;
  }
  // Too late or not at all: the token is void from here on, and that layer,
  // should it still arrive, is taken off again (not one put on since).
  const host = await readHost();
  if (host?.token === token) await writeHost(null);
  mounting.then((late) => late && removeOverlay(front.id, token));
  return false;
}

// The overview in a frame asks before it shows anything: true only for the
// frame this worker just put on that tab, once.
export async function claimOverlay(token, sender) {
  const host = await readHost();
  if (host?.kind !== 'page' || host.claimed || !token || host.token !== token) return false;
  if (sender?.tab?.id !== host.tabId || Date.now() - host.at > TOKEN_MS) return false;
  await writeHost({ ...host, claimed: true, frameId: sender.frameId ?? null });
  return true;
}

// The overview on a page is done (it asks, events.js): take the layer off
// and forget it. A frame that was refused asks too (main.js): for a layer
// that arrived too late, or for the open overview's own frame loaded again
// (Chrome's "Reload frame"), which would lie over the page empty. A frame
// the page made itself is another frame, and nothing is done for it.
export async function closeOverlay(sender, refused = false) {
  const tabId = sender?.tab?.id;
  if (typeof tabId !== 'number') return;
  const host = await readHost();
  if (host?.kind === 'page' && host.tabId === tabId) {
    if (refused && sender.frameId !== host.frameId) return;
    await forgetHost(host);
  }
  await removeOverlay(tabId);
}

// token: only the layer put on with it.
async function removeOverlay(tabId, token = null) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, injectImmediately: true, func: unmountOverlay, args: [token] });
  } catch {}
}

// Until when a picture of this tab could show the overview over its page:
// covers.js takes none meanwhile and drops one already on its way.
const LAST_KEY = 'overlayLast';

async function forgetHost(host) {
  try {
    await chrome.storage.session.set({
      [KEY]: null,
      [LAST_KEY]: { tabId: host.tabId, until: Date.now() + OFF_MARGIN_MS },
    });
  } catch {}
}

// Whether the overview was over this tab's page at any time since `since`
// (Date.now()), or still is.
export async function overlaidSince(tabId, since) {
  try {
    const { [KEY]: host, [LAST_KEY]: last } = await chrome.storage.session.get({ [KEY]: null, [LAST_KEY]: null });
    if (host?.kind === 'page' && host.tabId === tabId) return true;
    return last?.tabId === tabId && last.until >= since;
  } catch {
    return false;
  }
}

// A tab closed: the overview that was over its page is gone.
export async function hostTabRemoved(tabId) {
  const host = await readHost();
  if (host?.tabId === tabId) await forgetHost(host);
}

// Another tab of the overview's window came to the front (chosen in the
// overview, or in the tab strip; a new tab): the overview is done there.
export async function hostTabLeft(tabId, windowId) {
  const host = await readHost();
  if (host && host.windowId === windowId && host.tabId !== tabId) await dropHost(host);
}

// Hand a message to the open overview, which answers { ok: true } (a frame
// that was refused does not, events.js). One just opened may not listen
// yet, so it is asked again for a moment. Resolves true once it has
// answered; false when it never does (its page went elsewhere, its frame
// was loaded again); null when it was closed meanwhile, by something else.
export async function tellHost(host, message) {
  for (;;) {
    try {
      if ((await chrome.tabs.sendMessage(host.tabId, message))?.ok === true) return true;
    } catch {}
    if (!same(await readHost(), host)) return null;
    if (Date.now() - host.at > FRESH_MS) return false;
    await after(50);
  }
}

// An overview that does not answer, or was left behind on another tab, is
// taken off. Not waited for: a busy page takes it off when it can.
export async function dropHost(host) {
  await forgetHost(host);
  removeOverlay(host.tabId);
}

// Runs in the page (its isolated world): a frame with the overview over the
// whole view, above everything the page shows (the top layer, where the
// page's own dialogs and full-screen elements are). Inside a closed shadow
// root, so the page's styles do not reach the frame and its scripts cannot
// read the frame's address. Nothing else of the page is touched.
function mountOverlay(path, token) {
  const KEY = '__tabMissionOverlay';
  globalThis[KEY]?.host.remove();
  if (!document.documentElement) return false;
  const style = (el, rules) => {
    for (const [name, value] of Object.entries(rules)) el.style.setProperty(name, value, 'important');
  };
  const host = document.createElement('div');
  style(host, {
    all: 'initial', position: 'fixed', inset: '0', width: '100%', height: '100%', 'max-width': 'none', 'max-height': 'none',
    margin: '0', padding: '0', border: '0', background: 'none', overflow: 'hidden', display: 'block', 'z-index': '2147483647',
  });
  const frame = document.createElement('iframe');
  frame.title = 'Tab Mission';
  frame.setAttribute('allow', '');
  style(frame, { position: 'absolute', inset: '0', width: '100%', height: '100%', border: '0', margin: '0', display: 'block' });
  frame.src = chrome.runtime.getURL(path);
  host.attachShadow({ mode: 'closed' }).append(frame);
  // What had the keyboard gets it back when the overview closes.
  globalThis[KEY] = { host, token, back: document.activeElement };
  document.documentElement.append(host);
  try {
    host.popover = 'manual';
    host.showPopover();
  } catch {}
  frame.focus({ preventScroll: true });
  return true;
}

function unmountOverlay(token) {
  const KEY = '__tabMissionOverlay';
  const overlay = globalThis[KEY];
  if (!overlay || (token && overlay.token !== token)) return;
  globalThis[KEY] = null;
  overlay.host.remove();
  try {
    if (overlay.back?.isConnected && overlay.back !== document.body) overlay.back.focus({ preventScroll: true });
  } catch {}
}
