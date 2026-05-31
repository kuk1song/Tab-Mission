import { describe, it, expect, beforeEach } from 'vitest';
import { state, applyFilters } from '../extension/src/state.js';

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
  state.currentWindowId = 1;
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
