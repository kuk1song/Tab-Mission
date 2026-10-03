import { describe, it, expect, beforeEach, vi } from 'vitest';

// background.js registers its listeners on import. A small fake of the chrome
// APIs it uses lets the tests fire those events and watch what it does.
function fakeChrome() {
  const listeners = {};
  const event = (name) => ({ addListener: (fn) => { listeners[name] = fn; } });
  const store = () => {
    const data = {};
    return {
      data,
      get: vi.fn(async (defaults) => ({ ...defaults, ...data })),
      set: vi.fn(async (items) => { Object.assign(data, items); }),
      remove: vi.fn(async (keys) => { for (const k of [].concat(keys)) delete data[k]; }),
    };
  };
  const windows = new Map([[1, { id: 1, type: 'normal', tabs: [{ id: 11, url: 'https://example.com/' }] }]]);
  let nextId = 100;
  const chrome = {
    listeners,
    runtime: {
      getURL: (path) => `chrome-extension://test/${path}`,
      onInstalled: event('onInstalled'),
      onMessage: event('onMessage'),
      OnInstalledReason: { INSTALL: 'install', UPDATE: 'update' },
    },
    commands: { onCommand: event('onCommand') },
    action: { onClicked: event('onClicked') },
    storage: { local: store(), session: store() },
    system: { display: { getInfo: async () => [{ isPrimary: true, workArea: { left: 0, top: 0, width: 1600, height: 1000 } }] } },
    tabs: {
      create: vi.fn(async () => ({})),
      query: vi.fn(async ({ windowId }) => windows.get(windowId)?.tabs ?? []),
      // Only the overview page listens; a web page has no receiver.
      sendMessage: vi.fn(async (tabId) => {
        const tab = [...windows.values()].flatMap((w) => w.tabs).find((t) => t.id === tabId);
        if (!tab?.url.includes('/overview.html')) throw new Error('Could not establish connection. Receiving end does not exist.');
        return { ok: true };
      }),
    },
    windows: {
      _all: windows,
      get: vi.fn(async (id) => {
        if (!windows.has(id)) throw new Error(`No window with id: ${id}.`);
        return windows.get(id);
      }),
      getLastFocused: vi.fn(async () => ({ left: 0, top: 0, width: 1600, height: 1000 })),
      create: vi.fn(async ({ url, type }) => {
        // A little latency, as a real window takes time to open.
        await new Promise((r) => setTimeout(r, 5));
        const win = { id: nextId++, type, tabs: [{ id: nextId++, url }] };
        windows.set(win.id, win);
        return win;
      }),
      remove: vi.fn(async (id) => { windows.delete(id); }),
      update: vi.fn(async () => ({})),
      onBoundsChanged: event('onBoundsChanged'),
      onRemoved: event('onRemoved'),
    },
  };
  return chrome;
}

let chrome;
beforeEach(async () => {
  vi.resetModules();
  chrome = fakeChrome();
  vi.stubGlobal('chrome', chrome);
  await import('../extension/background.js');
});

describe('background.js', () => {
  it('opens one overview popup for two presses in a row', async () => {
    chrome.listeners.onCommand('open-overview');
    chrome.listeners.onCommand('open-overview');
    await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(chrome.windows.create).toHaveBeenCalledTimes(1);
    expect(chrome.windows.create.mock.calls[0][0]).toMatchObject({ type: 'popup', url: 'chrome-extension://test/overview.html' });
  });

  it('never closes a user window whose id was saved for the overview', async () => {
    // As after a browser restart that reused the id for a normal window
    // (versions before 1.2.0 kept the id in local storage).
    chrome.storage.session.data.overviewWindowId = 1;
    chrome.storage.local.data.overviewWindowId = 1;
    chrome.listeners.onCommand('open-overview');
    await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledTimes(1));
    expect(chrome.windows.remove).not.toHaveBeenCalled();
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    expect(chrome.windows._all.has(1)).toBe(true);
  });

  it('forwards a press to the open overview, and recovers it after a worker restart', async () => {
    chrome.listeners.onCommand('open-overview');
    await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledTimes(1));
    const overviewId = chrome.storage.session.data.overviewWindowId;
    expect(overviewId).toBeGreaterThanOrEqual(100);

    // A fresh module instance stands in for a restarted service worker.
    vi.resetModules();
    await import('../extension/background.js');
    chrome.listeners.onCommand('open-overview-site');
    await vi.waitFor(() => expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1));
    expect(chrome.tabs.sendMessage.mock.calls[0][1]).toEqual({ action: 'handleShortcut', scope: 'site' });
    expect(chrome.windows.create).toHaveBeenCalledTimes(1);
  });

  it('opens the welcome page on install', () => {
    chrome.listeners.onInstalled({ reason: 'install' });
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'chrome-extension://test/welcome.html' });
  });

  it('on update, deletes the keys older versions saved and keeps the settings', async () => {
    Object.assign(chrome.storage.local.data, { searchTerm: 'old', overviewWindowId: 7, artMode: false, showSleeping: true });
    chrome.listeners.onInstalled({ reason: 'update' });
    await vi.waitFor(() => expect(Object.keys(chrome.storage.local.data)).toEqual(['showSleeping']));
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it('saves the overview bounds, and ignores other windows', async () => {
    chrome.listeners.onCommand('open-overview');
    await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledTimes(1));
    const id = chrome.storage.session.data.overviewWindowId;
    await chrome.listeners.onBoundsChanged({ id: 1, width: 10, height: 10, top: 0, left: 0 });
    expect(chrome.storage.local.data.overviewBounds).toBeUndefined();
    await chrome.listeners.onBoundsChanged({ id, width: 900, height: 600, top: 20, left: 30 });
    expect(chrome.storage.local.data.overviewBounds).toEqual({ width: 900, height: 600, top: 20, left: 30 });
    await chrome.listeners.onRemoved(id);
    expect(chrome.storage.session.data.overviewWindowId).toBeNull();
  });
});
