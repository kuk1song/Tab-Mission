// state.js

export const state = {
  allTabs: [],
  filteredTabs: [],
  selectedIndex: -1, // -1 means no selection
  currentWindowId: null,
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
}

export function applyFilters(uiState) {
  let tabs = [...state.allTabs];
  
  // The logic is now inverted. By default, we show the current window.
  // If the checkbox is checked, we show all windows.
  if (!uiState.showAllWindows && state.currentWindowId) {
    tabs = tabs.filter(tab => tab.windowId === state.currentWindowId);
  }
  
  // Logic is inverted: by default, we hide sleeping tabs.
  // If the checkbox is checked, we show them.
  if (!uiState.showSleeping) {
    tabs = tabs.filter(tab => !tab.discarded && tab.status !== 'unloaded');
  }
  
  const query = uiState.searchTerm.toLowerCase().trim();
  if (query) {
    tabs = tabs.filter(tab => 
      (tab.title || '').toLowerCase().includes(query) ||
      (tab.url || '').toLowerCase().includes(query)
    );
  }
  
  // Order by most-recently-used (descending lastAccessed). This is how every
  // OS task switcher (Alt+Tab / Cmd+Tab) behaves and is the whole reason this
  // extension exists — Chrome's own Ctrl+Tab walks the static tab-strip order.
  // lastAccessed is present on every tab, so no extra permission is needed.
  tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));

  // The current tab is always the most-recently-accessed, but it's the one the
  // user is already on. Move it to the end so the first tile is the *previous*
  // tab — the most likely switch target sits first for hovering/scanning.
  const activeIndex = tabs.findIndex(
    tab => tab.active && tab.windowId === state.currentWindowId
  );
  if (activeIndex !== -1) {
    const [activeTab] = tabs.splice(activeIndex, 1);
    tabs.push(activeTab);
  }

  state.filteredTabs = tabs;

  // No auto-selection on open: -1 means nothing is highlighted until the user
  // hovers a tile or presses an arrow key. With no selection, pressing the
  // shortcut again closes the overview (rather than switching). A stale
  // selection from a previous filter is clamped back into range.
  state.selectedIndex = Math.min(state.selectedIndex, state.filteredTabs.length - 1);
}
