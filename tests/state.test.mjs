import { describe, it, expect, beforeEach } from 'vitest';
import { state, applyFilters, moveSelection, moveSelectionByRects, countSiteTabs, RECENT_MAX } from '../extension/src/state.js';

function makeTab(id, overrides = {}) {
  return {
    id,
    lastAccessed: 0,
    windowId: 1,
    active: false,
    discarded: false,
    status: 'complete',
    title: '',
    url: 'https://example.com/',
    ...overrides,
  };
}

function ui(overrides = {}) {
  return { searchTerm: '', showSleeping: false, showAllWindows: false, ...overrides };
}

beforeEach(() => {
  state.allTabs = [];
  state.filteredTabs = [];
  state.selectedIndex = -1;
  state.defaultIndex = -1;
  state.currentWindowId = 1;
  state.currentTabId = null;
  state.selfWindowId = null;
  state.siteHost = '';
  state.unseen = new Set();
});

// Chrome gives a tab the time it was opened as its lastAccessed, so a tab
// opened in the background (unseen.js) would pass for the most recent one.
describe('applyFilters: a tab opened in the background and not shown yet', () => {
  beforeEach(() => {
    state.currentTabId = 2;
    state.allTabs = [
      makeTab(1, { lastAccessed: 100 }), // the tab you were on before
      makeTab(2, { lastAccessed: 200, active: true }), // the current tab
      makeTab(3, { lastAccessed: 300 }), // opened from it in the background
    ];
    state.unseen = new Set([3]);
  });

  it('is not the previous tab: that one stays first and pre-selected, the current tab second', () => {
    applyFilters(ui({ preselectPrevious: true }));
    expect(state.filteredTabs.map((t) => t.id)).toEqual([1, 2, 3]);
    expect(state.selectedIndex).toBe(0);
  });

  it("can be a query's best match", () => {
    applyFilters(ui({ searchTerm: 'example' }));
    expect(state.filteredTabs[state.selectedIndex].id).toBe(3);
  });

  it('with no other tab you have been on, the current tab is pre-selected', () => {
    state.allTabs = state.allTabs.filter((t) => t.id !== 1);
    applyFilters(ui({ preselectPrevious: true }));
    expect(state.filteredTabs[state.selectedIndex].id).toBe(2);
  });

  it('once shown, it is the previous tab like any other', () => {
    state.unseen = new Set();
    applyFilters(ui({ preselectPrevious: true }));
    expect(state.filteredTabs.map((t) => t.id)).toEqual([3, 2, 1]);
    expect(state.selectedIndex).toBe(0);
  });
});

describe('applyFilters — MRU ordering', () => {
  it('sorts by lastAccessed descending', () => {
    state.allTabs = [
      makeTab(1, { lastAccessed: 100 }),
      makeTab(2, { lastAccessed: 300 }),
      makeTab(3, { lastAccessed: 200 }),
    ];
    applyFilters(ui());
    expect(state.filteredTabs.map((t) => t.id)).toEqual([2, 3, 1]);
  });

  it('puts the previous tab first and the current tab second', () => {
    state.currentTabId = 1;
    state.allTabs = [
      makeTab(1, { lastAccessed: 500, active: true }), // current tab, most recent
      makeTab(2, { lastAccessed: 300 }),
      makeTab(3, { lastAccessed: 400 }), // previous tab
    ];
    applyFilters(ui());
    expect(state.filteredTabs.map((t) => t.id)).toEqual([3, 1, 2]);
  });

  it('leaves the current tab where it was used when it comes after the previous tab', () => {
    // Two tabs of another window were used after it; all windows shown, or
    // a query, lists them first.
    state.currentTabId = 3;
    state.allTabs = [
      makeTab(1, { lastAccessed: 500, windowId: 2 }),
      makeTab(2, { lastAccessed: 400, active: true, windowId: 2 }),
      makeTab(3, { lastAccessed: 300, active: true }), // current tab
    ];
    applyFilters(ui({ showAllWindows: true }));
    expect(state.filteredTabs.map((t) => t.id)).toEqual([1, 2, 3]);
    applyFilters(ui({ searchTerm: 'example' }));
    expect(state.filteredTabs.map((t) => t.id)).toEqual([1, 2, 3]);
  });

  it('leaves the order alone when the current tab is not listed', () => {
    state.currentTabId = 99;
    state.allTabs = [makeTab(1, { lastAccessed: 2 }), makeTab(2, { lastAccessed: 1 })];
    applyFilters(ui());
    expect(state.filteredTabs.map((t) => t.id)).toEqual([1, 2]);
  });

  it('clamps a stale selection to the last valid index', () => {
    state.selectedIndex = 5;
    state.allTabs = [makeTab(1, { lastAccessed: 2 }), makeTab(2, { lastAccessed: 1 })];
    applyFilters(ui());
    expect(state.selectedIndex).toBe(1);
  });

  it('selects nothing (-1) when no tab matches', () => {
    state.allTabs = [makeTab(1, { title: 'github' })];
    applyFilters(ui({ searchTerm: 'no-such-tab' }));
    expect(state.filteredTabs).toHaveLength(0);
    expect(state.selectedIndex).toBe(-1);
  });

  it('orders across windows purely by recency when showing all windows', () => {
    state.currentWindowId = 1;
    state.allTabs = [
      makeTab(1, { lastAccessed: 600, active: true, windowId: 1 }), // most recent
      makeTab(2, { lastAccessed: 500, active: true, windowId: 2 }),
      makeTab(3, { lastAccessed: 400, windowId: 1 }),
    ];
    applyFilters(ui({ showAllWindows: true }));
    expect(state.filteredTabs.map((t) => t.id)).toEqual([1, 2, 3]);
  });
});

describe('applyFilters — filtering', () => {
  it('shows only the current window by default', () => {
    state.currentWindowId = 1;
    state.allTabs = [makeTab(1, { windowId: 1 }), makeTab(2, { windowId: 2 })];
    applyFilters(ui({ showAllWindows: false }));
    expect(state.filteredTabs.map((t) => t.id)).toEqual([1]);
  });

  it('shows every window when requested', () => {
    state.currentWindowId = 1;
    state.allTabs = [
      makeTab(1, { windowId: 1, lastAccessed: 2 }),
      makeTab(2, { windowId: 2, lastAccessed: 1 }),
    ];
    applyFilters(ui({ showAllWindows: true }));
    expect([...state.filteredTabs.map((t) => t.id)].sort()).toEqual([1, 2]);
  });

  it('hides sleeping (discarded/unloaded) tabs by default, shows them on request', () => {
    state.allTabs = [
      makeTab(1, { discarded: false, lastAccessed: 2 }),
      makeTab(2, { discarded: true, lastAccessed: 1 }),
      makeTab(3, { status: 'unloaded', lastAccessed: 3 }),
    ];
    applyFilters(ui({ showSleeping: false }));
    expect(state.filteredTabs.map((t) => t.id)).toEqual([1]);

    applyFilters(ui({ showSleeping: true }));
    expect([...state.filteredTabs.map((t) => t.id)].sort()).toEqual([1, 2, 3]);
  });

  it('filters by title or URL, case-insensitively', () => {
    state.allTabs = [
      makeTab(1, { title: 'GitHub', url: 'https://github.com/', lastAccessed: 3 }),
      makeTab(2, { title: 'Docs', url: 'https://example.com/', lastAccessed: 2 }),
      makeTab(3, { title: 'Mail', url: 'https://gmail.com/', lastAccessed: 1 }),
    ];
    applyFilters(ui({ searchTerm: 'GIT' }));
    expect(state.filteredTabs.map((t) => t.id)).toEqual([1]);
  });
});

describe('applyFilters — the overview never lists itself', () => {
  it('drops the tab of its own popup window, even when showing all windows', () => {
    state.selfWindowId = 9;
    state.allTabs = [
      makeTab(1, { windowId: 1, lastAccessed: 1 }),
      makeTab(99, { windowId: 9, lastAccessed: 999, title: 'Tab Mission' }), // the overview
    ];
    applyFilters(ui({ showAllWindows: true }));
    expect(state.filteredTabs.map((t) => t.id)).toEqual([1]);
  });
});

describe('applyFilters — search finds a tab wherever it is', () => {
  it('ignores the window and sleeping toggles while a query is typed', () => {
    state.allTabs = [
      makeTab(1, { windowId: 1, title: 'Docs here', lastAccessed: 3 }),
      makeTab(2, { windowId: 2, title: 'Docs there', lastAccessed: 2 }),
      makeTab(3, { windowId: 1, title: 'Docs asleep', discarded: true, lastAccessed: 1 }),
    ];
    applyFilters(ui({ searchTerm: 'docs', showAllWindows: false, showSleeping: false }));
    expect(state.filteredTabs.map((t) => t.id)).toEqual([1, 2, 3]);
  });

  it('requires every word to match the title or URL', () => {
    state.allTabs = [
      makeTab(1, { title: 'GitHub - kuk1song/Tab-Mission', url: 'https://github.com/kuk1song/Tab-Mission', lastAccessed: 2 }),
      makeTab(2, { title: 'GitHub', url: 'https://github.com/', lastAccessed: 1 }),
    ];
    applyFilters(ui({ searchTerm: 'git  mission' }));
    expect(state.filteredTabs.map((t) => t.id)).toEqual([1]);
  });

  it('pre-selects the most recent match that is not the current tab', () => {
    state.currentTabId = 1;
    state.allTabs = [
      makeTab(1, { title: 'GitHub repo A', lastAccessed: 3 }), // current tab
      makeTab(2, { title: 'GitHub repo B', lastAccessed: 2 }),
      makeTab(3, { title: 'GitHub repo C', lastAccessed: 1 }),
    ];
    applyFilters(ui({ searchTerm: 'github' }));
    expect(state.filteredTabs.map((t) => t.id)).toEqual([2, 1, 3]); // current tab second
    expect(state.selectedIndex).toBe(0);
    expect(state.defaultIndex).toBe(0);
  });

  it('falls back to the current tab when it is the only match', () => {
    state.currentTabId = 1;
    state.allTabs = [makeTab(1, { title: 'Only me', lastAccessed: 1 })];
    applyFilters(ui({ searchTerm: 'only' }));
    expect(state.selectedIndex).toBe(0);
  });

  it('drops the automatic selection when the query is erased', () => {
    state.allTabs = [makeTab(1, { title: 'a', lastAccessed: 2 }), makeTab(2, { title: 'a', lastAccessed: 1 })];
    applyFilters(ui({ searchTerm: 'a' }));
    expect(state.selectedIndex).toBe(0); // the best match
    applyFilters(ui({ searchTerm: '' }));
    expect(state.defaultIndex).toBe(-1);
    expect(state.selectedIndex).toBe(-1); // so the shortcut closes again
  });

  it('keeps a selection the user made when a toggle changes', () => {
    state.allTabs = [1, 2, 3].map((id) => makeTab(id, { lastAccessed: 10 - id }));
    applyFilters(ui());
    state.selectedIndex = 2; // hovered or arrowed to
    applyFilters(ui({ showSleeping: true }));
    expect(state.selectedIndex).toBe(2);
  });
});

describe('applyFilters — site view', () => {
  beforeEach(() => {
    state.siteHost = 'docs.google.com';
    state.allTabs = [
      makeTab(1, { url: 'https://docs.google.com/a', windowId: 1, lastAccessed: 4 }),
      makeTab(2, { url: 'https://docs.google.com/b', windowId: 2, lastAccessed: 3 }),
      makeTab(3, { url: 'https://docs.google.com/c', discarded: true, lastAccessed: 2 }),
      makeTab(4, { url: 'https://mail.google.com/', lastAccessed: 5 }),
    ];
  });

  it('follows the window and sleeping toggles like the browse view', () => {
    applyFilters(ui());
    expect(state.filteredTabs.map((t) => t.id)).toEqual([1]);
    applyFilters(ui({ showAllWindows: true, showSleeping: true }));
    expect(state.filteredTabs.map((t) => t.id)).toEqual([1, 2, 3]);
    expect(state.selectedIndex).toBe(-1); // no query, so nothing pre-selected
  });

  it('a query inside the site view still searches every window and sleeping tab', () => {
    applyFilters(ui({ searchTerm: 'docs' }));
    expect(state.filteredTabs.map((t) => t.id)).toEqual([1, 2, 3]);
  });

  it('countSiteTabs counts what the site view would show', () => {
    expect(countSiteTabs('docs.google.com', ui())).toBe(1);
    expect(countSiteTabs('docs.google.com', ui({ showAllWindows: true, showSleeping: true }))).toBe(3);
    expect(countSiteTabs('', ui())).toBe(0);
  });
});

describe('moveSelection', () => {
  beforeEach(() => {
    state.currentTabId = 1;
    state.allTabs = [1, 2, 3, 4, 5].map((id) => makeTab(id, { lastAccessed: 10 - id }));
    applyFilters(ui());
  });

  it('starts at the first tile, which is the previous tab', () => {
    moveSelection('ArrowRight', 3);
    expect(state.selectedIndex).toBe(0);
    expect(state.filteredTabs[0].id).toBe(2);
  });

  it('moves by a full row with ↓ and clamps at both ends', () => {
    moveSelection('ArrowDown', 3);
    expect(state.selectedIndex).toBe(0);
    moveSelection('ArrowDown', 3);
    expect(state.selectedIndex).toBe(3);
    moveSelection('ArrowDown', 3);
    expect(state.selectedIndex).toBe(4);
    moveSelection('ArrowUp', 3);
    expect(state.selectedIndex).toBe(1);
    moveSelection('ArrowLeft', 3);
    moveSelection('ArrowLeft', 3);
    expect(state.selectedIndex).toBe(0);
  });

  it('enters from the edges when the current tab is not listed', () => {
    state.currentTabId = 42;
    state.selectedIndex = -1;
    moveSelection('ArrowRight', 3);
    expect(state.selectedIndex).toBe(0);
    state.selectedIndex = -1;
    moveSelection('ArrowLeft', 3);
    expect(state.selectedIndex).toBe(4);
  });

  it('does nothing on an empty list', () => {
    state.filteredTabs = [];
    state.selectedIndex = -1;
    moveSelection('ArrowRight', 3);
    expect(state.selectedIndex).toBe(-1);
  });
});

describe('applyFilters — preselectPrevious setting', () => {
  beforeEach(() => {
    state.currentTabId = 1;
    state.allTabs = [1, 2, 3].map((id) => makeTab(id, { lastAccessed: 10 - id }));
  });

  it('rests on the previous tab when the overview opens', () => {
    applyFilters(ui({ preselectPrevious: true }));
    expect(state.filteredTabs[state.selectedIndex].id).toBe(2);
    expect(state.defaultIndex).toBe(0);
  });

  it('keeps nothing selected when the setting is off', () => {
    applyFilters(ui({ preselectPrevious: false }));
    expect(state.selectedIndex).toBe(-1);
  });

  it('returns to the previous tab after a query is erased', () => {
    applyFilters(ui({ preselectPrevious: true, searchTerm: 'x' }));
    applyFilters(ui({ preselectPrevious: true, searchTerm: '' }));
    expect(state.filteredTabs[state.selectedIndex].id).toBe(2);
  });

  it('keeps a hovered tile selected when a toggle changes', () => {
    applyFilters(ui({ preselectPrevious: true }));
    state.selectedIndex = 2; // hovered
    applyFilters(ui({ preselectPrevious: true, showSleeping: true }));
    expect(state.selectedIndex).toBe(2);
  });

  it('gives a new view its own default when the site scope changes', () => {
    state.allTabs = [
      makeTab(1, { lastAccessed: 9, url: 'https://a.test/1' }),
      makeTab(2, { lastAccessed: 8, url: 'https://b.test/' }),
      makeTab(3, { lastAccessed: 7, url: 'https://a.test/2' }),
    ];
    applyFilters(ui({ preselectPrevious: true }));
    state.selectedIndex = 2; // hovered, then the scope changes (setSiteScope)
    state.selectedIndex = state.defaultIndex;
    state.siteHost = 'a.test';
    applyFilters(ui({ preselectPrevious: true }));
    expect(state.filteredTabs[state.selectedIndex].id).toBe(3);
  });
});

describe('applyFilters — group by site', () => {
  // Eight tabs in one window, in tab-bar order (index); by last use: 8 (the
  // current tab), 3, 2, 6, 7, 5, 4, 1. a.test has three tabs, b.test and
  // c.test two, d.test one.
  const strip = [
    ['https://a.test/1', 1], ['https://b.test/1', 6], ['https://a.test/2', 7], ['https://c.test/1', 2],
    ['https://b.test/2', 3], ['https://a.test/3', 5], ['https://d.test/1', 4], ['https://c.test/2', 8],
  ];
  const ids = (list) => list.map((tab) => tab.id);
  const shape = () => state.groups.map(({ recent, other, host, count }) => [recent ? 'recent' : other ? 'other' : host, count]);
  const site = (url, index, lastAccessed = 0) => ({ url, index, lastAccessed });
  beforeEach(() => {
    state.allTabs = strip.map(([url, lastAccessed], i) => makeTab(i + 1, { url, index: i, lastAccessed }));
    state.currentTabId = 8;
  });

  // Three tiles fit in a row here.
  const grouped = (overrides = {}) => ui({ groupBySite: true, columns: 3, ...overrides });

  it('puts the five most recent tabs first, then all the tabs of each site with two or more, in tab-bar order', () => {
    applyFilters(grouped({ preselectPrevious: true }));
    // d.test's only tab is among the recent tabs, so there is no last group.
    expect(shape()).toEqual([['recent', 5], ['a.test', 3], ['b.test', 2], ['c.test', 2]]);
    // Recent: the previous tab first, the current tab second.
    expect(ids(state.filteredTabs.slice(0, 5))).toEqual([3, 8, 2, 6, 7]);
    expect(ids(state.filteredTabs.slice(5))).toEqual([1, 3, 6, 2, 5, 4, 8]);
    expect(state.filteredTabs[state.selectedIndex].id).toBe(3);
    expect(state.columns).toBe(3);
  });

  it('holds five recent tabs at any window size', () => {
    for (const columns of [1, 2, 5, 8, undefined]) {
      applyFilters(ui({ groupBySite: true, columns }));
      expect(state.groups[0].count).toBe(RECENT_MAX);
    }
    expect(state.columns).toBe(0); // not measured
    state.allTabs = state.allTabs.slice(0, 3);
    applyFilters(grouped());
    expect(state.groups[0].count).toBe(3);
  });

  it('groups at any number of tabs, and shows a few one-tab sites once each', () => {
    state.allTabs = [makeTab(1, site('https://x.test/', 0, 2)), makeTab(2, site('https://y.test/', 1, 1))];
    applyFilters(grouped());
    expect(shape()).toEqual([['recent', 2]]);
    state.allTabs = Array.from({ length: 7 }, (_, i) => makeTab(i + 1, site(`https://s${i}.test/`, i, i)));
    applyFilters(grouped());
    expect(shape()).toEqual([['recent', 5], ['other', 2]]);
    expect(new Set(ids(state.filteredTabs)).size).toBe(7);
    expect(state.filteredTabs).toHaveLength(7);
  });

  it('keeps the site groups where they are when you switch tabs; the rest takes what leaves the recent tabs', () => {
    const sites = () => state.groups.filter((g) => !g.recent && !g.other)
      .map((g) => [g.host, g.start, ids(state.filteredTabs.slice(g.start, g.start + g.count))]);
    applyFilters(grouped());
    const before = sites();
    state.allTabs.find((tab) => tab.id === 1).lastAccessed = 100; // switched to a.test/1
    state.currentTabId = 1;
    applyFilters(grouped());
    expect(sites()).toEqual(before);
    expect(state.filteredTabs[0].id).toBe(8); // the previous tab now
    expect(shape().at(-1)).toEqual(['other', 1]); // d.test's tab, no longer a recent tab
  });

  it('orders windows by when they were opened, and tabs by position', () => {
    state.allTabs = [
      makeTab(1, { windowId: 2, index: 0, url: 'https://late.test/1' }),
      makeTab(2, { windowId: 2, index: 1, url: 'https://late.test/2' }),
      makeTab(3, { windowId: 1, index: 1, url: 'https://second.test/1' }),
      makeTab(4, { windowId: 1, index: 0, url: 'https://first.test/1' }),
      makeTab(5, { windowId: 1, index: 3, url: 'https://second.test/2' }),
      makeTab(6, { windowId: 1, index: 2, url: 'https://first.test/2' }),
    ];
    applyFilters(grouped({ showAllWindows: true }));
    expect(shape().slice(1)).toEqual([['first.test', 2], ['second.test', 2], ['late.test', 2]]);
    expect(ids(state.filteredTabs.slice(5))).toEqual([4, 6, 3, 5, 1, 2]);
  });

  it('puts the rest last, in tab-bar order, without the tabs already among the recent tabs', () => {
    state.allTabs = [
      makeTab(1, site('file:///notes.html', 0)),
      makeTab(2, site('https://x.test/', 1)),
      makeTab(3, site('chrome://extensions/', 2)),
      makeTab(4, site('https://y.test/1', 3)),
      makeTab(5, site('https://y.test/2', 4, 5)),
      makeTab(6, site('chrome://extensions/', 5, 6)),
      makeTab(7, site('about:blank', 6, 7)),
      makeTab(8, site('https://z.test/', 7, 8)),
      makeTab(9, site('https://w.test/', 8, 9)),
    ];
    applyFilters(grouped());
    expect(ids(state.filteredTabs.slice(0, 5))).toEqual([9, 8, 7, 6, 5]);
    // y.test keeps both its tabs (5 is among the recent tabs too).
    expect(shape()).toEqual([['recent', 5], ['y.test', 2], ['other', 3]]);
    expect(ids(state.filteredTabs.slice(5))).toEqual([4, 5, 1, 2, 3]);
  });

  it('packs panels row by row: each row takes the next sites that fit', () => {
    // Sites of 3, 3, 2, 2 and 2 tabs, in tab-bar order.
    state.allTabs = [['p', 3], ['q', 3], ['r', 2], ['s', 2], ['t', 2]]
      .flatMap(([name, n]) => Array.from({ length: n }, () => `https://${name}.test/`))
      .map((url, i) => makeTab(i + 1, { url: `${url}${i}`, index: i }));
    const sites = () => shape().slice(1).map(([name]) => name);
    applyFilters(ui({ groupBySite: true, columns: 5 }));
    expect(sites()).toEqual(['p.test', 'r.test', 'q.test', 's.test', 't.test']);
    applyFilters(ui({ groupBySite: true, columns: 4 }));
    expect(sites()).toEqual(['p.test', 'q.test', 'r.test', 's.test', 't.test']);
    // The tiles follow their groups.
    applyFilters(ui({ groupBySite: true, columns: 5 }));
    const r = state.groups.find((g) => g.host === 'r.test');
    expect(state.filteredTabs.slice(r.start, r.start + r.count).every((tab) => tab.url.startsWith('https://r.test/'))).toBe(true);
  });

  it('keeps a tile you picked when the panels are packed anew, in its own place', () => {
    // By last use 12, 11, 10, 9, 8, …: those are the five recent tabs.
    // Packing: p r | q s | t at five columns, p | q | r s | t at four.
    state.allTabs = [['p', 3], ['q', 3], ['r', 2], ['s', 2], ['t', 2]]
      .flatMap(([name, n]) => Array.from({ length: n }, () => `https://${name}.test/`))
      .map((url, i) => makeTab(i + 1, { url: `${url}${i}`, index: i, lastAccessed: i }));
    const panels = (columns) => ui({ groupBySite: true, preselectPrevious: true, columns });
    const siteTile = (id) => state.filteredTabs.findIndex((tab, i) => tab.id === id && i >= state.groups[0].count);
    // Picked by an arrow key or the pointer: tab 8's tile under r.test.
    applyFilters(panels(5));
    const before = siteTile(8);
    state.selectedIndex = before;
    applyFilters(panels(4));
    expect(state.selectedIndex).not.toBe(before); // it moved…
    expect(state.selectedIndex).toBe(siteTile(8)); // …and stayed picked
    // Tab 9 is among the recent tabs too: its site tile stays the one picked.
    applyFilters(panels(5));
    state.selectedIndex = siteTile(9);
    applyFilters(panels(4));
    expect(state.selectedIndex).toBe(siteTile(9));
    // And its recent tile stays the recent one.
    state.selectedIndex = state.filteredTabs.findIndex((tab) => tab.id === 9);
    expect(state.selectedIndex).toBeLessThan(state.groups[0].count);
    applyFilters(panels(5));
    expect(state.filteredTabs[state.selectedIndex].id).toBe(9);
    expect(state.selectedIndex).toBeLessThan(state.groups[0].count);
  });

  it('is off while searching, in the site view, or with the setting off', () => {
    applyFilters(grouped({ searchTerm: 'a.test' }));
    expect(state.groups).toBe(null);
    state.siteHost = 'a.test';
    applyFilters(grouped());
    expect(state.groups).toBe(null);
    state.siteHost = '';
    applyFilters(grouped({ groupBySite: false }));
    expect(state.groups).toBe(null);
  });
});

describe('moveSelectionByRects', () => {
  // Two groups side by side, then one below:
  //   [0][1]   [2]
  //   [3]
  //   [4][5]
  const box = (left, top) => ({ left, top, width: 100, height: 80 });
  const rects = [box(0, 0), box(110, 0), box(300, 0), box(0, 90), box(0, 200), box(110, 200)];
  beforeEach(() => {
    state.filteredTabs = rects.map((_, i) => makeTab(i + 1));
  });
  const move = (from, key) => {
    state.selectedIndex = from;
    moveSelectionByRects(key, rects);
    return state.selectedIndex;
  };

  it('steps through the order with left and right', () => {
    expect(move(2, 'ArrowRight')).toBe(3);
    expect(move(3, 'ArrowLeft')).toBe(2);
  });

  it('goes to the tile straight below or above, before one off to the side', () => {
    expect(move(1, 'ArrowDown')).toBe(5); // nothing right under 1 until the third row
    expect(move(0, 'ArrowDown')).toBe(3);
    expect(move(3, 'ArrowDown')).toBe(4);
    expect(move(5, 'ArrowUp')).toBe(1);
    expect(move(2, 'ArrowDown')).toBe(3); // nothing straight below: the nearest row
  });

  it('stays put at the edge, and starts at an end with nothing selected', () => {
    expect(move(0, 'ArrowUp')).toBe(0);
    expect(move(-1, 'ArrowDown')).toBe(0);
    expect(move(-1, 'ArrowUp')).toBe(5);
  });
});
