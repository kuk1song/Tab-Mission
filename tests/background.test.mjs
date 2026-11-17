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
const CLASSIC = { spread: false, openAs: 'window' };

// A fresh module instance stands in for a restarted service worker.
async function restartWorker() {
  chrome.stopWorker();
  vi.resetModules();
  await import('../extension/background.js');
}

beforeEach(async () => {
  vi.resetModules();
  chrome = fakeChrome();
  // The grid in its own window, as with "Spread the cards out" off, and a
  // window when they are spread out: what most tests here are about. A new
  // user's settings have tests of their own (below, "with nothing chosen").
  Object.assign(chrome.storage.local.data, { ...CLASSIC });
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

  it('hands the look chosen on the settings page to the window in its address, and nothing by default', async () => {
    const url = (i) => chrome.windows.create.mock.calls[i][0].url;
    Object.assign(chrome.storage.local.data, { appearance: 'light', backdrop: 'wallpaper' });
    chrome.listeners.onCommand('open-overview');
    await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledTimes(1));
    expect(url(0)).toBe('chrome-extension://test/overview.html?look=light&backdrop=wallpaper');
    chrome.listeners.onRemoved(chrome.storage.session.data.overviewWindowId);
    await vi.waitFor(() => expect(chrome.storage.session.data.overviewWindowId).toBeNull());
    // The defaults, and values it does not know, add nothing.
    Object.assign(chrome.storage.local.data, { appearance: 'system', backdrop: 'plain' });
    chrome.listeners.onCommand('open-overview');
    await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledTimes(2));
    expect(url(1)).toBe('chrome-extension://test/overview.html');
    chrome.listeners.onRemoved(chrome.storage.session.data.overviewWindowId);
    await vi.waitFor(() => expect(chrome.storage.session.data.overviewWindowId).toBeNull());
    Object.assign(chrome.storage.local.data, { appearance: 'sepia', backdrop: 'page' });
    chrome.listeners.onCommand('open-overview-site');
    await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledTimes(3));
    expect(url(2)).toBe('chrome-extension://test/overview.html?scope=site&backdrop=page');
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
    expect(chrome.storage.local.data.tipsLeft).toEqual({ open: 3, back: 3, point: 3 });
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
    Object.assign(chrome.storage.local.data, { searchTerm: 'old', overviewWindowId: 7, artMode: false, cardSizes: 'equal', showSleeping: true });
    chrome.listeners.onInstalled({ reason: 'update', previousVersion: '2.0.0' });
    await vi.waitFor(() => expect(chrome.storage.local.data).toEqual({ ...CLASSIC, showSleeping: true }));
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it('on the update from version 1, notes that the new look is to be told once; not on a new install or a later update', async () => {
    const settled = () => new Promise((r) => setImmediate(r));
    chrome.listeners.onInstalled({ reason: 'install' });
    chrome.listeners.onInstalled({ reason: 'update', previousVersion: '2.0.0' });
    chrome.listeners.onInstalled({ reason: 'update', previousVersion: '10.1.0' });
    chrome.listeners.onInstalled({ reason: 'update' });
    await settled();
    expect(chrome.storage.local.data.lookNotice).toBeUndefined();
    chrome.listeners.onInstalled({ reason: 'update', previousVersion: '1.6.0' });
    await vi.waitFor(() => expect(chrome.storage.local.data.lookNotice).toBe(true));
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

    it('defaults to 60% x 75% of the work area, centered on the display', async () => {
      halfScreenBrowser();
      expect(await opened()).toEqual({ left: 320, top: 125, width: 960, height: 750 });
    });

    it('defaults to at least 960 x 640 on a small screen (a 1080p laptop at 150%)', async () => {
      chrome._displays = [{ isPrimary: true, workArea: { left: 0, top: 0, width: 1280, height: 672 } }];
      // 640 is more than 90% of 672.
      expect(await opened()).toEqual({ left: 160, top: 34, width: 960, height: 605 });
    });

    it('defaults to no more than 90% of a screen smaller than that', async () => {
      chrome._displays = [{ isPrimary: true, workArea: { left: 0, top: 0, width: 1024, height: 600 } }];
      expect(await opened()).toEqual({ left: 51, top: 30, width: 922, height: 540 });
    });

    it('defaults to at most 1200 x 900 on a large screen', async () => {
      chrome._displays = [{ isPrimary: true, workArea: { left: 0, top: 0, width: 2560, height: 1392 } }];
      expect(await opened()).toEqual({ left: 680, top: 246, width: 1200, height: 900 });
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
      expect(chrome.windows.update).toHaveBeenCalledWith(id, { left: 320, top: 125, width: 960, height: 750 });
      await chrome.listeners.onBoundsChanged({ id, left: 320, top: 125, width: 960, height: 750 });
      expect(chrome.storage.local.data.overviewBounds).toBeNull();
    });

    describe('with the cards spread out (the setting)', () => {
      const saved = { left: 30, top: 40, width: 900, height: 600 };
      beforeEach(() => {
        Object.assign(chrome.storage.local.data, { spread: true, overviewBounds: { ...saved } });
      });

      it('opens right over the browser window, as large as it, whatever size was saved, and says so in its address', async () => {
        chrome._focused = { left: 100, top: 60, width: 1300, height: 820, state: 'normal' };
        expect(await opened()).toEqual({ left: 100, top: 60, width: 1300, height: 820 });
        expect(chrome.windows.create.mock.calls.at(-1)[0].url).toBe('chrome-extension://test/overview.html?layout=spread');
      });

      it('stays inside the work area when the browser window reaches past it', async () => {
        chrome._focused = { left: -20, top: 0, width: 1700, height: 1100, state: 'normal' };
        expect(await opened()).toEqual({ left: 0, top: 0, width: 1600, height: 1000 });
      });

      it('falls back to the saved size and spot without a browser window to cover', async () => {
        chrome._focused = null;
        expect(await opened()).toEqual(saved);
      });

      it('does not remember a size given to it, and reset puts it back over the browser window', async () => {
        chrome._focused = { left: 100, top: 60, width: 1300, height: 820, state: 'normal' };
        await opened();
        const id = chrome.storage.session.data.overviewWindowId;
        await chrome.listeners.onBoundsChanged({ id, left: 0, top: 0, width: 500, height: 400 });
        expect(chrome.storage.local.data.overviewBounds).toEqual(saved);
        const reply = await new Promise((resolve) => chrome.listeners.onMessage({ action: 'resetWindowBounds' }, {}, resolve));
        expect(reply).toEqual({ ok: true });
        expect(chrome.windows.update).toHaveBeenCalledWith(id, { left: 100, top: 60, width: 1300, height: 820 });
      });
    });
  });

  // A trial (settings page, "Open as", src/host.js).
  describe('opened on the page in front, with the cards spread out', () => {
    let front; // the tab in front in the browser window
    const press = (source = 'shortcut') => {
      if (source === 'toolbar') chrome.listeners.onClicked();
      else chrome.listeners.onCommand('open-overview');
    };
    const host = () => chrome.storage.session.data.overviewHost;
    // One press, waited for until it has done what it should and is handled
    // (a press made while another is being handled is dropped).
    const handled = () => new Promise((r) => setImmediate(r));
    const pressed = async (source, effect) => {
      press(source);
      await vi.waitFor(effect);
      await handled();
    };
    // Pressed, and the overview is open.
    const open = async () => {
      await pressed('shortcut', () => {
        expect(host()).toBeTruthy();
        expect(scripts()).toContain('mountOverlay');
      });
      return host();
    };
    const scripts = () => chrome.scripting.executeScript.mock.calls.map(([{ func }]) => func.name);
    const lastMessage = () => chrome.tabs.sendMessage.mock.calls.at(-1);
    // A message that is answered, and one that is not.
    const message = (request, sender = {}) => new Promise((resolve) => chrome.listeners.onMessage(request, sender, resolve));
    const tell = (request, sender = {}) => chrome.listeners.onMessage(request, sender, () => {});
    const frame = { tab: { id: 11 }, frameId: 7 }; // the overview's frame on the page in front
    beforeEach(() => {
      chrome.storage.local.data.spread = true;
      front = { id: 11, windowId: 1, index: 0, url: 'https://example.com/', status: 'complete', active: true };
      const byWindow = chrome.tabs.query.getMockImplementation();
      chrome.tabs.query.mockImplementation(async (query) => (query.lastFocusedWindow ? [front] : byWindow(query)));
      chrome.scripting = { executeScript: vi.fn(async ({ func }) => [{ result: func.name === 'mountOverlay' ? true : undefined }]) };
    });

    it('with nothing chosen (a new user): the cards spread out, on the page in front', async () => {
      delete chrome.storage.local.data.spread;
      delete chrome.storage.local.data.openAs;
      const { token } = await open();
      expect(chrome.scripting.executeScript.mock.calls[0][0].args).toEqual([`overlay.html?host=page&token=${token}&layout=spread`, token]);
      expect(chrome.windows.create).not.toHaveBeenCalled();
    });

    it('with nothing chosen and settings that cannot be read: the same', async () => {
      chrome.storage.local.data = {};
      chrome.storage.local.get.mockImplementation(async () => { throw new Error('storage is gone'); });
      await pressed('shortcut', () => expect(scripts()).toContain('mountOverlay'));
      expect(chrome.scripting.executeScript.mock.calls[0][0].args[0]).toContain('layout=spread');
    });

    it('on a page: puts the overview on the page in front, under the name pages may frame, with a token; no window or tab', async () => {
      chrome.storage.local.data.openAs = 'page';
      const { token } = await open();
      const [call] = chrome.scripting.executeScript.mock.calls;
      expect(call[0]).toMatchObject({ target: { tabId: 11 }, injectImmediately: true });
      expect(token).toMatch(/^[0-9a-f-]{36}$/);
      expect(call[0].args).toEqual([`overlay.html?host=page&token=${token}&layout=spread`, token]);
      expect(host()).toMatchObject({ kind: 'page', tabId: 11, windowId: 1 });
      expect(chrome.windows.create).not.toHaveBeenCalled();
      expect(chrome.tabs.create).not.toHaveBeenCalled();
    });

    it('on a page: the frame is let in once, with its token, on its tab only', async () => {
      chrome.storage.local.data.openAs = 'page';
      const { token } = await open();
      expect(await message({ action: 'claimOverlay', token }, { tab: { id: 12 }, frameId: 7 })).toEqual({ ok: false });
      expect(await message({ action: 'claimOverlay', token: 'guess' }, frame)).toEqual({ ok: false });
      expect(await message({ action: 'claimOverlay' }, frame)).toEqual({ ok: false });
      expect(await message({ action: 'claimOverlay', token }, frame)).toEqual({ ok: true });
      // A page that learned the address frames it again: not let in.
      expect(await message({ action: 'claimOverlay', token }, { tab: { id: 11 }, frameId: 9 })).toEqual({ ok: false });
      expect(host()).toMatchObject({ claimed: true, frameId: 7 });
    });

    it('on a page: a press goes to it; when it asks, it is taken off and forgotten', async () => {
      chrome.storage.local.data.openAs = 'page';
      const { token } = await open();
      await message({ action: 'claimOverlay', token }, frame);
      expect(await message({ action: 'showOverlay' }, frame)).toEqual({ ok: true });
      chrome.tabs.sendMessage.mockImplementation(async () => ({ ok: true }));
      await pressed('shortcut', () => expect(lastMessage()).toEqual([11, { action: 'handleShortcut', scope: undefined }]));
      await pressed('toolbar', () => expect(lastMessage()).toEqual([11, { action: 'closeOverview' }]));
      expect(scripts()).toEqual(['mountOverlay', 'revealOverlay']);

      tell({ action: 'closeOverlay' }, frame);
      await vi.waitFor(() => expect(scripts()).toEqual(['mountOverlay', 'revealOverlay', 'unmountOverlay']));
      expect(chrome.scripting.executeScript.mock.calls.at(-1)[0]).toMatchObject({ target: { tabId: 11 }, args: [null] });
      expect(host()).toBeNull();
      expect(chrome.storage.session.data.overlayLast).toMatchObject({ tabId: 11 });
      expect(chrome.storage.session.data.overlayLast.until).toBeGreaterThan(Date.now());
    });

    it('on a page: a frame the page made cannot take the overview off; the overview\'s own frame, loaded again and refused, is taken off', async () => {
      chrome.storage.local.data.openAs = 'page';
      const { token } = await open();
      await message({ action: 'claimOverlay', token }, frame);
      tell({ action: 'closeOverlay', refused: true }, { tab: { id: 11 }, frameId: 9 });
      // Answered in turn: by the time this claim is refused, the request before it is done.
      expect(await message({ action: 'claimOverlay', token }, { tab: { id: 11 }, frameId: 9 })).toEqual({ ok: false });
      expect(host()).toMatchObject({ kind: 'page', tabId: 11, claimed: true });
      expect(scripts()).toEqual(['mountOverlay']);

      tell({ action: 'closeOverlay', refused: true }, frame);
      await vi.waitFor(() => expect(scripts()).toEqual(['mountOverlay', 'unmountOverlay']));
      expect(host()).toBeNull();
    });

    it('on a page: taken off when another tab of its window comes to the front', async () => {
      chrome.storage.local.data.openAs = 'page';
      await open();
      await chrome.listeners['tabs.onActivated']({ tabId: 11, windowId: 1 });
      await chrome.listeners['tabs.onActivated']({ tabId: 77, windowId: 2 });
      expect(scripts()).toEqual(['mountOverlay']);
      await chrome.listeners['tabs.onActivated']({ tabId: 12, windowId: 1 });
      expect(scripts()).toEqual(['mountOverlay', 'unmountOverlay']);
      expect(chrome.scripting.executeScript.mock.calls.at(-1)[0]).toMatchObject({ target: { tabId: 11 } });
      expect(host()).toBeNull();
    });

    it('on a page: one that no longer answers (its page went elsewhere, or answers without being the overview) is dropped and a new one put on', async () => {
      chrome.storage.local.data.openAs = 'page';
      await open();
      // Opened long enough ago that it would listen by now.
      chrome.storage.session.data.overviewHost.at = Date.now() - 5000;
      const again = ['mountOverlay', 'unmountOverlay', 'mountOverlay'];
      await pressed('shortcut', () => {
        expect(scripts()).toEqual(again);
        expect(host()).toBeTruthy();
      });
      // Something on the tab takes the message but is not the overview.
      chrome.tabs.sendMessage.mockImplementation(async () => undefined);
      chrome.storage.session.data.overviewHost.at = Date.now() - 5000;
      await pressed('shortcut', () => expect(scripts()).toEqual([...again, 'unmountOverlay', 'mountOverlay']));
      expect(chrome.windows.create).not.toHaveBeenCalled();
    });

    it('on a page: a press not yet answered is spent when the overview is closed meanwhile, and opens nothing', async () => {
      chrome.storage.local.data.openAs = 'page';
      await open();
      // Not listening yet: asked again and again.
      press();
      await vi.waitFor(() => expect(chrome.tabs.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(2));
      await chrome.listeners['tabs.onActivated']({ tabId: 12, windowId: 1 });
      expect(host()).toBeNull();
      // That press is done within a turn of its asking: it opened nothing.
      await new Promise((r) => setTimeout(r, 120));
      expect(scripts().filter((name) => name === 'mountOverlay')).toHaveLength(1);
      const asked = chrome.tabs.sendMessage.mock.calls.length;
      // The next press is taken, on the tab now in front, and asks no one.
      front = { ...front, id: 12 };
      await pressed('shortcut', () => expect(scripts().filter((name) => name === 'mountOverlay')).toHaveLength(2));
      expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(asked);
      expect(chrome.scripting.executeScript.mock.calls.at(-1)[0]).toMatchObject({ target: { tabId: 12 } });
      expect(chrome.windows.create).not.toHaveBeenCalled();
    });

    // The window that opens instead of the layer, and where.
    const windowOpened = async () => {
      press();
      await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledTimes(1));
      const { left, top, width, height } = chrome.windows.create.mock.calls[0][0];
      return { left, top, width, height };
    };
    // A browser window whose page begins 85 below its top edge.
    const sized = () => {
      chrome._focused = { id: 1, left: 100, top: 60, width: 1300, height: 820, state: 'normal' };
      Object.assign(front, { width: 1300, height: 735 });
    };

    it('on a page that cannot take it, a window opens over the page only, the tab strip in view, and the token is void', async () => {
      chrome.storage.local.data.openAs = 'page';
      sized();
      chrome.scripting.executeScript.mockRejectedValue(new Error('Cannot access contents of the page'));
      expect(await windowOpened()).toEqual({ left: 100, top: 145, width: 1300, height: 735 });
      expect(chrome.windows.create.mock.calls[0][0].url).toBe('chrome-extension://test/overview.html?layout=spread');
      expect(chrome.windows.create.mock.calls[0][0].type).toBe('popup');
      expect(host()).toBeNull();
    });

    it('on a browser page, which takes no layer, none is tried: the window over the page opens at once', async () => {
      chrome.storage.local.data.openAs = 'page';
      sized();
      front.url = 'chrome://settings/';
      expect(await windowOpened()).toEqual({ left: 100, top: 145, width: 1300, height: 735 });
      expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
      expect(host()).toBeFalsy();
    });

    it('the window over the page leaves out the unseen edges of a Windows window, and ends with the work area', async () => {
      chrome.storage.local.data.openAs = 'page';
      front.url = 'chrome://settings/';
      // 8 unseen at each side and below: the page begins 85 below the top.
      chrome._focused = { id: 1, left: 92, top: 60, width: 1316, height: 828, state: 'normal' };
      Object.assign(front, { width: 1300, height: 735 });
      expect(await windowOpened()).toEqual({ left: 92, top: 145, width: 1316, height: 743 });
      // Maximized: the edges reach past the 1600 x 1000 work area.
      chrome.windows.create.mockClear();
      await chrome.listeners.onRemoved(chrome.storage.session.data.overviewWindowId);
      chrome._focused = { id: 1, left: -8, top: -8, width: 1616, height: 1016, state: 'maximized' };
      Object.assign(front, { width: 1600, height: 915 });
      expect(await windowOpened()).toEqual({ left: 0, top: 85, width: 1600, height: 915 });
    });

    it('where the page\'s place cannot be told, the window covers the whole browser window', async () => {
      chrome.storage.local.data.openAs = 'page';
      front.url = 'chrome://settings/';
      const whole = { left: 100, top: 60, width: 1300, height: 820 };
      // No size known for the tab; a tab of another window; a page less than half the window high.
      for (const [browserId, size] of [[1, {}], [2, { width: 1300, height: 735 }], [1, { width: 1300, height: 300 }]]) {
        chrome._focused = { id: browserId, ...whole, state: 'normal' };
        front = { id: 11, windowId: 1, index: 0, url: 'chrome://settings/', status: 'complete', active: true, ...size };
        chrome.windows.create.mockClear();
        expect(await windowOpened()).toEqual(whole);
        await chrome.listeners.onRemoved(chrome.storage.session.data.overviewWindowId);
      }
    });

    it('on a page that does not answer in time, the window opens, and that layer, should it still arrive, is taken off', async () => {
      chrome.storage.local.data.openAs = 'page';
      let arrive;
      chrome.scripting.executeScript.mockImplementationOnce(() => new Promise((resolve) => { arrive = resolve; }));
      press();
      const { token } = await vi.waitFor(() => {
        expect(host()).toBeTruthy();
        return host();
      });
      await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledTimes(1));
      expect(await message({ action: 'claimOverlay', token }, frame)).toEqual({ ok: false });
      arrive([{ result: true }]);
      await vi.waitFor(() => expect(scripts().at(-1)).toBe('unmountOverlay'));
      // Only that layer: one put on since stays.
      expect(chrome.scripting.executeScript.mock.calls.at(-1)[0].args).toEqual([token]);
    });

    it('on a page where the frame never asks to be let in, the empty layer is taken off and the window over the page opens', async () => {
      chrome.storage.local.data.openAs = 'page';
      sized();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      try {
        press();
        await vi.advanceTimersByTimeAsync(1400);
        expect(host()).toMatchObject({ kind: 'page', tabId: 11 });
        expect(chrome.windows.create).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(200);
        expect(scripts()).toEqual(['mountOverlay', 'unmountOverlay']);
        expect(host()).toBeNull();
        expect(chrome.windows.create).toHaveBeenCalledTimes(1);
        expect(chrome.windows.create.mock.calls[0][0]).toMatchObject({ left: 100, top: 145, width: 1300, height: 735 });
      } finally {
        vi.useRealTimers();
      }
    });

    // The page in front can be pictured (src/covers.js), and Chrome takes its time.
    const picturing = (capture) => {
      Object.assign(front, { incognito: false });
      chrome.windows._all.set(1, { id: 1, type: 'normal', focused: true, state: 'normal', tabs: [front] });
      chrome.tabs.captureVisibleTab = vi.fn(capture);
    };

    it('on a page: the layer goes on at once, unseen, and shows when its frame asks, once the picture of the page has been taken', async () => {
      chrome.storage.local.data.openAs = 'page';
      let taken = null;
      picturing(() => new Promise((resolve) => {
        taken = () => resolve('data:image/jpeg;base64,RAW');
      }));
      // On, while the picture is still being taken.
      const { token } = await open();
      await vi.waitFor(() => expect(taken).not.toBeNull());
      expect(host().shown).toBeUndefined();
      // A frame not let in yet is not heard, nor is another frame later.
      expect(await message({ action: 'showOverlay' }, frame)).toEqual({ ok: false });
      await message({ action: 'claimOverlay', token }, frame);
      expect(await message({ action: 'showOverlay' }, { tab: { id: 11 }, frameId: 9 })).toEqual({ ok: false });
      const shown = message({ action: 'showOverlay' }, frame);
      await handled();
      expect(scripts()).toEqual(['mountOverlay']);
      expect(host().shown).toBeUndefined();
      taken();
      expect(await shown).toEqual({ ok: true });
      expect(scripts()).toEqual(['mountOverlay', 'revealOverlay']);
      expect(chrome.scripting.executeScript.mock.calls.at(-1)[0]).toMatchObject({ target: { tabId: 11 }, args: [token] });
      expect(host().shown).toBeGreaterThan(0);
      // Asked again, it shows already: nothing more is done.
      expect(await message({ action: 'showOverlay' }, frame)).toEqual({ ok: true });
      expect(scripts()).toEqual(['mountOverlay', 'revealOverlay']);
    });

    it('on a page: a picture that takes long holds the layer back for 200 ms only', async () => {
      chrome.storage.local.data.openAs = 'page';
      picturing(() => new Promise(() => {}));
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      try {
        press();
        await vi.advanceTimersByTimeAsync(50);
        const { token } = host();
        expect(await message({ action: 'claimOverlay', token }, frame)).toEqual({ ok: true });
        const shown = message({ action: 'showOverlay' }, frame);
        await vi.advanceTimersByTimeAsync(100);
        expect(scripts()).toEqual(['mountOverlay']);
        await vi.advanceTimersByTimeAsync(100);
        expect(await shown).toEqual({ ok: true });
        expect(scripts()).toEqual(['mountOverlay', 'revealOverlay']);
      } finally {
        vi.useRealTimers();
      }
    });

    it('on a page: a layer taken off before it showed leaves no mark, and is not shown later', async () => {
      chrome.storage.local.data.openAs = 'page';
      const { token } = await open();
      await message({ action: 'claimOverlay', token }, frame);
      tell({ action: 'closeOverlay' }, frame);
      await vi.waitFor(() => expect(scripts()).toEqual(['mountOverlay', 'unmountOverlay']));
      expect(host()).toBeNull();
      expect(chrome.storage.session.data.overlayLast).toBeUndefined();
      expect(await message({ action: 'showOverlay' }, frame)).toEqual({ ok: false });
      expect(scripts()).toEqual(['mountOverlay', 'unmountOverlay']);
    });

    it('on a page: a frame let in stays, and is shown after a second even if it never asks', async () => {
      chrome.storage.local.data.openAs = 'page';
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      try {
        press();
        await vi.advanceTimersByTimeAsync(100);
        const { token } = host();
        expect(await message({ action: 'claimOverlay', token }, frame)).toEqual({ ok: true });
        await vi.advanceTimersByTimeAsync(900);
        expect(scripts()).toEqual(['mountOverlay']);
        await vi.advanceTimersByTimeAsync(2100);
        expect(host()).toMatchObject({ kind: 'page', tabId: 11, claimed: true });
        expect(host().shown).toBeGreaterThan(0);
        expect(chrome.windows.create).not.toHaveBeenCalled();
        expect(scripts()).toEqual(['mountOverlay', 'revealOverlay']);
      } finally {
        vi.useRealTimers();
      }
    });

    it('without the cards spread out, the choice does nothing: the window opens', async () => {
      Object.assign(chrome.storage.local.data, { spread: false, openAs: 'page' });
      press();
      await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledTimes(1));
      expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
      expect(chrome.tabs.create).not.toHaveBeenCalled();
      expect(chrome.windows.create.mock.calls[0][0].url).toBe('chrome-extension://test/overview.html');
    });
  });
});
