import { describe, it, expect, beforeEach } from 'vitest';
import { state, applyFilters, moveSelection } from '../extension/src/state.js';

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

  it('keeps the current tab first (pure MRU — it is the most recently accessed)', () => {
    state.allTabs = [
      makeTab(1, { lastAccessed: 500, active: true }), // current tab — most recent
      makeTab(2, { lastAccessed: 300 }),
      makeTab(3, { lastAccessed: 400 }),
    ];
    applyFilters(ui());
    expect(state.filteredTabs.map((t) => t.id)).toEqual([1, 3, 2]);
    expect(state.filteredTabs[0].id).toBe(1); // current tab heads the list
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
      makeTab(1, { lastAccessed: 600, active: true, windowId: 1 }), // focused current — most recent
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
    expect(state.filteredTabs.map((t) => t.id)).toEqual([1, 2, 3]);
    expect(state.selectedIndex).toBe(1);
    expect(state.defaultIndex).toBe(1);
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
  it('lists every tab of the site across windows, sleeping ones included', () => {
    state.siteHost = 'docs.google.com';
    state.allTabs = [
      makeTab(1, { url: 'https://docs.google.com/a', windowId: 1, lastAccessed: 4 }),
      makeTab(2, { url: 'https://docs.google.com/b', windowId: 2, lastAccessed: 3 }),
      makeTab(3, { url: 'https://docs.google.com/c', discarded: true, lastAccessed: 2 }),
      makeTab(4, { url: 'https://mail.google.com/', lastAccessed: 5 }),
    ];
    applyFilters(ui());
    expect(state.filteredTabs.map((t) => t.id)).toEqual([1, 2, 3]);
    expect(state.selectedIndex).toBe(-1); // no query, so nothing pre-selected
  });
});

describe('moveSelection', () => {
  beforeEach(() => {
    state.currentTabId = 1;
    state.allTabs = [1, 2, 3, 4, 5].map((id) => makeTab(id, { lastAccessed: 10 - id }));
    applyFilters(ui());
  });

  it('starts from the current tab, so → reaches the previous tab first', () => {
    moveSelection('ArrowRight', 3);
    expect(state.filteredTabs[state.selectedIndex].id).toBe(2);
  });

  it('moves by a full row with ↓ and clamps at both ends', () => {
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
