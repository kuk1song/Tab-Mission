import { describe, it, expect, beforeEach } from 'vitest';
import { state, applyFilters, moveSelection, moveSelectionByRects, countSiteTabs, RECENT_COUNT } from '../extension/src/state.js';

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

  it('leaves the order alone when the current tab is not listed', () => {
    state.currentTabId = 99;
    state.allTabs = [makeTab(1, { lastAccessed: 2 }), makeTab(2, { lastAccessed: 1 })];
    applyFilters(ui());
    expect(state.filteredTabs.map((t) => t.id)).toEqual([1, 2]);
  });

  it('does not auto-select on open — nothing is highlighted until hover/arrow', () => {
    state.selectedIndex = -1; // a freshly opened overview
    state.allTabs = [makeTab(1, { lastAccessed: 1 }), makeTab(2, { lastAccessed: 2 })];
    applyFilters(ui());
    expect(state.selectedIndex).toBe(-1);
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
    expect(state.selectedIndex).not.toBe(-1);
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
  // current tab), 3, 2, 6, 7, 5, 4, 1.
  const strip = [
    ['https://a.test/1', 1], ['https://b.test/1', 6], ['https://a.test/2', 7], ['https://c.test/1', 2],
    ['https://b.test/2', 3], ['https://a.test/3', 5], ['https://d.test/1', 4], ['https://c.test/2', 8],
  ];
  const ids = (list) => list.map((tab) => tab.id);
  beforeEach(() => {
    state.allTabs = strip.map(([url, lastAccessed], i) => makeTab(i + 1, { url, index: i, lastAccessed }));
    state.currentTabId = 8;
  });

  it('puts the recent tabs first, then each site\'s tabs in tab-bar order', () => {
    applyFilters(ui({ groupBySite: true, preselectPrevious: true }));
    expect(state.groups.map(({ recent, host, count }) => [Boolean(recent), host, count])).toEqual([
      [true, '', RECENT_COUNT], [false, 'a.test', 3], [false, 'b.test', 2], [false, 'c.test', 2], [false, 'd.test', 1],
    ]);
    // Recent: the previous tab first, the current tab second.
    expect(ids(state.filteredTabs.slice(0, RECENT_COUNT))).toEqual([3, 8, 2, 6, 7]);
    expect(ids(state.filteredTabs.slice(RECENT_COUNT))).toEqual([1, 3, 6, 2, 5, 4, 8, 7]);
    expect(state.filteredTabs[state.selectedIndex].id).toBe(3);
  });

  it('keeps the site groups where they are when you switch tabs', () => {
    applyFilters(ui({ groupBySite: true }));
    const before = ids(state.filteredTabs.slice(RECENT_COUNT));
    state.allTabs.find((tab) => tab.id === 7).lastAccessed = 100; // switched to d.test
    state.currentTabId = 7;
    applyFilters(ui({ groupBySite: true }));
    expect(ids(state.filteredTabs.slice(RECENT_COUNT))).toEqual(before);
    expect(state.filteredTabs[0].id).toBe(8); // the previous tab now
  });

  it('orders windows by when they were opened, and tabs by position', () => {
    state.allTabs = [
      makeTab(1, { windowId: 2, index: 0, url: 'https://late.test/' }),
      makeTab(2, { windowId: 1, index: 1, url: 'https://second.test/' }),
      makeTab(3, { windowId: 1, index: 0, url: 'https://first.test/' }),
      ...[4, 5, 6, 7].map((id) => makeTab(id, { windowId: 1, index: id, url: `https://n${id}.test/` })),
    ];
    applyFilters(ui({ groupBySite: true, showAllWindows: true }));
    expect(state.groups.slice(1, 3).map((g) => g.host)).toEqual(['first.test', 'second.test']);
    expect(state.groups.at(-1).host).toBe('late.test');
  });

  it('gives tabs without a site a group of their own, after the recent one', () => {
    state.allTabs.push(makeTab(9, { url: 'about:blank', index: 8, lastAccessed: 0 }));
    applyFilters(ui({ groupBySite: true }));
    expect(state.groups.filter((g) => g.recent)).toEqual([expect.objectContaining({ start: 0 })]);
    expect(state.groups.at(-1)).toEqual({ host: '', start: RECENT_COUNT + 8, count: 1 });
  });

  it('is off while searching, in the site view, with few tabs, or with the setting off', () => {
    applyFilters(ui({ groupBySite: true, searchTerm: 'a.test' }));
    expect(state.groups).toBe(null);
    state.siteHost = 'a.test';
    applyFilters(ui({ groupBySite: true }));
    expect(state.groups).toBe(null);
    state.siteHost = '';
    applyFilters(ui({ groupBySite: false }));
    expect(state.groups).toBe(null);
    state.allTabs = state.allTabs.slice(0, RECENT_COUNT);
    applyFilters(ui({ groupBySite: true }));
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
