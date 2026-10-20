// state.js
import { getHostname, isSleeping } from './utils.js';

export const state = {
  allTabs: [],
  filteredTabs: [],
  selectedIndex: -1, // -1 means no selection
  defaultIndex: -1, // the automatic selection, until the pointer or a key moves it
  currentWindowId: null,
  currentTabId: null,
  selfWindowId: null, // the overview popup itself; its own tab is never listed
  siteHost: '', // non-empty while showing only one site's tabs
  preselectPrevious: true, // mirrors the setting of the same name
  groupBySite: false, // mirrors the setting of the same name
  // With groupBySite, while browsing: the parts of filteredTabs, in order
  // ({ host, start, count }, the first one the recent tabs), else null.
  groups: null,
};

// Group by site: the recent tabs first (one row, at most this many), then
// every tab again under its site.
export const RECENT_MAX = 5;

export async function fetchAllTabs() {
  try {
    state.allTabs = await chrome.tabs.query({});
    const current = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    state.currentWindowId = current?.id || null;
  } catch (err) {
    console.warn('Failed to fetch tabs:', err);
    state.allTabs = [];
    state.currentWindowId = null;
  }
  try {
    const self = await chrome.windows.getCurrent();
    state.selfWindowId = self?.id ?? null;
  } catch {
    state.selfWindowId = null;
  }
  const currentTab = state.allTabs.find((tab) => tab.windowId === state.currentWindowId && tab.active);
  state.currentTabId = currentTab?.id ?? null;
}

// Hostname of the tab the user was on when the overview opened.
export function currentSiteHost() {
  const currentTab = state.allTabs.find((tab) => tab.id === state.currentTabId);
  return currentTab ? getHostname(currentTab.url) : '';
}

// The view toggles: by default only the current window and no sleeping tabs.
function applyViewToggles(tabs, uiState) {
  let result = tabs;
  if (!uiState.showAllWindows && state.currentWindowId) {
    result = result.filter((tab) => tab.windowId === state.currentWindowId);
  }
  if (!uiState.showSleeping) {
    result = result.filter((tab) => !isSleeping(tab));
  }
  return result;
}

function listableTabs() {
  return state.allTabs.filter((tab) => tab.windowId !== state.selfWindowId);
}

// How many tabs the site view would show for a host under the current toggles.
export function countSiteTabs(host, uiState) {
  if (!host) return 0;
  return applyViewToggles(listableTabs().filter((tab) => getHostname(tab.url) === host), uiState).length;
}

export function applyFilters(uiState) {
  const terms = uiState.searchTerm.toLowerCase().split(/\s+/).filter(Boolean);
  const searching = terms.length > 0;

  let tabs = listableTabs();

  if (state.siteHost) {
    tabs = tabs.filter((tab) => getHostname(tab.url) === state.siteHost);
  }

  // Typing means "find that tab wherever it is", so a query ignores the
  // window and sleeping toggles. Browsing, including the site view, follows
  // them, so what the checkboxes say is what the grid shows.
  if (searching) {
    // Every word must appear in the title or URL, so "git mission" finds
    // "GitHub - Tab-Mission".
    tabs = tabs.filter((tab) => {
      const haystack = `${tab.title || ''} ${tab.url || ''}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  } else {
    tabs = applyViewToggles(tabs, uiState);
  }

  // Order by most-recently-used (descending lastAccessed), as OS task
  // switchers do; Chrome's own Ctrl+Tab walks the static tab-strip order,
  // which is the reason this extension exists. lastAccessed is on every tab
  // since Chrome 121 (the manifest's minimum) and needs no extra permission.
  tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));

  // The current tab goes second: the first, most prominent slot is for the
  // tab you most likely want (the previous one), while the current tab stays
  // beside it for orientation. Chrome's Tab Search goes further and moves the
  // visible tab to the bottom ("not likely users want to click on it").
  if (tabs.length > 1 && tabs[0].id === state.currentTabId) {
    [tabs[0], tabs[1]] = [tabs[1], tabs[0]];
  }

  // Grouped by site (browsing only, once the tabs fill more than two rows;
  // fewer fit on screen anyway, and most would show twice): the most recent
  // tabs stay first, one row of them, so the previous tab keeps the first
  // slot; then all tabs again by site in tab-strip order, which switching
  // tabs does not change. Nothing is stored. uiState.columns is how many
  // tiles fit in a row.
  state.groups = null;
  const recentCount = Math.max(1, Math.min(RECENT_MAX, uiState.columns || RECENT_MAX));
  if (uiState.groupBySite && !searching && !state.siteHost && tabs.length > 2 * recentCount) {
    const { entries, groups } = groupBySite(tabs, recentCount);
    tabs = entries;
    state.groups = groups;
  }

  state.filteredTabs = tabs;

  // A search pre-selects its best match so Enter switches straight away: the
  // most recent match that is not the tab you are already on (Chrome's Tab
  // Search makes the same choice). Without a query the previous tab is
  // pre-selected (preselectPrevious, on by default), so the shortcut pressed
  // twice goes back to it; with the setting off nothing is selected, a second
  // press closes the overview, and an automatic selection left over from an
  // erased query is dropped.
  const selectionWasAutomatic = state.selectedIndex === state.defaultIndex;
  const preselect = searching || Boolean(uiState.preselectPrevious);
  state.defaultIndex = preselect ? firstOtherIndex(tabs) : -1;
  if (preselect && (searching || selectionWasAutomatic)) {
    state.selectedIndex = state.defaultIndex;
  } else if (selectionWasAutomatic) {
    state.selectedIndex = -1;
  } else {
    state.selectedIndex = Math.min(state.selectedIndex, tabs.length - 1);
  }
}

// tabs in recent order. Sites follow the tab strip: windows in the order they
// were opened (by id), tabs by position, a site where its first tab is;
// within a site, its tabs by position.
export function groupBySite(tabs, recentCount = RECENT_MAX) {
  const recent = tabs.slice(0, recentCount);
  const strip = [...tabs].sort((a, b) => a.windowId - b.windowId || a.index - b.index);
  const sites = new Map();
  for (const tab of strip) {
    const host = getHostname(tab.url);
    if (!sites.has(host)) sites.set(host, []);
    sites.get(host).push(tab);
  }
  const groups = [{ recent: true, host: '', start: 0, count: recent.length }];
  const entries = [...recent];
  for (const [host, siteTabs] of sites) {
    groups.push({ host, start: entries.length, count: siteTabs.length });
    entries.push(...siteTabs);
  }
  return { entries, groups };
}

function firstOtherIndex(tabs) {
  if (tabs.length === 0) return -1;
  const index = tabs.findIndex((tab) => tab.id !== state.currentTabId);
  return index === -1 ? 0 : index;
}

// Arrow-key movement through the grid. With nothing selected, → and ↓ start
// at the first tile (the tab you most likely want) and ← and ↑ at the last.
export function moveSelection(key, columns) {
  const last = state.filteredTabs.length - 1;
  if (last < 0) return;
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[key];
  if (!step) return;
  if (state.selectedIndex === -1) {
    state.selectedIndex = step > 0 ? 0 : last;
    return;
  }
  state.selectedIndex = Math.min(last, Math.max(0, state.selectedIndex + step));
}

// Arrow keys when tiles do not sit in one grid (grouped by site): ← and →
// step through the order; ↑ and ↓ go to the nearest tile above or below,
// preferring one straight above or below (overlapping columns) over one off
// to the side, then the nearest row, then the nearest column. rects are the
// tiles' boxes ({ left, top, width, height }) in the order of filteredTabs.
export function moveSelectionByRects(key, rects) {
  if (key === 'ArrowLeft' || key === 'ArrowRight' || state.selectedIndex === -1) {
    moveSelection(key, 1);
    return;
  }
  const from = rects[state.selectedIndex];
  if (!from) return;
  const down = key === 'ArrowDown';
  const middle = from.top + from.height / 2;
  const center = from.left + from.width / 2;
  let best = null;
  rects.forEach((r, index) => {
    // Whole pixels, so subpixel layout never splits a row.
    const dy = Math.round(down ? r.top - middle : middle - (r.top + r.height));
    if (dy <= 0) return;
    const candidate = {
      index,
      aside: r.left >= from.left + from.width || r.left + r.width <= from.left ? 1 : 0,
      dy,
      dx: Math.abs(r.left + r.width / 2 - center),
    };
    if (!best || compare(candidate, best) < 0) best = candidate;
  });
  if (best) state.selectedIndex = best.index;
}

function compare(a, b) {
  return a.aside - b.aside || a.dy - b.dy || a.dx - b.dx;
}
