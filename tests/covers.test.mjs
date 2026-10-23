import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isBlank, overBudget } from '../extension/src/covers.js';

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
      local: {
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
    query: vi.fn(async ({ windowId, lastFocusedWindow } = {}) => [...tabs.values()].filter((t) =>
      windowId === undefined && !lastFocusedWindow ? true
        : t.active && (lastFocusedWindow ? windows.get(t.windowId).focused && windows.get(t.windowId).type === 'normal' : t.windowId === windowId))),
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
    expect(chrome.data.coverIndex['11']).toMatchObject({ url: tab.url, bytes: 'data:image/webp;base64,SMALL'.length });
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
    // Focus right after those three waits for the budget to have a capture
    // again (less than REFILL_MS), then takes one.
    await vi.advanceTimersByTimeAsync(covers.FOLLOW_UP_MS[0] + covers.FOLLOW_UP_MS[1]);
    expect(chrome.shots).toHaveLength(3);
    chrome.listeners.onFocusChanged(chrome.windows.WINDOW_ID_NONE);
    chrome.listeners.onFocusChanged(1);
    await vi.advanceTimersByTimeAsync(covers.SETTLE_MS + covers.CAPTURE_GAP_MS);
    expect(chrome.shots).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(covers.REFILL_MS);
    expect(chrome.shots).toHaveLength(4);
    // With the budget full again, focus pictures it as a switch does.
    await vi.advanceTimersByTimeAsync(covers.BURST * covers.REFILL_MS);
    chrome.listeners.onFocusChanged(1);
    await vi.advanceTimersByTimeAsync(covers.SETTLE_MS);
    expect(chrome.shots).toHaveLength(5);
  });

  it('a page you open in the same tab soon after its captures is pictured at once', async () => {
    const tab = page(11);
    switchTo(tab);
    await vi.advanceTimersByTimeAsync(25_000); // the switch's three captures, then reading
    expect(chrome.shots).toHaveLength(3);
    tab.url = 'https://site.test/next';
    chrome.listeners.onUpdated(11, { url: tab.url }, tab);
    chrome.listeners.onUpdated(11, { status: 'complete' }, tab);
    await vi.advanceTimersByTimeAsync(covers.SETTLE_MS);
    expect(chrome.shots).toHaveLength(4);
    expect(chrome.data['cover:11'].url).toBe('https://site.test/next');
  });

  it('a page that keeps changing its address or reloading is captured about three times a minute', async () => {
    const tab = page(11);
    switchTo(tab);
    // Its address changes every second for two minutes; a frame in it reloads
    // every 2 s (status complete again, same address).
    for (let t = 1; t <= 120; t++) {
      await vi.advanceTimersByTimeAsync(1000);
      tab.url = `https://site.test/11?t=${t}`;
      chrome.listeners.onUpdated(11, { url: tab.url }, tab);
      if (t % 2 === 0) chrome.listeners.onUpdated(11, { status: 'complete' }, tab);
    }
    // The switch's capture (0.5 s), two more while the budget lasts (1.5 and
    // 2.5 s), the follow-ups of the last (5 and 17 s), then one every
    // REFILL_MS (37 to 117 s): about three a minute.
    expect(chrome.shots).toHaveLength(10);
    const at = chrome.shots.map((s) => s.at);
    expect(at.slice(5).every((t, i) => t - at[i + 4] >= covers.REFILL_MS)).toBe(true);
    expect(chrome.data['cover:11'].url).toMatch(/\?t=11\d$/); // the latest page
  });

  it('a capture Chrome refuses is tried again at the next follow-up', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    chrome.tabs.captureVisibleTab.mockRejectedValueOnce(new Error('Failed to capture tab: unknown error'));
    switchTo(page(11));
    await vi.advanceTimersByTimeAsync(covers.SETTLE_MS);
    expect(chrome.data['cover:11']).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(covers.FOLLOW_UP_MS[0]);
    expect(chrome.shots).toHaveLength(1); // the refused one is not recorded by the fake
    expect(chrome.data['cover:11']).toEqual({ url: 'https://site.test/11', img: 'data:image/webp;base64,SMALL' });
    warn.mockRestore();
  });

  it('a capture Chrome never answers counts as refused, and the follow-up tries again', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    chrome.tabs.captureVisibleTab.mockImplementationOnce(() => new Promise(() => {}));
    switchTo(page(11));
    await vi.advanceTimersByTimeAsync(covers.SETTLE_MS + covers.CAPTURE_TIMEOUT_MS - 1);
    expect(warn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(chrome.data['cover:11']).toBeUndefined();
    await vi.advanceTimersByTimeAsync(covers.FOLLOW_UP_MS[0]);
    expect(chrome.shots).toHaveLength(1); // the unanswered one is not recorded by the fake
    expect(chrome.data['cover:11']).toEqual({ url: 'https://site.test/11', img: 'data:image/webp;base64,SMALL' });
    warn.mockRestore();
  });

  it('an answer that comes after the capture was given up is dropped, even after a newer picture', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let answer;
    chrome.tabs.captureVisibleTab.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    const shrunk = [];
    shrinkImpl = async (shot) => { shrunk.push(shot); return shot.replace('jpeg', 'webp'); };
    switchTo(page(11));
    await vi.advanceTimersByTimeAsync(covers.SETTLE_MS + covers.CAPTURE_TIMEOUT_MS + covers.FOLLOW_UP_MS[0]);
    expect(shrunk).toEqual(['data:image/jpeg;base64,RAW']); // the follow-up's
    expect(chrome.data['cover:11']).toEqual({ url: 'https://site.test/11', img: 'data:image/webp;base64,RAW' });
    const writes = chrome.storage.local.set.mock.calls.length;
    answer('data:image/jpeg;base64,LATE');
    await vi.advanceTimersByTimeAsync(0);
    expect(shrunk).toEqual(['data:image/jpeg;base64,RAW']);
    expect(chrome.data['cover:11']).toEqual({ url: 'https://site.test/11', img: 'data:image/webp;base64,RAW' });
    expect(chrome.storage.local.set.mock.calls.length).toBe(writes);
    warn.mockRestore();
  });

  it('a page still loading is left for the follow-ups, which take it as it is', async () => {
    switchTo(page(11, { status: 'loading' })); // held up by a slow image, say
    await vi.advanceTimersByTimeAsync(covers.SETTLE_MS);
    expect(chrome.shots).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(covers.FOLLOW_UP_MS[0]);
    expect(chrome.shots).toHaveLength(1);
    expect(chrome.data['cover:11']).toEqual({ url: 'https://site.test/11', img: 'data:image/webp;base64,SMALL' });
    await vi.advanceTimersByTimeAsync(covers.FOLLOW_UP_MS[1]);
    expect(chrome.shots).toHaveLength(2);
  });

  it('stores no blank picture, and tries again at the follow-up', async () => {
    shrinkImpl = async () => null; // one colour throughout: not painted yet
    switchTo(page(11));
    await vi.advanceTimersByTimeAsync(covers.SETTLE_MS);
    expect(chrome.shots).toHaveLength(1);
    expect(chrome.data['cover:11']).toBeUndefined();
    shrinkImpl = async () => 'data:image/webp;base64,SMALL';
    await vi.advanceTimersByTimeAsync(covers.FOLLOW_UP_MS[0]);
    expect(chrome.shots).toHaveLength(2);
    expect(chrome.data['cover:11']).toEqual({ url: 'https://site.test/11', img: 'data:image/webp;base64,SMALL' });
  });

  it('never pictures incognito tabs, browser pages, popups, minimized or unfocused windows', async () => {
    const cases = [
      [page(11, { incognito: true })],
      [page(12, { url: 'chrome://settings/' })],
      [page(13, { windowId: 2 })], // a popup, such as Tab Mission's own window
      [page(14), { state: 'minimized' }],
      [page(15), { focused: false }],
    ];
    // The popup has focus, as Tab Mission's window has while open, so only
    // its type keeps it out.
    chrome._windows.get(2).focused = true;
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
    expect(chrome.data['cover:11']).toEqual({ url: 'https://site.test/11', img: 'data:image/webp;base64,SMALL' });
    // Pressed inside Tab Mission's own window, no browser window is in front.
    chrome._windows.get(1).focused = false;
    chrome._windows.get(2).focused = true;
    await vi.advanceTimersByTimeAsync(covers.CAPTURE_GAP_MS);
    await covers.coverFrontTab();
    expect(chrome.shots).toHaveLength(1);
  });

  it('forgets a closed tab\'s picture, and writes nothing for a tab without one', async () => {
    switchTo(page(11));
    await vi.advanceTimersByTimeAsync(covers.SETTLE_MS);
    chrome.listeners.onRemoved(11);
    await vi.advanceTimersByTimeAsync(0);
    expect(chrome.data['cover:11']).toBeUndefined();
    expect(chrome.data.coverIndex).toEqual({});
    const writes = chrome.storage.local.set.mock.calls.length;
    chrome.listeners.onRemoved(12);
    await vi.advanceTimersByTimeAsync(0);
    expect(chrome.storage.local.set.mock.calls.length).toBe(writes);
    expect(chrome.storage.local.remove).toHaveBeenCalledTimes(1);
  });

  it('closing a window of pictured tabs takes one storage update', async () => {
    chrome.data.coverIndex = {};
    for (const id of [21, 22, 23]) {
      chrome.data[`cover:${id}`] = { url: page(id).url, img: 'data:x' };
      chrome.data.coverIndex[id] = { url: page(id).url, bytes: 6, at: id };
    }
    for (const id of [21, 22, 23]) chrome.listeners.onRemoved(id);
    await vi.advanceTimersByTimeAsync(0);
    expect(chrome.storage.local.remove).toHaveBeenCalledTimes(1);
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
    expect(chrome.data.coverIndex).toEqual({});
    expect(Object.keys(chrome.data)).toEqual(['coverIndex']);
  });

  it('after a storage read fails, the next closed tab\'s picture is still forgotten', async () => {
    chrome.data.coverIndex = {};
    for (const id of [21, 22]) {
      chrome.data[`cover:${id}`] = { url: page(id).url, img: 'data:x' };
      chrome.data.coverIndex[id] = { url: page(id).url, bytes: 6, at: id };
    }
    chrome.storage.local.get.mockRejectedValueOnce(new Error('storage failed'));
    chrome.listeners.onRemoved(21);
    await vi.advanceTimersByTimeAsync(0);
    expect(chrome.data['cover:21']).toBeDefined(); // left for tidyCovers
    chrome.listeners.onRemoved(22);
    await vi.advanceTimersByTimeAsync(0);
    expect(chrome.data['cover:22']).toBeUndefined();
    expect(Object.keys(chrome.data.coverIndex)).toEqual(['21']);
  });

  it('after a restart, a tab back under a new id shows its page\'s picture until it has its own', async () => {
    switchTo(page(11));
    await vi.advanceTimersByTimeAsync(covers.SETTLE_MS);
    const before = chrome.data['cover:11'].img;
    // The browser restarts: the page comes back in tab 31, and the old
    // service worker's state is gone.
    chrome._tabs.clear();
    show(page(31, { url: page(11).url }));
    vi.resetModules();
    covers = await import('../extension/src/covers.js');
    expect(await covers.readCover(page(31, { url: page(11).url }))).toBe(before);
    expect(await covers.readCover(page(31, { url: page(11).url, incognito: true }))).toBe(null);
    await covers.tidyCovers();
    expect(Object.keys(chrome.data.coverIndex)).toEqual(['11']); // kept for tab 31
  });

  it('tidying keeps the picture of a page a tab is still on its way to', async () => {
    switchTo(page(11));
    await vi.advanceTimersByTimeAsync(covers.SETTLE_MS);
    // After a restart, the page is coming back in tab 31, which has no
    // address until its page commits, only the one it is going to.
    chrome._tabs.clear();
    show(page(31, { url: '', pendingUrl: page(11).url, status: 'loading' }));
    vi.resetModules();
    covers = await import('../extension/src/covers.js');
    await covers.tidyCovers();
    expect(Object.keys(chrome.data.coverIndex)).toEqual(['11']);
  });

  it('tidying keeps each tab\'s own picture and the newest of a page without one, and drops the rest', async () => {
    const url = 'https://site.test/same';
    chrome.data.coverIndex = {
      11: { url: page(11).url, bytes: 10, at: 1 }, // tab 11's own
      12: { url, bytes: 10, at: 2 }, // older pictures of the page tab 32 shows
      13: { url, bytes: 10, at: 3 },
      14: { url: 'https://site.test/gone', bytes: 10, at: 4 }, // a page no longer open
      15: { url: page(15).url, bytes: 10, at: 5 }, // tab 15 moved on to another page
    };
    for (const id of [11, 12, 13, 14, 15]) chrome.data[`cover:${id}`] = { url: chrome.data.coverIndex[id].url, img: `data:${id}` };
    show(page(11));
    show(page(32, { windowId: 3, url }));
    show(page(15, { windowId: 4, url: 'https://site.test/next' }));
    show(page(33, { windowId: 5, url: 'https://site.test/gone', incognito: true }));
    await covers.tidyCovers();
    expect(Object.keys(chrome.data.coverIndex).sort()).toEqual(['11', '13']);
    expect(Object.keys(chrome.data).filter((k) => k.startsWith('cover:')).sort()).toEqual(['cover:11', 'cover:13']);
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
    chrome.storage.local.set.mockRejectedValueOnce(new Error('Resource::kQuotaBytes quota exceeded'));
    switchTo(page(12));
    await vi.advanceTimersByTimeAsync(covers.SETTLE_MS + covers.CAPTURE_GAP_MS);
    expect(chrome.data['cover:11']).toBeUndefined();
    expect(chrome.data['cover:12']).toEqual({ url: 'https://site.test/12', img: 'data:image/webp;base64,SMALL' });
    expect(Object.keys(chrome.data.coverIndex)).toEqual(['12']);
  });
});

describe('isBlank', () => {
  const pixels = (n, at = () => [250, 250, 250]) => Uint8ClampedArray.from({ length: n * 4 }, (_, i) => (i % 4 === 3 ? 255 : at(Math.floor(i / 4))[i % 4]));
  it('is true for one colour, with faint noise, and false once a little content shows', () => {
    expect(isBlank(pixels(64000))).toBe(true);
    expect(isBlank(pixels(64000, (p) => (p % 7 ? [250, 250, 250] : [244, 252, 248])))).toBe(true);
    // One line of text across a 640 px wide picture, every 40th row.
    expect(isBlank(pixels(64000, (p) => (Math.floor(p / 640) % 40 === 20 ? [30, 30, 30] : [250, 250, 250])))).toBe(false);
    // A page with only a short title: 100 x 8 px of a 640 x 400 picture.
    const title = (p) => (p % 640 >= 8 && p % 640 < 108 && Math.floor(p / 640) >= 12 && Math.floor(p / 640) < 20);
    expect(isBlank(pixels(256000, (p) => (title(p) ? [30, 30, 30] : [250, 250, 250])))).toBe(false);
    // A few stray pixels, such as a text cursor, are not content.
    expect(isBlank(pixels(256000, (p) => (p % 25000 === 1000 ? [30, 30, 30] : [250, 250, 250])))).toBe(true);
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
