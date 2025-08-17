// events.js
import { state, applyFilters, fetchAllTabs } from './state.js';
import { render, updateSelection } from './dom.js';
import { startThumbnailCapture } from './thumbnail.js';
import { applyArtLayout } from './layout.js';
import { saveSettings } from './settings.js';

export function initializeEventListeners() {
  const searchEl = document.getElementById('search');
  const toggleHideDiscarded = document.getElementById('toggle-hide-discarded');
  const toggleCurrentWindow = document.getElementById('toggle-current-window');
  const toggleArt = document.getElementById('toggle-art');
  const shortcutHint = document.getElementById('shortcut-hint');
  const resetBtn = document.getElementById('reset-window');

  if (searchEl) searchEl.addEventListener('input', handleFilterChange);
  if (toggleHideDiscarded) toggleHideDiscarded.addEventListener('change', handleFilterChange);
  if (toggleCurrentWindow) toggleCurrentWindow.addEventListener('change', handleFilterChange);
  if (toggleArt) toggleArt.addEventListener('change', () => {
    applyArtLayout();
    persistSettings();
  });

  if (shortcutHint) {
    shortcutHint.addEventListener('click', (e) => {
      const target = e.target.closest('a[data-shortcuts]');
      if (target) {
        e.preventDefault();
        const url = target.getAttribute('data-shortcuts') || 'chrome://extensions/shortcuts';
        chrome.tabs.create({ url });
      }
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      try {
        await chrome.runtime.sendMessage({ action: 'resetWindowBounds' });
      } catch {}
    });
  }
  
  window.addEventListener('keydown', handleKeydown);
  document.body.addEventListener('click', (e) => {
    // This part of the original code was not in the edit specification,
    // so it is not included in the new_code.
  });
  window.addEventListener('beforeunload', () => {
    document.getElementById('root').classList.add('closing');
  });

  // Listen for messages from the background script (e.g., from the shortcut)
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'handleShortcut') {
      if (state.selectedIndex !== -1 && state.filteredTabs[state.selectedIndex]) {
        // If a tab is selected, activate it
        activateTab(state.filteredTabs[state.selectedIndex]);
      } else {
        // If no tab is selected, just close the overview
        closeOverview();
      }
    }
  });
}

function handleFilterChange() {
  const searchEl = document.getElementById('search');
  const toggleHideDiscarded = document.getElementById('toggle-hide-discarded');
  const toggleCurrentWindow = document.getElementById('toggle-current-window');
  const toggleArt = document.getElementById('toggle-art');

  const uiState = {
    searchTerm: searchEl ? searchEl.value : '',
    showSleeping: toggleHideDiscarded ? toggleHideDiscarded.checked : false,
    showAllWindows: toggleCurrentWindow ? toggleCurrentWindow.checked : false,
    artMode: toggleArt ? toggleArt.checked : false,
  };
  applyFilters(uiState);
  render();

  // Save the latest state of the filters
  saveSettings(uiState);

  // Always start thumbnail capture after filtering
  requestAnimationFrame(() => {
    startThumbnailCapture();
  });
}

function persistSettings() {
  const searchEl = document.getElementById('search');
  const toggleHideDiscarded = document.getElementById('toggle-hide-discarded');
  const toggleCurrentWindow = document.getElementById('toggle-current-window');
  const toggleArt = document.getElementById('toggle-art');

  const uiState = {
    searchTerm: searchEl ? searchEl.value : '',
    showSleeping: toggleHideDiscarded ? toggleHideDiscarded.checked : false,
    showAllWindows: toggleCurrentWindow ? toggleCurrentWindow.checked : false,
    artMode: toggleArt ? toggleArt.checked : false,
  };
  saveSettings(uiState);
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

  // To achieve a "SOTA" silky smooth transition, we remove the timeout.
  // The tab switch is initiated instantly, and the closing animation runs in parallel.
  chrome.tabs.update(tab.id, { active: true });
  chrome.windows.update(tab.windowId, { focused: true });
  closeOverview(true); // Pass true for a fast close
}

function handleKeydown(e) {
  switch (e.key) {
    case 'Escape':
      closeOverview();
      break;
    case 'Enter':
      if (state.selectedIndex !== -1 && state.filteredTabs[state.selectedIndex]) {
        activateTab(state.filteredTabs[state.selectedIndex]);
      }
      break;
    case 'ArrowUp':
      e.preventDefault();
      if (state.selectedIndex === -1) {
        state.selectedIndex = state.filteredTabs.length - 1;
      } else {
        state.selectedIndex = Math.max(0, state.selectedIndex - getColumnCount());
      }
      updateSelection();
      break;
    case 'ArrowDown':
      e.preventDefault();
      if (state.selectedIndex === -1) {
        state.selectedIndex = 0;
      } else {
        state.selectedIndex = Math.min(state.filteredTabs.length - 1, state.selectedIndex + getColumnCount());
      }
      updateSelection();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      if (state.selectedIndex === -1) {
        state.selectedIndex = state.filteredTabs.length - 1;
      } else {
        state.selectedIndex = Math.max(0, state.selectedIndex - 1);
      }
      updateSelection();
      break;
    case 'ArrowRight':
      e.preventDefault();
      if (state.selectedIndex === -1) {
        state.selectedIndex = 0;
      } else {
        state.selectedIndex = Math.min(state.filteredTabs.length - 1, state.selectedIndex + 1);
      }
      updateSelection();
      break;
  }
}

function closeOverview(fast = false) {
  const rootEl = document.getElementById('root');

  if (fast) {
    if (rootEl) {
      rootEl.classList.add('closing-fast');
    } else {
      document.body.classList.add('closing-fast');
    }
    setTimeout(() => window.close(), 150);
    return;
  }

  const gridEl = document.getElementById('grid');
  let totalTiles = 0;
  if (gridEl) {
    const tiles = Array.from(gridEl.querySelectorAll('.tile'));
    totalTiles = tiles.length;
    tiles.forEach((tile, index) => {
      // Reverse index so the last tile starts first
      const reverseIndex = totalTiles - 1 - index;
      // Match the opening stagger pattern (batches of 10, 20ms each)
      const staggerDelay = (reverseIndex % 10) * 20;
      tile.style.setProperty('--stagger-out', `${staggerDelay}ms`);
    });
  }

  if (rootEl) {
    rootEl.classList.add('closing');
  } else {
    document.body.classList.add('closing');
  }

  // Compute a close delay that matches animation duration + max stagger + small margin
  const animationDurationMs = 320; // must match CSS fadeOutUp duration
  const maxStaggerSteps = Math.min(Math.max(totalTiles - 1, 0), 9); // 0..9
  const maxStaggerMs = maxStaggerSteps * 20;
  const safetyMarginMs = 120;
  const closeDelayMs = animationDurationMs + maxStaggerMs + safetyMarginMs; // 320.. (max 320+180+120=620)

  setTimeout(() => {
    window.close();
  }, closeDelayMs);
}
