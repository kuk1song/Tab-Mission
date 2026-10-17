import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { overBudget } from '../extension/src/covers.js';

// A small fake of the chrome APIs covers.js uses: tabs and windows the tests
// arrange, storage in memory, and captures that record when they happened.
function fakeChrome() {
  const listeners = {};
  const event = (name) => ({ addListener: (fn) => { listeners[name] = fn; } });
  const data = {};
  const tabs = new Map();
  const windows = new Map([
    [1, { id: 1, type: 'normal', focused: true, state: 'normal' }],
    [2, { id: 2, type: 'popup', focused: false, state: 'normal' }],
  ]);
  const shots = [];
  const chrome = {
    listeners, data, tabs: null, windows: null, shots,
    _tabs: tabs, _windows: windows,
    storage: {
      session: {
        get: vi.fn(async (key) => (key in data ? { [key]: structuredClone(data[key]) } : {})),
        set: vi.fn(async (items) => { Object.assign(data, structuredClone(items)); }),
        remove: vi.fn(async (keys) => { for (const k of [].concat(keys)) delete data[k]; }),
      },
    },
  };
  chrome.tabs = {
    onActivated: event('onActivated'),
    onUpdated: event('onUpdated'),
    onRemoved: event('onRemoved'),
    get: vi.fn(async (id) => {
      if (!tabs.has(id)) throw new Error(`No tab with id: ${id}.`);
      return { ...tabs.get(id) };
    }),
    query: vi.fn(async ({ windowId, lastFocusedWindow }) => [...tabs.values()].filter((t) =>
      t.active && (lastFocusedWindow ? windows.get(t.windowId).focused && windows.get(t.windowId).type === 'normal' : t.windowId === windowId))),
    captureVisibleTab: vi.fn(async (windowId) => {
      shots.push({ windowId, at: Date.now() });
      return 'data:image/jpeg;base64,RAW';
    }),
  };
  chrome.windows = {
    WINDOW_ID_NONE: -1,
    onFocusChanged: event('onFocusChanged'),
    get: vi.fn(async (id) => ({ ...windows.get(id) })),
  };
  return chrome;
}

let chrome;
let covers;
let shrinkImpl;
const page = (id, extra = {}) => ({
  id, windowId: 1, active: true, status: 'complete', incognito: false, url: `https://site.test/${id}`, ...extra,
});
// Make a tab the front one in its window, as Chrome does on a switch.
function show(tab) {
  for (const t of chrome._tabs.values()) if (t.windowId === tab.windowId) t.active = false;
  chrome._tabs.set(tab.id, tab);
}
const switchTo = (tab) => {
  show(tab);
  chrome.listeners.onActivated({ tabId: tab.id, windowId: tab.windowId });
};

beforeEach(async () => {
  // performance.now too: captures take turns on it.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
  vi.resetModules();
  chrome = fakeChrome();
  vi.stubGlobal('chrome', chrome);
  covers = await import('../extension/src/covers.js');
  shrinkImpl = async () => 'data:image/webp;base64,SMALL';
  covers.startCovers({ shrink: (shot) => shrinkImpl(shot) });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('covers', () => {
  it('takes a picture of a page once it has stayed in front, and the overview reads it back', async () => {
    const tab = page(11);
    switchTo(tab);
    await vi.advanceTimersByTimeAsync(covers.SETTLE_MS - 1);
    expect(chrome.shots).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(chrome.shots).toEqual([expect.objectContaining({ windowId: 1 })]);
    expect(chrome.data['cover:11']).toEqual({ url: tab.url, img: 'data:image/webp;base64,SMALL' });
    expect(chrome.data.coverIndex['11']).toMatchObject({ bytes: 'data:image/webp;base64,SMALL'.length });
    expect(await covers.readCover(tab)).toBe('data:image/webp;base64,SMALL');
  });

  it('shows no picture of an earlier page in the same tab', async () => {
    switchTo(page(11));
    await vi.advanceTimersByTimeAsync(covers.SETTLE_MS);
    expect(await covers.readCover(page(11, { url: 'https://site.test/elsewhere' }))).toBe(null);
  });

  it('a quick run of switches takes one picture, of the tab you stopped at', async () => {
    switchTo(page(11));
    await vi.advanceTimersByTimeAsync(100);
    switchTo(page(12));
    await vi.advanceTimersByTimeAsync(100);
    switchTo(page(13));
    await vi.advanceTimersByTimeAsync(covers.SETTLE_MS * 2);
    expect(chrome.shots).toHaveLength(1);
    expect(Object.keys(chrome.data).filter((k) => k.startsWith('cover:'))).toEqual(['cover:13']);
  });

  it('pictures a page again when it finishes loading, and its window when it gets focus', async () => {
    const tab = page(11, { status: 'loading' });
    switchTo(tab);
    await vi.advanceTimersByTimeAsync(covers.SETTLE_MS);
    expect(chrome.shots).toHaveLength(0); // still loading
    tab.status = 'complete';
    chrome.listeners.onUpdated(11, { status: 'complete' }, tab);
    chrome.listeners.onUpdated(11, { title: 'x' }, tab); // other changes are ignored
    await vi.advanceTimersByTimeAsync(covers.SETTLE_MS);
    expect(chrome.shots).toHaveLength(1);
    chrome.listeners.onFocusChanged(chrome.windows.WINDOW_ID_NONE);
    chrome.listeners.onFocusChanged(1);
    await vi.advanceTimersByTimeAsync(covers.SETTLE_MS + covers.CAPTURE_GAP_MS);
    expect(chrome.shots).toHaveLength(2);
  });

  it('never pictures incognito tabs, browser pages, popups, minimized or unfocused windows', async () => {
    const cases = [
      [page(11, { incognito: true })],
      [page(12, { url: 'chrome://settings/' })],
      [page(13, { windowId: 2 })], // a popup, such as Tab Mission's own window
      [page(14), { state: 'minimized' }],
      [page(15), { focused: false }],
    ];
    for (const [tab, win] of cases) {
      Object.assign(chrome._windows.get(1), { focused: true, state: 'normal' }, win);
      switchTo(tab);
      await vi.advanceTimersByTimeAsync(covers.SETTLE_MS + covers.CAPTURE_GAP_MS);
    }
    expect(chrome.shots).toHaveLength(0);
    expect(Object.keys(chrome.data)).toEqual([]);
  });

  it('keeps Chrome\'s limit of two captures a second', async () => {
    chrome._windows.set(3, { id: 3, type: 'normal', focused: true, state: 'normal' });
    switchTo(page(11));
    switchTo(page(21, { windowId: 3 }));
    await vi.advanceTimersByTimeAsync(covers.SETTLE_MS + covers.CAPTURE_GAP_MS * 2);
    expect(chrome.shots).toHaveLength(2);
    expect(chrome.shots[1].at - chrome.shots[0].at).toBeGreaterThanOrEqual(covers.CAPTURE_GAP_MS);
  });

  it('drops a picture taken while the tab moved to another page', async () => {
    const tab = page(11);
    switchTo(tab);
    chrome.tabs.captureVisibleTab.mockImplementationOnce(async () => {
      chrome._tabs.get(11).url = 'https://site.test/next';
      return 'data:image/jpeg;base64,RAW';
    });
    await vi.advanceTimersByTimeAsync(covers.SETTLE_MS);
    expect(chrome.data['cover:11']).toBeUndefined();
  });

  it('pictures the front tab at once for the shortcut and the toolbar button', async () => {
    show(page(11));
    await covers.coverFrontTab();
    expect(chrome.shots).toHaveLength(1);
    expect(chrome.data['cover:11']).toBeDefined();
    // Pressed inside Tab Mission's own window, no browser window is in front.
    chrome._windows.get(1).focused = false;
    chrome._windows.get(2).focused = true;
    await vi.advanceTimersByTimeAsync(covers.CAPTURE_GAP_MS);
    await covers.coverFrontTab();
    expect(chrome.shots).toHaveLength(1);
  });

  it('forgets a closed tab\'s picture', async () => {
    switchTo(page(11));
    await vi.advanceTimersByTimeAsync(covers.SETTLE_MS);
    chrome.listeners.onRemoved(11);
    await vi.advanceTimersByTimeAsync(0);
    expect(chrome.data['cover:11']).toBeUndefined();
    expect(chrome.data.coverIndex).toEqual({});
  });

  it('pictures a page again 3 s and 15 s after the first, while it stays in front, then stops', async () => {
    switchTo(page(11));
    await vi.advanceTimersByTimeAsync(covers.SETTLE_MS);
    expect(chrome.shots).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(covers.FOLLOW_UP_MS[0]);
    expect(chrome.shots).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(covers.FOLLOW_UP_MS[1]);
    expect(chrome.shots).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(chrome.shots).toHaveLength(3);
    expect(chrome.shots[1].at - chrome.shots[0].at).toBe(covers.FOLLOW_UP_MS[0]);
  });

  it('stops following up once the tab is no longer in front', async () => {
    switchTo(page(11));
    await vi.advanceTimersByTimeAsync(covers.SETTLE_MS);
    show(page(12)); // switched by a way that is not watched here
    await vi.advanceTimersByTimeAsync(covers.FOLLOW_UP_MS[0] + covers.FOLLOW_UP_MS[1]);
    expect(chrome.shots).toHaveLength(1);
  });

  it('does not store a picture of a tab closed while it was being shrunk', async () => {
    switchTo(page(11));
    shrinkImpl = async () => {
      chrome._tabs.delete(11);
      chrome.listeners.onRemoved(11);
      return 'data:image/webp;base64,SMALL';
    };
    await vi.advanceTimersByTimeAsync(covers.SETTLE_MS);
    expect(chrome.shots).toHaveLength(1);
    expect(chrome.data['cover:11']).toBeUndefined();
    expect(chrome.data.coverIndex?.['11']).toBeUndefined();
  });

  it('does not picture a tab moved to another window while it waited its turn', async () => {
    chrome._windows.set(3, { id: 3, type: 'normal', focused: true, state: 'normal' });
    switchTo(page(11));
    const moving = page(21, { windowId: 3 });
    switchTo(moving);
    await vi.advanceTimersByTimeAsync(covers.SETTLE_MS); // 11 is taken; 21 waits
    moving.windowId = 1;
    await vi.advanceTimersByTimeAsync(covers.CAPTURE_GAP_MS);
    expect(chrome.shots).toHaveLength(1);
    expect(chrome.data['cover:21']).toBeUndefined();
  });

  it('keeps taking pictures after the system clock moves back', async () => {
    switchTo(page(11));
    await vi.advanceTimersByTimeAsync(covers.SETTLE_MS);
    vi.setSystemTime(Date.now() - 60 * 60 * 1000);
    switchTo(page(12));
    await vi.advanceTimersByTimeAsync(covers.SETTLE_MS + covers.CAPTURE_GAP_MS);
    expect(chrome.shots).toHaveLength(2);
  });

  it('when storage is full anyway, drops the older pictures and keeps the new one', async () => {
    switchTo(page(11));
    await vi.advanceTimersByTimeAsync(covers.SETTLE_MS);
    chrome.storage.session.set.mockRejectedValueOnce(new Error('Session storage quota bytes exceeded.'));
    switchTo(page(12));
    await vi.advanceTimersByTimeAsync(covers.SETTLE_MS + covers.CAPTURE_GAP_MS);
    expect(chrome.data['cover:11']).toBeUndefined();
    expect(chrome.data['cover:12']).toBeDefined();
    expect(Object.keys(chrome.data.coverIndex)).toEqual(['12']);
  });
});

describe('overBudget', () => {
  it('drops the oldest pictures until the rest fit', () => {
    const index = { 1: { bytes: 40, at: 3 }, 2: { bytes: 40, at: 1 }, 3: { bytes: 40, at: 2 } };
    expect(overBudget(index, 120)).toEqual([]);
    expect(overBudget(index, 100)).toEqual(['2']);
    expect(overBudget(index, 40)).toEqual(['2', '3']);
  });
});
