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

export function applyFilters(uiState) {
  const terms = uiState.searchTerm.toLowerCase().split(/\s+/).filter(Boolean);
  const searching = terms.length > 0;
  // Searching, or the site view, means "find that tab wherever it is": the
  // window and sleeping toggles only shape the plain browse view and must
  // never hide a match.
  const findEverywhere = searching || Boolean(state.siteHost);

  let tabs = state.allTabs.filter((tab) => tab.windowId !== state.selfWindowId);

  if (state.siteHost) {
    tabs = tabs.filter((tab) => getHostname(tab.url) === state.siteHost);
  }

  // By default only the current window is shown; the checkbox shows all.
  if (!findEverywhere && !uiState.showAllWindows && state.currentWindowId) {
    tabs = tabs.filter((tab) => tab.windowId === state.currentWindowId);
  }

  // By default sleeping tabs are hidden; the checkbox shows them.
  if (!findEverywhere && !uiState.showSleeping) {
    tabs = tabs.filter((tab) => !isSleeping(tab));
  }

  // Every word must appear in the title or URL, so "git mission" finds
  // "GitHub - Tab-Mission".
  if (searching) {
    tabs = tabs.filter((tab) => {
      const haystack = `${tab.title || ''} ${tab.url || ''}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }

  // Order by most-recently-used (descending lastAccessed). This is how every OS
  // task switcher (Alt+Tab / Cmd+Tab) behaves, and is the whole reason this
  // extension exists — Chrome's own Ctrl+Tab walks the static tab-strip order.
  // The current tab is the most recently accessed, so it naturally sorts first,
  // matching those switchers (the current item heads the list). lastAccessed is
  // present on every tab, so no extra permission is needed.
  tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));

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

// Arrow-key movement through the grid. With nothing selected the cursor starts
// on the current tab (it heads the MRU list), so the first → lands on the
// previous tab, like the second press of Alt+Tab.
export function moveSelection(key, columns) {
  const last = state.filteredTabs.length - 1;
  if (last < 0) return;
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[key];
  if (!step) return;

  let from = state.selectedIndex;
  if (from === -1) {
    from = state.filteredTabs.findIndex((tab) => tab.id === state.currentTabId);
  }
  if (from === -1) {
    state.selectedIndex = step > 0 ? 0 : last;
    return;
  }
  state.selectedIndex = Math.min(last, Math.max(0, from + step));
}
