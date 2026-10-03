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

// Pick the display to open on: where the overview was last placed, else where
// the user is working (the last focused browser window), else the primary.
async function chooseDisplay(displays, saved) {
	if (saved && typeof saved.left === 'number' && typeof saved.top === 'number' && saved.width && saved.height) {
		const display = displayAt(displays, saved.left + saved.width / 2, saved.top + saved.height / 2);
		if (display) return display;
	}
	try {
		const focused = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
		if (typeof focused?.left === 'number') {
			const display = displayAt(displays, focused.left + focused.width / 2, focused.top + focused.height / 2);
			if (display) return display;
		}
	} catch {}
	return displays.find(d => d.isPrimary) || displays[0];
}

function defaultBounds(display) {
	const w = Math.min(display.workArea.width * 0.88, 1400); // 88% of width, capped at 1400px
	const h = Math.min(display.workArea.height * 0.9, 1000); // 90% of height, capped at 1000px
	return {
		width: Math.round(w),
		height: Math.round(h),
		top: Math.round(display.workArea.top + (display.workArea.height - h) / 2),
		left: Math.round(display.workArea.left + (display.workArea.width - w) / 2),
	};
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

		// Restore the saved size and position, kept inside the chosen display's
		// work area; otherwise use adaptive defaults.
		const saved = await getSavedOverviewBounds();
		const display = await chooseDisplay(displays, saved);
		let w, h, top, left;

		if (saved && saved.width && saved.height) {
			w = Math.min(saved.width, display.workArea.width);
			h = Math.min(saved.height, display.workArea.height);
		} else {
			({ width: w, height: h } = defaultBounds(display));
		}

		if (saved && typeof saved.top === 'number' && typeof saved.left === 'number') {
			top = Math.max(display.workArea.top, Math.min(saved.top, display.workArea.top + display.workArea.height - h));
			left = Math.max(display.workArea.left, Math.min(saved.left, display.workArea.left + display.workArea.width - w));
		} else {
			top = display.workArea.top + (display.workArea.height - h) / 2;
			left = display.workArea.left + (display.workArea.width - w) / 2;
		}

		const win = await chrome.windows.create({
			url: chrome.runtime.getURL(scope === 'site' ? 'overview.html?scope=site' : 'overview.html'),
			type: 'popup',
			width: Math.round(w),
			height: Math.round(h),
			top: Math.round(top),
			left: Math.round(left),
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

async function resetWindowBounds() {
	await chrome.storage.local.set({ overviewBounds: null });
	// Recenter the open overview on the display it is currently on.
	const storedId = await getStoredOverviewWindowId();
	if (!storedId) return;
	const win = await chrome.windows.get(storedId);
	const displays = await chrome.system.display.getInfo();
	const display = displayAt(displays, win.left + win.width / 2, win.top + win.height / 2)
		|| displays.find(d => d.isPrimary) || displays[0];
	await chrome.windows.update(storedId, defaultBounds(display));
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
	if (win.id !== id) return;
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
