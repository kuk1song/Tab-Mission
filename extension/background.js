// background.js

let overviewWindowId = null; // Can be null, 'creating', or a window ID (number)
let latestBounds = null; // In-memory snapshot for the final save-on-close

async function getSavedOverviewBounds() {
	try {
		const { overviewBounds } = await chrome.storage.local.get({ overviewBounds: null });
		return overviewBounds || null;
	} catch {
		return null;
	}
}

async function getStoredOverviewWindowId() {
	try {
		const { overviewWindowId } = await chrome.storage.local.get({ overviewWindowId: null });
		return typeof overviewWindowId === 'number' ? overviewWindowId : null;
	} catch {
		return null;
	}
}

async function setStoredOverviewWindowId(idOrNull) {
	try {
		await chrome.storage.local.set({ overviewWindowId: idOrNull ?? null });
	} catch {}
}

async function toggleOverviewWindow() {
	// If a window is currently in the process of being created, do nothing.
	if (overviewWindowId === 'creating') {
		return;
	}

	// If service worker restarted, try to recover existing window id from storage
	if (overviewWindowId === null) {
		const storedId = await getStoredOverviewWindowId();
		if (storedId) {
			try {
				await chrome.windows.get(storedId);
				overviewWindowId = storedId;
			} catch {
				// Stored id is stale; clear it
				await setStoredOverviewWindowId(null);
			}
		}
	}

	// If a window already exists (its ID is stored), close it.
	if (typeof overviewWindowId === 'number') {
		try {
			// Send a message to the overview window to handle the shortcut
			const tabs = await chrome.tabs.query({ windowId: overviewWindowId });
			if (tabs.length > 0) {
				await chrome.tabs.sendMessage(tabs[0].id, { action: 'handleShortcut' });
			} else {
				// If no tabs are in the window (shouldn't happen), just close it.
				await chrome.windows.remove(overviewWindowId);
			}
		} catch (e) {
			// If messaging fails, it might be because the window is already closed.
			// We attempt to close it just in case.
			try {
				await chrome.windows.remove(overviewWindowId);
			} catch (closeError) {
				// Ignore error, window was likely already gone.
			}
		}
		return;
	}

	// If no window exists (ID is null), proceed to create one.
	try {
		// Set the state to 'creating' synchronously to act as a lock.
		overviewWindowId = 'creating';

		const displays = await chrome.system.display.getInfo();
		
		if (!displays || displays.length === 0) {
			throw new Error("No display information found.");
		}

		const display = displays.find(d => d.isPrimary) || displays[0];

		// Try to restore saved bounds; otherwise fallback to adaptive defaults with caps
		const saved = await getSavedOverviewBounds();
		let w, h, top, left;
		
		// Restore size (width/height)
		if (saved && saved.width && saved.height) {
			w = Math.min(saved.width, display.workArea.width);
			h = Math.min(saved.height, display.workArea.height);
		} else {
			w = Math.min(display.workArea.width * 0.88, 1400); // 88% of width, capped at 1400px
			h = Math.min(display.workArea.height * 0.9, 1000); // 90% of height, capped at 1000px
		}
		
		// Restore position (top/left) - can be independent of size
		if (saved && typeof saved.top === 'number' && typeof saved.left === 'number') {
			top = Math.max(display.workArea.top, Math.min(saved.top, display.workArea.top + display.workArea.height - h));
			left = Math.max(display.workArea.left, Math.min(saved.left, display.workArea.left + display.workArea.width - w));
		} else {
			// Default to center if no saved position
			top = display.workArea.top + (display.workArea.height - h) / 2;
			left = display.workArea.left + (display.workArea.width - w) / 2;
		}

		const win = await chrome.windows.create({
			url: chrome.runtime.getURL('overview.html'),
			type: 'popup',
			width: Math.round(w),
			height: Math.round(h),
			top: Math.round(top),
			left: Math.round(left),
		});

		// Important: After creation, only update the ID if we are still in the 'creating' state.
		// This handles a rare edge case where the window might be closed before creation completes.
		if (overviewWindowId === 'creating' && win?.id) {
			overviewWindowId = win.id;
			await setStoredOverviewWindowId(win.id);
		}

	} catch (error) {
		console.error("Tab Mission: Could not create window.", error);
		// If any error occurs, reset the state to allow future attempts.
		overviewWindowId = null;
	}
}

// Listen for the command to open/toggle the overview.
chrome.commands.onCommand.addListener((command) => {
	if (command === 'open-overview') {
		toggleOverviewWindow();
	}
});

// Also listen for the browser action icon click to toggle.
chrome.action.onClicked.addListener(() => {
	toggleOverviewWindow();
});

chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
	if (request?.action === 'resetWindowBounds') {
		try {
			await chrome.storage.local.set({ overviewBounds: null });
			// Recenter current window to defaults
			const displays = await chrome.system.display.getInfo();
			const display = displays.find(d => d.isPrimary) || displays[0];
			const w = Math.min(display.workArea.width * 0.88, 1400);
			const h = Math.min(display.workArea.height * 0.9, 1000);
			const top = Math.round(display.workArea.top + (display.workArea.height - h) / 2);
			const left = Math.round(display.workArea.left + (display.workArea.width - w) / 2);
			const storedId = await getStoredOverviewWindowId();
			if (storedId) {
				await chrome.windows.update(storedId, { width: Math.round(w), height: Math.round(h), top, left });
			}
			sendResponse({ ok: true });
		} catch (e) {
			sendResponse({ ok: false, error: e?.message || String(e) });
		}
		return true; // async response
	}
	if (request?.action === 'saveBoundsNow') {
		try {
			const storedId = await getStoredOverviewWindowId();
			if (storedId) {
				// Update in-memory snapshot
				latestBounds = {
					width: window.width,
					height: window.height,
					top: window.top,
					left: window.left,
				};
				// Asynchronously save to storage
				try {
					await chrome.storage.local.set({ overviewBounds: latestBounds });
				} catch {}
			}
			sendResponse({ ok: true });
		} catch (e) {
			sendResponse({ ok: false, error: e?.message || String(e) });
		}
		return true;
	}
});

// Primary listener for any size or position change.
chrome.windows.onBoundsChanged.addListener(async (window) => {
	const storedId = await getStoredOverviewWindowId();
	if (!storedId || window.id !== storedId) return;

	// Update the in-memory snapshot immediately
	latestBounds = {
		width: window.width,
		height: window.height,
		top: window.top,
		left: window.left,
	};
	// Asynchronously save to storage
	try {
		await chrome.storage.local.set({ overviewBounds: latestBounds });
	} catch {}
});

// Final safeguard listener for when the window is closed by any means.
chrome.windows.onRemoved.addListener(async (windowId) => {
	const storedId = await getStoredOverviewWindowId();
	if (windowId === overviewWindowId || windowId === storedId) {
		// Before clearing the ID, perform one final, definitive save
		// using the most recent in-memory data.
		if (latestBounds) {
			try {
				await chrome.storage.local.set({ overviewBounds: latestBounds });
			} catch {}
		}
		overviewWindowId = null;
		latestBounds = null; // Clear snapshot
		await setStoredOverviewWindowId(null);
	}
});


