// events.js
import { state, applyFilters, fetchAllTabs } from './state.js';
import { render, updateSelection } from './dom.js';
import { startThumbnailCapture } from './thumbnail.js';
import { applyArtLayout } from './layout.js';

const searchEl = document.getElementById('search');
const toggleHideDiscarded = document.getElementById('toggle-hide-discarded');
const toggleCurrentWindow = document.getElementById('toggle-current-window');
const toggleThumbnails = document.getElementById('toggle-thumbnails');
const toggleArt = document.getElementById('toggle-art');

export function initializeEventListeners() {
  searchEl.addEventListener('input', handleFilterChange);
  toggleHideDiscarded.addEventListener('change', handleFilterChange);
  toggleThumbnails.addEventListener('change', handleThumbnailToggle);
  toggleArt.addEventListener('change', applyArtLayout);
  
  toggleCurrentWindow.addEventListener('change', async () => {
    await fetchAllTabs();
    handleFilterChange();
  });

  document.addEventListener('keydown', handleKeydown);
  window.addEventListener('beforeunload', () => {
    document.getElementById('root').classList.add('closing');
  });
}

function handleFilterChange() {
  const uiState = {
    searchTerm: searchEl.value,
    hideDiscarded: toggleHideDiscarded.checked,
    showAllWindows: toggleCurrentWindow.checked, // Renamed for clarity
  };
  applyFilters(uiState);
  render();
  requestAnimationFrame(() => {
    if (toggleThumbnails.checked) {
      startThumbnailCapture();
    }
  });
}

function handleThumbnailToggle() {
  render();
  if (toggleThumbnails.checked) {
    requestAnimationFrame(startThumbnailCapture);
  }
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
