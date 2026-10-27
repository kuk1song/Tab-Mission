import { describe, it, expect, beforeEach, vi } from 'vitest';

// background.js registers its listeners on import. A small fake of the chrome
// APIs it uses lets the tests fire those events and watch what it does.
function fakeChrome() {
  const listeners = {};
  const sets = new Map();
  // Every listener of an event is called (background.js and the modules it
  // starts may listen to the same one); the call resolves once they have.
  const event = (name) => {
    const fns = new Set();
    sets.set(name, fns);
    listeners[name] = (...args) => Promise.all([...fns].map((fn) => fn(...args)));
    return { addListener: (fn) => { fns.add(fn); }, removeListener: (fn) => { fns.delete(fn); } };
  };
  const store = () => {
    const data = {};
    return {
      data,
      get: vi.fn(async (defaults) => ({ ...defaults, ...data })),
      set: vi.fn(async (items) => { Object.assign(data, items); }),
      remove: vi.fn(async (keys) => { for (const k of [].concat(keys)) delete data[k]; }),
    };
  };
  const windows = new Map([[1, { id: 1, type: 'normal', tabs: [{ id: 11, url: 'https://example.com/', status: 'complete' }] }]]);
  const tabById = (id) => [...windows.values()].flatMap((w) => w.tabs).find((t) => t.id === id);
  let nextId = 100;
  const chrome = {
    listeners,
    // A stopped service worker's listeners are gone (restartWorker below).
    stopWorker: () => { for (const fns of sets.values()) fns.clear(); },
    listenerCount: (name) => sets.get(name).size,
    runtime: {
      getURL: (path) => `chrome-extension://test/${path}`,
      onInstalled: event('onInstalled'),
      onMessage: event('onMessage'),
      OnInstalledReason: { INSTALL: 'install', UPDATE: 'update' },
    },
    commands: { onCommand: event('onCommand') },
    action: { onClicked: event('onClicked') },
    storage: { local: store(), session: store() },
    // One 1600 x 1000 display; tests may replace _displays and _focused.
    _displays: [{ isPrimary: true, workArea: { left: 0, top: 0, width: 1600, height: 1000 } }],
    _focused: { left: 0, top: 0, width: 1600, height: 1000, state: 'normal' },
    system: { display: { getInfo: async () => chrome._displays } },
    tabs: {
      // Covers (src/covers.js), unseen tabs (src/unseen.js) and preview
      // images (src/thumbnail.js) listen here; their own tests drive them.
      onCreated: event('tabs.onCreated'),
      onActivated: event('tabs.onActivated'),
      onUpdated: event('tabs.onUpdated'),
      onRemoved: event('tabs.onRemoved'),
      onReplaced: event('tabs.onReplaced'),
      create: vi.fn(async () => ({})),
      query: vi.fn(async ({ windowId }) => windows.get(windowId)?.tabs ?? []),
      get: vi.fn(async (id) => {
        if (!tabById(id)) throw new Error(`No tab with id: ${id}.`);
        return { ...tabById(id) };
      }),
      // Only the overview page listens, here once it has loaded; a web page
      // has no receiver.
      sendMessage: vi.fn(async (tabId) => {
        const tab = tabById(tabId);
        if (!tab?.url.includes('/overview.html') || tab.status === 'loading') throw new Error('Could not establish connection. Receiving end does not exist.');
        return { ok: true };
      }),
    },
    windows: {
      _all: windows,
      get: vi.fn(async (id) => {
        if (!windows.has(id)) throw new Error(`No window with id: ${id}.`);
        return windows.get(id);
      }),
      getLastFocused: vi.fn(async () => chrome._focused),
      create: vi.fn(async ({ url, type }) => {
        // A little latency, as a real window takes time to open.
        await new Promise((r) => setTimeout(r, 5));
        const win = { id: nextId++, type, tabs: [{ id: nextId++, url, status: 'complete' }] };
        windows.set(win.id, win);
        return win;
      }),
      remove: vi.fn(async (id) => { windows.delete(id); }),
      update: vi.fn(async () => ({})),
      onBoundsChanged: event('onBoundsChanged'),
      onRemoved: event('onRemoved'),
      onFocusChanged: event('windows.onFocusChanged'),
      WINDOW_ID_NONE: -1,
    },
  };
  return chrome;
}

let chrome;

// A fresh module instance stands in for a restarted service worker.
async function restartWorker() {
  chrome.stopWorker();
  vi.resetModules();
  await import('../extension/background.js');
}

beforeEach(async () => {
  vi.resetModules();
  chrome = fakeChrome();
  vi.stubGlobal('chrome', chrome);
  await import('../extension/background.js');
});

describe('background.js', () => {
  it('opens one overview popup for two presses in a row, and drops the second press', async () => {
    chrome.listeners.onCommand('open-overview');
    chrome.listeners.onCommand('open-overview');
    // The second press comes while the first is still opening the window
    // (the fake takes 5 ms), so it is dropped: no second window, and no
    // press handed to the new one once it is open.
    await vi.waitFor(() => expect(chrome.storage.session.data.overviewWindowId).toBeGreaterThanOrEqual(100));
    await new Promise((r) => setImmediate(r));
    expect(chrome.windows.create).toHaveBeenCalledTimes(1);
    expect(chrome.windows.create.mock.calls[0][0]).toMatchObject({ type: 'popup', url: 'chrome-extension://test/overview.html' });
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
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

    await restartWorker();
    chrome.listeners.onCommand('open-overview-site');
    await vi.waitFor(() => expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1));
    expect(chrome.tabs.sendMessage.mock.calls[0][1]).toEqual({ action: 'handleShortcut', scope: 'site' });
    expect(chrome.windows.create).toHaveBeenCalledTimes(1);
  });

  it('a press in another window opens a fresh overview there instead of acting on the old one', async () => {
    chrome.listeners.onCommand('open-overview');
    await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledTimes(1));
    const oldId = chrome.storage.session.data.overviewWindowId;
    // Later, with the overview left behind another window.
    const later = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5000);
    try {
      chrome.windows._all.get(oldId).focused = false;
      chrome.listeners.onCommand('open-overview');
      await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledTimes(2));
      expect(chrome.windows.remove).toHaveBeenCalledWith(oldId);
      expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(chrome.storage.session.data.overviewWindowId).not.toBe(oldId));
      expect(chrome.windows._all.has(chrome.storage.session.data.overviewWindowId)).toBe(true);
    } finally {
      later.mockRestore();
    }
  });

  it('a quick second press goes to the new overview even before it reports focus', async () => {
    chrome.listeners.onCommand('open-overview');
    await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledTimes(1));
    chrome.windows._all.get(chrome.storage.session.data.overviewWindowId).focused = false;
    chrome.listeners.onCommand('open-overview');
    await vi.waitFor(() => expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1));
    expect(chrome.windows.remove).not.toHaveBeenCalled();
    expect(chrome.windows.create).toHaveBeenCalledTimes(1);
  });

  it('a press the overview page cannot take while it loads reaches it once it has loaded', async () => {
    chrome.listeners.onCommand('open-overview');
    await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledTimes(1));
    const id = chrome.storage.session.data.overviewWindowId;
    const tab = chrome.windows._all.get(id).tabs[0];
    tab.status = 'loading';
    const counts = () => [chrome.listenerCount('tabs.onUpdated'), chrome.listenerCount('tabs.onRemoved')];
    const before = counts();
    chrome.listeners.onCommand('open-overview');
    // Asked once, then left waiting while the page loads.
    await vi.waitFor(() => expect(chrome.tabs.get).toHaveBeenCalledWith(tab.id));
    await new Promise((r) => setImmediate(r));
    expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
    expect(chrome.windows.remove).not.toHaveBeenCalled();
    tab.status = 'complete';
    chrome.listeners['tabs.onUpdated'](tab.id, { status: 'complete' }, tab);
    await vi.waitFor(() => expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2));
    expect(chrome.tabs.sendMessage.mock.calls[1]).toEqual([tab.id, { action: 'handleShortcut' }]);
    await expect(chrome.tabs.sendMessage.mock.results[1].value).resolves.toEqual({ ok: true });
    expect(chrome.windows.remove).not.toHaveBeenCalled();
    expect(chrome.windows.create).toHaveBeenCalledTimes(1);
    // Done waiting: its listeners are gone.
    expect(counts()).toEqual(before);
  });

  it('a page that never finishes loading is given up on after 5 s: its window is removed, and nothing waits for it', async () => {
    chrome.listeners.onCommand('open-overview');
    await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledTimes(1));
    const id = chrome.storage.session.data.overviewWindowId;
    const tab = chrome.windows._all.get(id).tabs[0];
    tab.status = 'loading';
    const counts = () => [chrome.listenerCount('tabs.onUpdated'), chrome.listenerCount('tabs.onRemoved')];
    const before = counts();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      chrome.listeners.onCommand('open-overview');
      await vi.waitFor(() => expect(chrome.tabs.get).toHaveBeenCalledWith(tab.id));
      await vi.advanceTimersByTimeAsync(4900);
      expect(chrome.windows.remove).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(100);
      await vi.waitFor(() => expect(chrome.windows.remove).toHaveBeenCalledWith(id));
      expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
      expect(counts()).toEqual(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it('after a worker restart, an overview still on its way to its page is recognized and not opened again', async () => {
    chrome.listeners.onCommand('open-overview');
    await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledTimes(1));
    const tab = chrome.windows._all.get(chrome.storage.session.data.overviewWindowId).tabs[0];
    // Not committed yet: no address, only the one it is going to.
    Object.assign(tab, { url: '', pendingUrl: tab.url, status: 'loading' });
    await restartWorker();
    chrome.listeners.onCommand('open-overview');
    await vi.waitFor(() => expect(chrome.tabs.get).toHaveBeenCalledWith(tab.id));
    Object.assign(tab, { url: tab.pendingUrl, pendingUrl: undefined, status: 'complete' });
    chrome.listeners['tabs.onUpdated'](tab.id, { status: 'complete' }, tab);
    await vi.waitFor(() => expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2));
    await expect(chrome.tabs.sendMessage.mock.results[1].value).resolves.toEqual({ ok: true });
    expect(chrome.windows.create).toHaveBeenCalledTimes(1);
    expect(chrome.windows.remove).not.toHaveBeenCalled();
  });

  it('a later press in the focused overview goes to it', async () => {
    chrome.listeners.onCommand('open-overview');
    await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledTimes(1));
    const later = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5000);
    try {
      chrome.windows._all.get(chrome.storage.session.data.overviewWindowId).focused = true;
      chrome.listeners.onCommand('open-overview');
      await vi.waitFor(() => expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1));
      expect(chrome.windows.remove).not.toHaveBeenCalled();
      expect(chrome.windows.create).toHaveBeenCalledTimes(1);
    } finally {
      later.mockRestore();
    }
  });

  describe('the toolbar button', () => {
    const open = async () => {
      chrome.listeners.onCommand('open-overview');
      await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledTimes(1));
      return chrome.storage.session.data.overviewWindowId;
    };

    // The page fades out as for the shortcut and closes itself (events.js).
    const closeAsked = (id) => [chrome.windows._all.get(id).tabs[0].id, { action: 'closeOverview' }];

    it('asks the overview to close while it has focus, even right after opening, without switching tabs', async () => {
      const id = await open();
      chrome.listeners.onClicked();
      await vi.waitFor(() => expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(...closeAsked(id)));
      expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
      expect(chrome.windows.remove).not.toHaveBeenCalled();
      expect(chrome.windows.create).toHaveBeenCalledTimes(1);
      await vi.waitFor(() => expect(chrome.storage.session.data.overviewWindowId).toBeNull());
    });

    it('removes the window when the page cannot answer, even once it has loaded', async () => {
      const id = await open();
      chrome.tabs.sendMessage.mockRejectedValue(new Error('Receiving end does not exist.'));
      chrome.listeners.onClicked();
      await vi.waitFor(() => expect(chrome.windows.remove).toHaveBeenCalledWith(id));
      expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
      expect(chrome.windows.create).toHaveBeenCalledTimes(1);
    });

    it('asks it to close when focus left it just before the click (the click itself moves focus)', async () => {
      const id = await open();
      const later = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5000);
      try {
        chrome.windows._all.get(id).focused = false;
        chrome.storage.session.data.overviewBlurredAt = Date.now() - 200;
        chrome.listeners.onClicked();
        await vi.waitFor(() => expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(...closeAsked(id)));
        expect(chrome.windows.create).toHaveBeenCalledTimes(1);
        expect(chrome.windows.remove).not.toHaveBeenCalled();
      } finally {
        later.mockRestore();
      }
    });

    it('left behind another window for a while, opens a fresh overview in front', async () => {
      const id = await open();
      const later = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5000);
      try {
        chrome.windows._all.get(id).focused = false;
        chrome.storage.session.data.overviewBlurredAt = Date.now() - 3000;
        chrome.listeners.onClicked();
        await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledTimes(2));
        expect(chrome.windows.remove).toHaveBeenCalledWith(id);
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
      } finally {
        later.mockRestore();
      }
    });
  });

  it('marks a window opened with a click (the toolbar button, the welcome page button), for the tip that teaches the shortcut', async () => {
    const url = (i) => chrome.windows.create.mock.calls[i][0].url;
    chrome.listeners.onClicked();
    await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledTimes(1));
    expect(url(0)).toBe('chrome-extension://test/overview.html?via=click');
    chrome.listeners.onRemoved(chrome.storage.session.data.overviewWindowId);
    await vi.waitFor(() => expect(chrome.storage.session.data.overviewWindowId).toBeNull());
    chrome.listeners.onMessage({ action: 'openOverview' }, {}, () => {});
    await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledTimes(2));
    expect(url(1)).toBe('chrome-extension://test/overview.html?via=click');
  });

  describe("the welcome page's first step (press a shortcut)", () => {
    it('a keyboard command records it; the toolbar button and the page button do not', async () => {
      chrome.listeners.onClicked();
      await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledTimes(1));
      chrome.listeners.onMessage({ action: 'openOverview' }, {}, () => {});
      await vi.waitFor(() => expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1));
      expect(chrome.storage.local.data.tryItOpen).toBeUndefined();

      chrome.listeners.onCommand('open-overview');
      await vi.waitFor(() => expect(chrome.storage.local.data.tryItOpen).toBe(true));
      // The press itself is handled as before: it goes to the open overview.
      await vi.waitFor(() => expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2));
      expect(chrome.windows.create).toHaveBeenCalledTimes(1);
    });

    it('the site command records it too', async () => {
      chrome.listeners.onCommand('open-overview-site');
      await vi.waitFor(() => expect(chrome.storage.local.data.tryItOpen).toBe(true));
      await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledTimes(1));
      expect(chrome.windows.create.mock.calls[0][0].url).toBe('chrome-extension://test/overview.html?scope=site');
    });
  });

  it('the shortcuts and the toolbar button picture the page in front; the welcome page\'s button does not', async () => {
    const front = { active: true, lastFocusedWindow: true, windowType: 'normal' };
    chrome.listeners.onMessage({ action: 'openOverview' }, {}, () => {});
    await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledTimes(1));
    expect(chrome.tabs.query).not.toHaveBeenCalledWith(front);
    chrome.listeners.onCommand('open-overview');
    chrome.listeners.onCommand('open-overview-site');
    chrome.listeners.onClicked();
    await vi.waitFor(() => expect(chrome.tabs.query.mock.calls.filter(([q]) => q.lastFocusedWindow)).toHaveLength(3));
    expect(chrome.tabs.query).toHaveBeenCalledWith(front);
  });

  it('opens the welcome page on install, and gives the new user the window tips', () => {
    chrome.listeners.onInstalled({ reason: 'install' });
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'chrome-extension://test/welcome.html' });
    expect(chrome.storage.local.data.tipsLeft).toEqual({ open: 3, back: 3 });
  });

  it('a welcome page Chrome cannot open leaves no unhandled error', async () => {
    const unhandled = [];
    const note = (reason) => unhandled.push(reason);
    process.on('unhandledRejection', note);
    try {
      // Not a mock's rejection: vitest's mocks keep their results, which
      // counts as handling them.
      chrome.tabs.create = () => Promise.reject(new Error('No window to open it in.'));
      chrome.listeners.onInstalled({ reason: 'install' });
      await new Promise((r) => setImmediate(r));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', note);
    }
  });

  it('on update, deletes the keys older versions saved, keeps the settings and leaves the first-use tips off', async () => {
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

  describe('where the overview opens', () => {
    const opened = async () => {
      chrome.listeners.onCommand('open-overview');
      await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalled());
      const { left, top, width, height } = chrome.windows.create.mock.calls.at(-1)[0];
      return { left, top, width, height };
    };
    const halfScreenBrowser = () => { chrome._focused = { left: 0, top: 0, width: 800, height: 1000, state: 'normal' }; };

    it('defaults to 88% x 90% of the work area, capped, centered on the display', async () => {
      halfScreenBrowser();
      expect(await opened()).toEqual({ left: 100, top: 50, width: 1400, height: 900 });
    });

    it("opens on the browser's display, keeping the saved size but not a position from another display", async () => {
      chrome._displays = [
        { isPrimary: true, workArea: { left: 0, top: 0, width: 1600, height: 1000 } },
        { isPrimary: false, workArea: { left: 1600, top: 0, width: 1920, height: 1080 } },
      ];
      chrome._focused = { left: 1700, top: 50, width: 1700, height: 1000, state: 'normal' };
      chrome.storage.local.data.overviewBounds = { left: 10, top: 10, width: 1000, height: 700 };
      const b = await opened();
      expect(b.left).toBeGreaterThanOrEqual(1600);
      expect({ width: b.width, height: b.height }).toEqual({ width: 1000, height: 700 });
    });

    it('reuses the saved position when it is on the same display', async () => {
      chrome.storage.local.data.overviewBounds = { left: 30, top: 40, width: 900, height: 600 };
      expect(await opened()).toEqual({ left: 30, top: 40, width: 900, height: 600 });
    });

    it('reset moves the open overview to the default without saving it as a choice', async () => {
      await opened();
      const id = chrome.storage.session.data.overviewWindowId;
      chrome.storage.local.data.overviewBounds = { left: 30, top: 40, width: 900, height: 600 };
      const reply = await new Promise((resolve) => chrome.listeners.onMessage({ action: 'resetWindowBounds' }, {}, resolve));
      expect(reply).toEqual({ ok: true });
      expect(chrome.windows.update).toHaveBeenCalledWith(id, { left: 100, top: 50, width: 1400, height: 900 });
      await chrome.listeners.onBoundsChanged({ id, left: 100, top: 50, width: 1400, height: 900 });
      expect(chrome.storage.local.data.overviewBounds).toBeNull();
    });
  });
});
