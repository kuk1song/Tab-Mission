// background.js
import { recordTryIt, startTips } from './src/tryit.js';
import { coverFrontTab, startCovers, tidyCovers } from './src/covers.js';
import { trackUnseenTabs } from './src/unseen.js';

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

// Default size: 88% x 90% of the display's work area (at most 1400 x 1000),
// centered on the display.
function displayBounds(display) {
	const a = display.workArea;
	const width = Math.min(a.width * 0.88, 1400);
	const height = Math.min(a.height * 0.9, 1000);
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

// Where the overview opens: on the browser's display, at the size the user
// last chose (else the default size), centered, or at the spot the user last
// chose when that spot is on this display.
async function overviewBounds(displays, saved) {
	const display = displayFor(displays, await lastFocusedBrowser());
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
function toggleOverviewWindow(scope, source = 'shortcut') {
	toggling ??= runToggle(scope, source).finally(() => {
		toggling = null;
	});
	return toggling;
}

async function runToggle(scope, source) {
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
		await createOverviewWindow(scope, source);
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
		await createOverviewWindow(scope, source);
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
function overviewPath(scope, source) {
	const params = new URLSearchParams();
	if (scope === 'site') params.set('scope', 'site');
	if (source !== 'shortcut') params.set('via', 'click');
	return params.size ? `overview.html?${params}` : 'overview.html';
}

async function createOverviewWindow(scope, source) {
	// Drop the pictures of pages no longer open (src/covers.js), meanwhile.
	tidyCovers();
	try {
		const displays = await chrome.system.display.getInfo();
		if (!displays || displays.length === 0) {
			throw new Error('No display information found.');
		}

		const bounds = await overviewBounds(displays, await getSavedOverviewBounds());

		const win = await chrome.windows.create({
			url: chrome.runtime.getURL(overviewPath(scope, source)),
			type: 'popup',
			...bounds,
		});
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

// Listen for the commands to open/toggle the overview. A keyboard command
// also ticks the welcome page's first step; the toolbar button below does
// not. Both take a picture of the page in front of you. Neither is awaited,
// so the press is handled as before.
chrome.commands.onCommand.addListener((command) => {
	if (command === 'open-overview') {
		recordTryIt('open');
		coverFrontTab();
		toggleOverviewWindow();
	} else if (command === 'open-overview-site') {
		recordTryIt('open');
		coverFrontTab();
		toggleOverviewWindow('site');
	}
});

// Also listen for the browser action icon click to toggle.
chrome.action.onClicked.addListener(() => {
	coverFrontTab();
	toggleOverviewWindow(undefined, 'toolbar');
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
	await chrome.windows.update(storedId, await overviewBounds(displays, null));
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
	try {
		await chrome.storage.local.set({
			overviewBounds: { width: win.width, height: win.height, top: win.top, left: win.left },
		});
	} catch {}
});

chrome.windows.onRemoved.addListener(async (windowId) => {
	const id = overviewWindowId ?? await getStoredOverviewWindowId();
	if (windowId !== id) return;
	overviewWindowId = null;
	await setStoredOverviewWindowId(null);
});
