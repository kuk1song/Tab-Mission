// background.js

let overviewWindowId = null; // the open overview's window id, or null
let toggling = null; // the toggle in progress, so overlapping presses never open two windows

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
// so a stale id can never make the shortcut close the wrong window.
async function isOverviewWindow(windowId) {
	try {
		const win = await chrome.windows.get(windowId, { populate: true });
		return win.type === 'popup' &&
			Boolean(win.tabs?.[0]?.url?.startsWith(chrome.runtime.getURL('overview.html')));
	} catch {
		return false;
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

// Where the overview opens: on the browser's display, at the size and spot
// the user last chose when that spot is on this display, otherwise at the
// default size, centered.
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
// A press that arrives while a toggle is still running is dropped, so a double
// press during a service worker cold start cannot open a second window.
function toggleOverviewWindow(scope) {
	toggling ??= runToggle(scope).finally(() => {
		toggling = null;
	});
	return toggling;
}

async function runToggle(scope) {
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
		await createOverviewWindow(scope);
		return;
	}

	// The overview is open: the page acts on the press (switches to the
	// selected tab, or closes).
	const windowId = overviewWindowId;
	try {
		const [tab] = await chrome.tabs.query({ windowId });
		if (tab) {
			await chrome.tabs.sendMessage(tab.id, { action: 'handleShortcut', scope });
			return;
		}
	} catch {}
	// The page could not answer (still loading, or already gone): close it.
	if (await isOverviewWindow(windowId)) {
		try {
			await chrome.windows.remove(windowId);
		} catch {}
	}
}

async function createOverviewWindow(scope) {
	try {
		const displays = await chrome.system.display.getInfo();
		if (!displays || displays.length === 0) {
			throw new Error('No display information found.');
		}

		const bounds = await overviewBounds(displays, await getSavedOverviewBounds());

		const win = await chrome.windows.create({
			url: chrome.runtime.getURL(scope === 'site' ? 'overview.html?scope=site' : 'overview.html'),
			type: 'popup',
			...bounds,
		});
		if (win?.id) {
			overviewWindowId = win.id;
			await setStoredOverviewWindowId(win.id);
		}
	} catch (error) {
		console.error('Tab Mission: Could not create window.', error);
		overviewWindowId = null;
	}
}

// Listen for the commands to open/toggle the overview.
chrome.commands.onCommand.addListener((command) => {
	if (command === 'open-overview') {
		toggleOverviewWindow();
	} else if (command === 'open-overview-site') {
		toggleOverviewWindow('site');
	}
});

// Also listen for the browser action icon click to toggle.
chrome.action.onClicked.addListener(() => {
	toggleOverviewWindow();
});

// First install: open a short welcome page that shows the shortcut (or says
// that none could be assigned) so new users are not left guessing.
chrome.runtime.onInstalled.addListener(({ reason }) => {
	if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
		chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
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
	if (request?.action === 'openOverview') {
		toggleOverviewWindow(request.scope);
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
