// background.js

let overviewWindowId = null; // Can be null, 'creating', or a window ID (number)

async function toggleOverviewWindow() {
  console.log("Tab Mosaic: toggleOverviewWindow called, current state:", overviewWindowId);
  
  // If a window is currently in the process of being created, do nothing.
  if (overviewWindowId === 'creating') {
    console.log("Tab Mosaic: Window is already being created.");
    return;
  }

  // If a window already exists (its ID is stored), close it.
  if (typeof overviewWindowId === 'number') {
    console.log("Tab Mosaic: Closing existing window:", overviewWindowId);
    const windowIdToClose = overviewWindowId;
    // Immediately clear the ID to prevent race conditions on closing.
    overviewWindowId = null; 
    try {
      await chrome.windows.remove(windowIdToClose);
      console.log("Tab Mosaic: Window closed successfully");
    } catch (e) {
      // This error is expected if the user manually closed the window right before the command.
      console.log("Tab Mosaic: Window was already closed:", e.message);
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
    const w = Math.min(1400, display.workArea.width - 40);
    const h = Math.min(1000, display.workArea.height - 40);
    const top = display.workArea.top + (display.workArea.height - h) / 2;
    const left = display.workArea.left + (display.workArea.width - w) / 2;

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

// Add a listener for when our window is closed by any means (user, or our own code).
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === overviewWindowId) {
    overviewWindowId = null;
  }
});


