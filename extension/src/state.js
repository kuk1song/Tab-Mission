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
  
  state.filteredTabs = tabs;
  // If there was a selection, try to keep it. Otherwise, no selection.
  state.selectedIndex = Math.min(state.selectedIndex, Math.max(-1, state.filteredTabs.length - 1));
  if (state.filteredTabs.length > 0 && state.selectedIndex === -1) {
    // If we previously had no selection and now we have tabs, we still want no selection by default.
    // However, if arrow keys are used, it should start from 0.
  } else if (state.filteredTabs.length === 0) {
    state.selectedIndex = -1;
  }
}
