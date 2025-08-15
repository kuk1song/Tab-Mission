// background.js

let overviewWindowId = null;

async function openOverviewWindow() {
  if (overviewWindowId !== null) {
    try {
      await chrome.windows.update(overviewWindowId, { focused: true });
      return;
    } catch (e) {
      // Window was closed, so we'll create a new one.
      overviewWindowId = null;
    }
  }

  try {
    const displays = await chrome.system.display.getInfo();
    
    if (!displays || displays.length === 0) {
      throw new Error("No display information found.");
    }

    const display = displays.find(d => d.isPrimary) || displays[0];
    const w = Math.min(1024, display.workArea.width - 40);
    const h = Math.min(800, display.workArea.height - 40);
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
    overviewWindowId = win.id;
  } catch (error) {
    console.error("Tab Mosaic: Could not create window with display info. Opening with default size.", error);
    // Fallback for when system.display is not available or fails
    const win = await chrome.windows.create({
      url: chrome.runtime.getURL('overview.html'),
      type: 'popup',
      width: 1024,
      height: 768,
    });
    overviewWindowId = win.id;
  }
}

// Listen for the command to open the overview.
chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-overview') {
    openOverviewWindow();
  }
});

// Also provide a browser action for discoverability.
chrome.action.onClicked.addListener(() => {
  openOverviewWindow();
});

// When the overview window is closed, reset our ID so we can open a new one.
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === overviewWindowId) {
    overviewWindowId = null;
  }
});


