let overviewWindowId = null;

async function openOverviewWindow() {
  if (overviewWindowId !== null) {
    try {
      await chrome.windows.update(overviewWindowId, { focused: true });
      return;
    } catch (e) {
      // Window may have been closed
      overviewWindowId = null;
    }
  }

  const display = await getPrimaryDisplayBounds();
  const width = Math.min(1280, display.width);
  const height = Math.min(900, display.height);
  const left = Math.round(display.left + (display.width - width) / 2);
  const top = Math.round(display.top + (display.height - height) / 3);

  const url = chrome.runtime.getURL('overview.html');
  const created = await chrome.windows.create({
    url,
    type: 'popup',
    focused: true,
    width,
    height,
    left,
    top
  });

  overviewWindowId = created.id || null;
}

async function getPrimaryDisplayBounds() {
  // Approximate by using current window bounds when possible
  try {
    const current = await chrome.windows.getCurrent();
    if (current && current.left !== undefined && current.top !== undefined && current.width && current.height) {
      return { left: current.left, top: current.top, width: current.width, height: current.height };
    }
  } catch (_) {}
  // Fallback to a common size
  return { left: 0, top: 0, width: 1440, height: 900 };
}

chrome.action.onClicked.addListener(() => {
  openOverviewWindow();
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-overview') {
    openOverviewWindow();
  }
});

chrome.windows.onRemoved.addListener((id) => {
  if (id === overviewWindowId) {
    overviewWindowId = null;
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === 'close-overview-window' && overviewWindowId !== null) {
    chrome.windows.remove(overviewWindowId).catch(() => {});
    overviewWindowId = null;
    sendResponse({ ok: true });
    return true;
  }
  

});


