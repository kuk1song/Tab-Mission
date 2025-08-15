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

  const { screen } = await chrome.system.display.getInfo();
  const [display] = screen; // Use the primary display
  const w = Math.min(1024, display.workArea.width - 40);
  const h = Math.min(800, display.workArea.height - 40);
  const top = display.workArea.top + (display.workArea.height - h) / 2;
  const left = display.workArea.left + (display.workArea.width - w) / 2;

  const win = await chrome.windows.create({
    url: chrome.runtime.getURL('extension/overview.html'),
    type: 'popup',
    width: Math.round(w),
    height: Math.round(h),
    top: Math.round(top),
    left: Math.round(left),
  });
  overviewWindowId = win.id;
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


