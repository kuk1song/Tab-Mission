// events.js
import { state, applyFilters, fetchAllTabs } from './state.js';
import { render, updateSelection } from './dom.js';
import { startThumbnailCapture } from './thumbnail.js';
import { applyArtLayout } from './layout.js';

export function initializeEventListeners() {
  const searchEl = document.getElementById('search');
  const toggleHideDiscarded = document.getElementById('toggle-hide-discarded');
  const toggleCurrentWindow = document.getElementById('toggle-current-window');
  const toggleArt = document.getElementById('toggle-art');

  if (searchEl) searchEl.addEventListener('input', handleFilterChange);
  if (toggleHideDiscarded) toggleHideDiscarded.addEventListener('change', handleFilterChange);
  if (toggleCurrentWindow) toggleCurrentWindow.addEventListener('change', handleFilterChange);
  if (toggleArt) toggleArt.addEventListener('change', applyArtLayout);
  
  window.addEventListener('keydown', handleKeydown);
  document.body.addEventListener('click', (e) => {
    // This part of the original code was not in the edit specification,
    // so it is not included in the new_code.
  });
  window.addEventListener('beforeunload', () => {
    document.getElementById('root').classList.add('closing');
  });
}

function handleFilterChange() {
  const searchEl = document.getElementById('search');
  const toggleHideDiscarded = document.getElementById('toggle-hide-discarded');
  const toggleCurrentWindow = document.getElementById('toggle-current-window');

  const uiState = {
    searchTerm: searchEl ? searchEl.value : '',
    showSleeping: toggleHideDiscarded ? toggleHideDiscarded.checked : false,
    showAllWindows: toggleCurrentWindow ? toggleCurrentWindow.checked : false,
  };
  applyFilters(uiState);
  render();
  // Always start thumbnail capture after filtering
  requestAnimationFrame(() => {
    startThumbnailCapture();
  });
}

function getColumnCount() {
  const gridEl = document.getElementById('grid');
  const style = getComputedStyle(gridEl);
  const columns = style.gridTemplateColumns.split(' ').length;
  return Math.max(1, columns);
}

export function activateTab(tab) {
  const gridEl = document.getElementById('grid');
  const tile = gridEl.querySelector(`.tile[data-tab-id="${tab.id}"]`);
  if (tile) {
    tile.classList.add('activating');
  }

  setTimeout(() => {
    chrome.tabs.update(tab.id, { active: true });
    chrome.windows.update(tab.windowId, { focused: true });
    closeOverview();
  }, 120);
}

function handleKeydown(e) {
  switch (e.key) {
    case 'Escape':
      closeOverview();
      break;
    case 'Enter':
      if (state.filteredTabs[state.selectedIndex]) {
        activateTab(state.filteredTabs[state.selectedIndex]);
      }
      break;
    case 'ArrowUp':
      e.preventDefault();
      state.selectedIndex = Math.max(0, state.selectedIndex - getColumnCount());
      updateSelection();
      break;
    case 'ArrowDown':
      e.preventDefault();
      state.selectedIndex = Math.min(state.filteredTabs.length - 1, state.selectedIndex + getColumnCount());
      updateSelection();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      state.selectedIndex = Math.max(0, state.selectedIndex - 1);
      updateSelection();
      break;
    case 'ArrowRight':
      e.preventDefault();
      state.selectedIndex = Math.min(state.filteredTabs.length - 1, state.selectedIndex + 1);
      updateSelection();
      break;
  }
}

function closeOverview() {
  document.body.classList.add('closing');
  setTimeout(() => {
    window.close();
  }, 180);
}
