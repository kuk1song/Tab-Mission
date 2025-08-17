// background.js

let overviewWindowId = null; // Can be null, 'creating', or a window ID (number)
let saveBoundsTimeout = null;

async function getSavedOverviewBounds() {
	try {
		const { overviewBounds } = await chrome.storage.local.get({ overviewBounds: null });
		return overviewBounds || null;
	} catch {
		return null;
	}
}

async function saveOverviewBounds(windowId) {
	try {
		const win = await chrome.windows.get(windowId);
		if (!win) return;
		const bounds = {
			width: win.width,
			height: win.height,
			top: win.top,
			left: win.left,
		};
		await chrome.storage.local.set({ overviewBounds: bounds });
	} catch {}
}

async function toggleOverviewWindow() {
	console.log("Tab Mosaic: toggleOverviewWindow called, current state:", overviewWindowId);
	
	// If a window is currently in the process of being created, do nothing.
	if (overviewWindowId === 'creating') {
		console.log("Tab Mosaic: Window is already being created.");
		return;
	}

	// If a window already exists (its ID is stored), close it.
	if (typeof overviewWindowId === 'number') {
		console.log("Tab Mosaic: Window exists, sending shortcut command:", overviewWindowId);
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
			console.log("Tab Mosaic: Could not communicate with overview, closing window.", e.message);
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
		if (saved && saved.width && saved.height) {
			w = Math.min(saved.width, display.workArea.width);
			h = Math.min(saved.height, display.workArea.height);
			top = Math.max(display.workArea.top, Math.min(saved.top ?? display.workArea.top, display.workArea.top + display.workArea.height - h));
			left = Math.max(display.workArea.left, Math.min(saved.left ?? display.workArea.left, display.workArea.left + display.workArea.width - w));
		} else {
			w = Math.min(display.workArea.width * 0.88, 1400); // 88% of width, capped at 1400px
			h = Math.min(display.workArea.height * 0.9, 1000); // 90% of height, capped at 1000px
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
		if (overviewWindowId === 'creating') {
			overviewWindowId = win.id;
		}

	} catch (error) {
		console.error("Tab Mosaic: Could not create window.", error);
		// If any error occurs, reset the state to allow future attempts.
		overviewWindowId = null;
	}
}

// Listen for the command to open/toggle the overview.
chrome.commands.onCommand.addListener((command) => {
	console.log("Tab Mosaic: Keyboard shortcut triggered, command:", command);
	if (command === 'open-overview') {
		toggleOverviewWindow();
	}
});

// Also listen for the browser action icon click to toggle.
chrome.action.onClicked.addListener(() => {
	console.log("Tab Mosaic: Browser action icon clicked");
	toggleOverviewWindow();
});

// Persist bounds when the overview window is moved or resized (throttled)
chrome.windows.onBoundsChanged.addListener((windowId) => {
	if (windowId !== overviewWindowId) return;
	if (saveBoundsTimeout) clearTimeout(saveBoundsTimeout);
	saveBoundsTimeout = setTimeout(() => {
		saveOverviewBounds(windowId);
	}, 200);
});

// Add a listener for when our window is closed by any means (user, or our own code).
chrome.windows.onRemoved.addListener((windowId) => {
	if (windowId === overviewWindowId) {
		overviewWindowId = null;
	}
});


