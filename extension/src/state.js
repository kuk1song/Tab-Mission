// state.js
import { getHostname, isSleeping } from './utils.js';

export const state = {
  allTabs: [],
  filteredTabs: [],
  selectedIndex: -1, // -1 means no selection
  defaultIndex: -1, // where the selection rests when nothing is hovered
  currentWindowId: null,
  currentTabId: null,
  selfWindowId: null, // the overview popup itself; its own tab is never listed
  siteHost: '', // non-empty while showing only one site's tabs
  preselectPrevious: false, // mirrors the setting of the same name
};

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
  // which is the reason this extension exists. lastAccessed is present on
  // every tab, so no extra permission is needed.
  tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));

  // The current tab goes second: the first, most prominent slot is for the
  // tab you most likely want (the previous one), while the current tab stays
  // beside it for orientation. Chrome's Tab Search goes further and moves the
  // visible tab to the bottom ("not likely users want to click on it").
  if (tabs.length > 1 && tabs[0].id === state.currentTabId) {
    [tabs[0], tabs[1]] = [tabs[1], tabs[0]];
  }

  state.filteredTabs = tabs;

  // A search pre-selects its best match so Enter switches straight away: the
  // most recent match that is not the tab you are already on (Chrome's Tab
  // Search makes the same choice). The plain browse view keeps nothing
  // selected, so pressing the shortcut again still closes the overview; an
  // automatic selection left over from an erased query is dropped too.
  const selectionWasAutomatic = state.selectedIndex === state.defaultIndex;
  // With the preselectPrevious setting the browse view rests on the previous
  // tab as well, so the shortcut pressed twice goes back to it.
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
