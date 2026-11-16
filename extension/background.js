// background.js
import { recordTryIt, startTips } from './src/tryit.js';
import { coverFrontTab, startCovers, tidyCovers } from './src/covers.js';
import { trackUnseenTabs } from './src/unseen.js';
import { movePreviewsOfReplacedTabs } from './src/thumbnail.js';
import { readHost, frontTab, openOnPage, claimOverlay, showOverlay, closeOverlay, hostTabRemoved, hostTabLeft, tellHost, dropHost } from './src/host.js';

let overviewWindowId = null; // the open overview's window id, or null
let toggling = null; // the toggle in progress, so overlapping presses never open two windows
let overviewOpenedAt = 0; // when this worker last opened the overview

// The overview's window id is kept in chrome.storage.session: it survives a
// service worker restart but not a browser restart. Window ids are unique only
// within one browser session, so an id saved before a restart could belong to
// one of the user's own windows by now.
async function getStoredOverviewWindowId() {
	try {
		const { overviewWindowId } = await chrome.storage.session.get({ overviewWindowId: null });
		return typeof overviewWindowId === 'number' ? overviewWindowId : null;
	} catch {
		return null;
	}
}

async function setStoredOverviewWindowId(idOrNull) {
	try {
		await chrome.storage.session.set({ overviewWindowId: idOrNull ?? null });
	} catch {}
}

// True only for an open overview popup, never for one of the user's windows,
// so a stale id can never make the shortcut close the wrong window. A window
// just opened has no address yet, only the one it is going to.
async function isOverviewWindow(windowId) {
	try {
		const win = await chrome.windows.get(windowId, { populate: true });
		const tab = win.tabs?.[0];
		return win.type === 'popup' &&
			Boolean((tab?.url || tab?.pendingUrl)?.startsWith(chrome.runtime.getURL('overview.html')));
	} catch {
		return false;
	}
}

// False only when Chrome reports the window as not focused; when that cannot
// be read, the press goes to the open overview as before.
async function hasFocus(windowId) {
	try {
		return (await chrome.windows.get(windowId)).focused !== false;
	} catch {
		return true;
	}
}

async function getSavedOverviewBounds() {
	try {
		const { overviewBounds } = await chrome.storage.local.get({ overviewBounds: null });
		return overviewBounds || null;
	} catch {
		return null;
	}
}

// Find the display whose work area contains a point, if any.
function displayAt(displays, x, y) {
	return displays.find(({ workArea: a }) =>
		x >= a.left && x < a.left + a.width && y >= a.top && y < a.top + a.height);
}

function centerOf(r) {
	return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function clamp(value, min, max) {
	return Math.max(min, Math.min(value, max));
}

// The browser window the user is working in (a minimized one reports its
// restored bounds), or null.
async function lastFocusedBrowser() {
	try {
		const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
		return typeof win?.left === 'number' ? win : null;
	} catch {
		return null;
	}
}

// Open on the display of the browser window the user is working in, else on
// the primary display.
function displayFor(displays, browser) {
	if (browser) {
		const c = centerOf(browser);
		const display = displayAt(displays, c.x, c.y);
		if (display) return display;
	}
	return displays.find(d => d.isPrimary) || displays[0];
}

// Default size: 60% x 75% of the display's work area, at least 960 x 640 (five
// cards a row) and at most 1200 x 900, never more than 90% of the work area,
// centered on the display: the page stays in sight around it.
function defaultLength(length, share, least, most) {
	return Math.min(Math.max(length * share, least), most, length * 0.9);
}

function displayBounds(display) {
	const a = display.workArea;
	const width = defaultLength(a.width, 0.6, 960, 1200);
	const height = defaultLength(a.height, 0.75, 640, 900);
	return { width, height, left: a.left + (a.width - width) / 2, top: a.top + (a.height - height) / 2 };
}

// Keep a rectangle inside the work area and in whole pixels.
function fitInto(display, b) {
	const a = display.workArea;
	const width = Math.min(b.width, a.width);
	const height = Math.min(b.height, a.height);
	return {
		width: Math.round(width),
		height: Math.round(height),
		left: Math.round(clamp(b.left, a.left, a.left + a.width - width)),
		top: Math.round(clamp(b.top, a.top, a.top + a.height - height)),
	};
}

// Whether the cards are spread out (the setting, off by default). The
// overview then takes the place of the browser window instead of a size and
// spot of its own.
async function spreadOut() {
	try {
		return (await chrome.storage.local.get({ spread: false })).spread === true;
	} catch {
		return false;
	}
}

// How far below a browser window's top edge its page begins: the window is
// as high as its tab strip and toolbar plus the page of its tab in front
// (tab.height), plus, on Windows, an unseen edge below as wide as the ones
// at its sides. 0 when that cannot be told.
function pageInset(browser, tab) {
	if (!tab || tab.windowId !== browser.id || !(tab.height > 0)) return 0;
	const side = (browser.width - tab.width) / 2;
	const inset = browser.height - tab.height - (side > 0 && side <= 16 ? side : 0);
	return inset > 0 && inset < browser.height / 2 ? Math.round(inset) : 0;
}

// Where the overview opens: on the browser's display, at the size the user
// last chose (else the default size), centered, or at the spot the user last
// chose when that spot is on this display. With cover (the cards spread
// out): right over the browser window the user is working in, as large as
// it, so the whole browser turns into the overview; without such a window,
// as above. With under (the tab in front, for "tab strip in view"): over
// that tab's page only, down to the window's lower edge or the work area's.
async function overviewBounds(displays, saved, cover = false, under = null) {
	const browser = await lastFocusedBrowser();
	const display = displayFor(displays, browser);
	if (cover && browser?.width > 0 && browser?.height > 0) {
		const area = { left: browser.left, top: browser.top, width: browser.width, height: browser.height };
		const inset = pageInset(browser, under);
		const bottom = Math.min(area.top + area.height, display.workArea.top + display.workArea.height);
		if (inset > 0 && bottom - area.top - inset >= 200) {
			area.top += inset;
			area.height = bottom - area.top;
		}
		return fitInto(display, area);
	}
	const bounds = displayBounds(display);
	if (saved?.width && saved?.height) {
		const c = centerOf(bounds);
		bounds.width = saved.width;
		bounds.height = saved.height;
		bounds.left = c.x - saved.width / 2;
		bounds.top = c.y - saved.height / 2;
		if (typeof saved.left === 'number' && typeof saved.top === 'number') {
			const s = centerOf(saved);
			if (displayAt([display], s.x, s.y)) {
				bounds.left = saved.left;
				bounds.top = saved.top;
			}
		}
	}
	return fitInto(display, bounds);
}

// scope is 'site' for the "current site" shortcut, anything else for all tabs.
// source is what was used: 'shortcut', 'toolbar' (the toolbar button) or
// 'button' (the welcome page's button). A press that arrives while a toggle
// is still running is dropped, so a double press during a service worker cold
// start cannot open a second window.
// pictured: resolves once the picture of the page in front has been taken (pictureFront), if one is.
function toggleOverviewWindow(scope, source = 'shortcut', pictured = null) {
	toggling ??= runToggle(scope, source, pictured).finally(() => {
		toggling = null;
	});
	return toggling;
}

async function runToggle(scope, source, pictured) {
	// The overview open on a page (a trial, src/host.js). In front, it acts
	// on the press: the toolbar button closes it, the shortcut switches to
	// the selected tab or closes. One that does not answer (its page went
	// elsewhere) or was left behind on another tab is taken off, and the
	// press opens a new one below.
	const host = await readHost();
	if (host) {
		const front = await frontTab();
		const message = source === 'toolbar' ? { action: 'closeOverview' } : { action: 'handleShortcut', scope };
		const told = front?.id === host.tabId ? await tellHost(host, message) : false;
		// Told, or closed meanwhile by something else: the press is spent.
		if (told !== false) return;
		await dropHost(host);
	}

	// After a service worker restart, recover the open overview, if any.
	if (overviewWindowId === null) {
		const storedId = await getStoredOverviewWindowId();
		if (storedId !== null && await isOverviewWindow(storedId)) {
			overviewWindowId = storedId;
		} else if (storedId !== null) {
			await setStoredOverviewWindowId(null);
		}
	}

	if (overviewWindowId === null) {
		await openOverview(scope, source, pictured);
		return;
	}

	// The overview is open. Pressed in the overview, the page acts on the
	// press (switches to the selected tab, or closes). Pressed in another
	// window while the overview sits behind it, the page would act on its old
	// window's tabs and pull you back there, so open a fresh overview for the
	// window you are in instead. Within a second of opening, the overview may
	// not report focus yet, so a quick second press always goes to it.
	const windowId = overviewWindowId;
	// The toolbar button sits on a browser window, so clicking it always takes
	// focus from the overview first. Clicked while the overview still has
	// focus, or within a second of losing it (the overview records when),
	// the button closes it, without switching tabs: the page fades out as it
	// does for the shortcut, then closes itself. Left behind for longer, the
	// overview is out of sight, so the click opens a fresh one below.
	if (source === 'toolbar') {
		let blurredAt = 0;
		try {
			({ overviewBlurredAt: blurredAt } = await chrome.storage.session.get({ overviewBlurredAt: 0 }));
		} catch {}
		if (Date.now() - blurredAt < 1000 || (await hasFocus(windowId))) {
			overviewWindowId = null;
			await setStoredOverviewWindowId(null);
			await tellOverview(windowId, { action: 'closeOverview' });
			return;
		}
	}
	if (Date.now() - overviewOpenedAt > 1000 && !(await hasFocus(windowId))) {
		overviewWindowId = null;
		await setStoredOverviewWindowId(null);
		if (await isOverviewWindow(windowId)) {
			try {
				await chrome.windows.remove(windowId);
			} catch {}
		}
		await openOverview(scope, source, pictured);
		return;
	}
	await tellOverview(windowId, { action: 'handleShortcut', scope });
}

// Hand a message to the overview page. A page still loading may not listen
// yet (the shortcut pressed twice quickly comes that soon), so it is asked
// again once it has loaded. When it cannot answer even then (already gone),
// close its window instead.
async function tellOverview(windowId, message) {
	let tab;
	try {
		[tab] = await chrome.tabs.query({ windowId });
		if (tab) {
			await chrome.tabs.sendMessage(tab.id, message);
			return;
		}
	} catch {}
	if (tab) {
		await loaded(tab.id);
		try {
			await chrome.tabs.sendMessage(tab.id, message);
			return;
		} catch {}
	}
	if (await isOverviewWindow(windowId)) {
		try {
			await chrome.windows.remove(windowId);
		} catch {}
	}
}

// Resolves once a tab is no longer loading or is gone. The overview page
// listens from the start of its code (events.js), before it finishes
// loading. A page that hangs is given up on after a few seconds.
function loaded(tabId) {
	return new Promise((resolve) => {
		const done = () => {
			clearTimeout(timer);
			chrome.tabs.onUpdated.removeListener(onUpdated);
			chrome.tabs.onRemoved.removeListener(onRemoved);
			resolve();
		};
		const onUpdated = (id, change) => {
			if (id === tabId && change.status === 'complete') done();
		};
		const onRemoved = (id) => {
			if (id === tabId) done();
		};
		const timer = setTimeout(done, 5000);
		chrome.tabs.onUpdated.addListener(onUpdated);
		chrome.tabs.onRemoved.addListener(onRemoved);
		chrome.tabs.get(tabId).then((tab) => {
			if (tab.status !== 'loading') done();
		}, done);
	});
}

// Opened with a click (the toolbar button or the welcome page's button), the
// window may teach the shortcut (tips.js).
// The look chosen on the settings page rides in the address, so the window
// has it before its first paint (src/look.js); the defaults add nothing.
// extra: what an overview on a page has to know, and page: the name the
// page has in a frame there (src/host.js).
function overviewPath(scope, source, look = {}, extra = {}, page = 'overview.html') {
	const params = new URLSearchParams(extra);
	if (scope === 'site') params.set('scope', 'site');
	if (source !== 'shortcut') params.set('via', 'click');
	if (look.appearance === 'light' || look.appearance === 'dark') params.set('look', look.appearance);
	if (look.backdrop === 'page' || look.backdrop === 'wallpaper') params.set('backdrop', look.backdrop);
	if (look.spread === true) params.set('layout', 'spread');
	return params.size ? `${page}?${params}` : page;
}

// How long the overview on a page stays unseen for the picture of the page
// in front to be taken: it would be in a picture taken later.
const PICTURE_WAIT_MS = 200;

// The picture of the page in front, as a press takes it (covers.js):
// resolves once it has been taken, or none will be.
function pictureFront() {
	return new Promise((resolve) => {
		coverFrontTab(resolve);
	});
}

// Open the overview: in a window of its own over the browser window, or,
// with the cards spread out and the trial setting "Open as" at "tab strip in
// view", on the page in front (src/host.js). A page that cannot take it gets
// a window over the page only, so the tab strip stays in view there too.
async function openOverview(scope, source, pictured) {
	// Drop the pictures of pages no longer open (src/covers.js), meanwhile.
	tidyCovers();
	const look = await chrome.storage.local.get({ appearance: 'system', backdrop: 'plain', spread: false, openAs: 'window' }).catch(() => ({}));
	let under = null;
	if (look.spread === true && look.openAs === 'page') {
		const front = await frontTab();
		if (front && typeof front.id === 'number') {
			under = front;
			// Only web pages and files take a layer: no time is lost on the rest.
			if (/^(https?|file):/.test(front.url || '')) {
				// The layer goes on at once, unseen, and shows once the picture
				// has been taken (src/host.js).
				const clear = Promise.race([pictured ?? Promise.resolve(), new Promise((resolve) => setTimeout(resolve, PICTURE_WAIT_MS))]);
				const pathFor = (extra, page) => overviewPath(scope, source, look, extra, page);
				// A layer whose frame never shows up (src/host.js) is taken off and
				// the window opened, unless a press is being handled just then.
				const orElse = () => {
					toggling ??= createOverviewWindow(scope, source, look, front).finally(() => {
						toggling = null;
					});
				};
				if (await openOnPage(front, pathFor, orElse, clear)) return;
			}
		}
	}
	await createOverviewWindow(scope, source, look, under);
}

// under: the tab whose page the window covers, instead of its whole browser
// window (overviewBounds).
async function createOverviewWindow(scope, source, look, under = null) {
	try {
		const displays = await chrome.system.display.getInfo();
		if (!displays || displays.length === 0) {
			throw new Error('No display information found.');
		}

		const bounds = await overviewBounds(displays, await getSavedOverviewBounds(), look.spread === true, under);
		const url = chrome.runtime.getURL(overviewPath(scope, source, look));
		const win = await chrome.windows.create({ url, type: 'popup', ...bounds });
		if (win?.id) {
			overviewWindowId = win.id;
			overviewOpenedAt = Date.now();
			await setStoredOverviewWindowId(win.id);
		}
	} catch (error) {
		console.error('Tab Mission: Could not create window.', error);
		overviewWindowId = null;
	}
}

// Pictures of the pages you look at, for their cards (src/covers.js).
startCovers();

// Tabs opened in the background and not shown yet, which are not the
// previous tab (src/unseen.js).
trackUnseenTabs();

// A tab put to sleep keeps the preview image found for it (src/thumbnail.js).
movePreviewsOfReplacedTabs();

// Listen for the commands to open/toggle the overview. A keyboard command
// also ticks the welcome page's first step; the toolbar button below does
// not. Both take a picture of the page in front of you. Neither is awaited,
// so the press is handled as before.
chrome.commands.onCommand.addListener((command) => {
	if (command === 'open-overview') {
		recordTryIt('open');
		toggleOverviewWindow(undefined, 'shortcut', pictureFront());
	} else if (command === 'open-overview-site') {
		recordTryIt('open');
		toggleOverviewWindow('site', 'shortcut', pictureFront());
	}
});

// Also listen for the browser action icon click to toggle.
chrome.action.onClicked.addListener(() => {
	toggleOverviewWindow(undefined, 'toolbar', pictureFront());
});

// First install: open a short welcome page that shows the shortcut (or says
// that none could be assigned) so new users are not left guessing.
chrome.runtime.onInstalled.addListener(({ reason }) => {
	if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
		// A new user: the Tab Mission window shows its tips until learned.
		startTips();
		chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') }).catch(() => {});
	}
	if (reason === chrome.runtime.OnInstalledReason.UPDATE) {
		// Drop keys that older versions saved: the last search text, the window
		// id (now kept in session storage) and the unused art mode switch.
		chrome.storage.local.remove(['searchTerm', 'overviewWindowId', 'artMode']).catch(() => {});
	}
});

// Reset: forget the saved size and position and move the open overview to
// where a first open would put it. The move is not saved as the user's
// choice, so later opens keep following the default rule.
let ignoreBoundsUntil = 0;

async function resetWindowBounds() {
	await chrome.storage.local.set({ overviewBounds: null });
	const storedId = await getStoredOverviewWindowId();
	if (!storedId) return;
	const displays = await chrome.system.display.getInfo();
	ignoreBoundsUntil = Date.now() + 1000;
	await chrome.windows.update(storedId, await overviewBounds(displays, null, await spreadOut()));
}

// Not an async listener: Chrome keeps the response channel open only when the
// listener synchronously returns true.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
	if (request?.action === 'resetWindowBounds') {
		resetWindowBounds().then(
			() => sendResponse({ ok: true }),
			(e) => sendResponse({ ok: false, error: e?.message || String(e) }),
		);
		return true; // async response
	}
	// The overview in a frame on a page (src/host.js): it shows only once
	// its token is taken here, and asks to be taken off when it is done.
	if (request?.action === 'claimOverlay') {
		claimOverlay(request.token, sender).then((ok) => sendResponse({ ok }), () => sendResponse({ ok: false }));
		return true; // async response
	}
	if (request?.action === 'showOverlay') {
		showOverlay(sender).then((ok) => sendResponse({ ok }), () => sendResponse({ ok: false }));
		return true; // async response
	}
	if (request?.action === 'closeOverlay') {
		closeOverlay(sender, request.refused === true);
		return false;
	}
	// The welcome page's "Open Tab Mission" button.
	if (request?.action === 'openOverview') {
		toggleOverviewWindow(request.scope, 'button');
	}
	return false;
});

// Remember the overview's size and position whenever they change.
chrome.windows.onBoundsChanged.addListener(async (win) => {
	const id = overviewWindowId ?? await getStoredOverviewWindowId();
	if (win.id !== id || Date.now() < ignoreBoundsUntil) return;
	// Spread out, the overview follows the browser window: a size given to
	// it then is not the one to come back to.
	if (await spreadOut()) return;
	try {
		await chrome.storage.local.set({
			overviewBounds: { width: win.width, height: win.height, top: win.top, left: win.left },
		});
	} catch {}
});

// The overview's own tab closed, or the tab whose page it was on (src/host.js).
chrome.tabs.onRemoved.addListener((tabId) => hostTabRemoved(tabId));
// Another tab of its window came to the front: it is done there.
chrome.tabs.onActivated.addListener(({ tabId, windowId }) => hostTabLeft(tabId, windowId));

chrome.windows.onRemoved.addListener(async (windowId) => {
	const id = overviewWindowId ?? await getStoredOverviewWindowId();
	if (windowId !== id) return;
	overviewWindowId = null;
	await setStoredOverviewWindowId(null);
});
