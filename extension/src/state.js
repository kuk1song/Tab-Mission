// state.js

export const state = {
  allTabs: [],
  filteredTabs: [],
  selectedIndex: 0,
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
  
  if (uiState.hideDiscarded) {
    tabs = tabs.filter(tab => !tab.discarded);
  }
  
  const query = uiState.searchTerm.toLowerCase().trim();
  if (query) {
    tabs = tabs.filter(tab => 
      (tab.title || '').toLowerCase().includes(query) ||
      (tab.url || '').toLowerCase().includes(query)
    );
  }
  
  state.filteredTabs = tabs;
  state.selectedIndex = Math.min(state.selectedIndex, Math.max(0, state.filteredTabs.length - 1));
}
