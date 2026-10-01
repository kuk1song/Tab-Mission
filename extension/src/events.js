// events.js
import { state, applyFilters, moveSelection, currentSiteHost } from './state.js';
import { render, updateSelection, initializeGridListeners, forgetTile } from './dom.js';
import { applyArtLayout } from './layout.js';
import { saveSettings } from './settings.js';
import { t } from './i18n.js';

// Filtering is cheap now that tiles are reused, so the search runs once per
// animation frame instead of after a 200ms debounce. Enter flushes a pending
// run first, so typing a query and pressing Enter at once never acts on a
// stale selection.
let filterFrame = 0;

function scheduleFilterChange() {
  if (filterFrame) return;
  filterFrame = requestAnimationFrame(() => {
    filterFrame = 0;
    handleFilterChange();
  });
}

function flushFilterChange() {
  if (!filterFrame) return;
  cancelAnimationFrame(filterFrame);
  filterFrame = 0;
  handleFilterChange();
}

export function initializeEventListeners() {
  const searchEl = document.getElementById('search');
  const toggleHideDiscarded = document.getElementById('toggle-hide-discarded');
  const toggleCurrentWindow = document.getElementById('toggle-current-window');
  const toggleArt = document.getElementById('toggle-art');
  const resetBtn = document.getElementById('reset-window');
  const openShortcutsBtn = document.getElementById('open-shortcuts');
  const scopeClearBtn = document.getElementById('scope-clear');

  if (searchEl) searchEl.addEventListener('input', scheduleFilterChange);
  // After a checkbox click, hand focus back to the search box so typing works.
  for (const toggle of [toggleHideDiscarded, toggleCurrentWindow]) {
    if (!toggle) continue;
    toggle.addEventListener('change', () => {
      handleFilterChange();
      searchEl?.focus();
    });
  }
  if (toggleArt) toggleArt.addEventListener('change', () => {
    applyArtLayout();
    // Persist the artMode setting directly
    handleFilterChange();
  });

  if (openShortcutsBtn) {
    openShortcutsBtn.addEventListener('click', () => {
      try {
        chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
      } finally {
        // Immediately close the overview for a smooth UX
        closeOverview(true);
      }
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      try {
        await chrome.runtime.sendMessage({ action: 'resetWindowBounds' });
      } catch {}
      searchEl?.focus();
    });
  }

  if (scopeClearBtn) {
    scopeClearBtn.addEventListener('click', () => setSiteScope(false));
  }

  initializeGridListeners();

  window.addEventListener('keydown', handleKeydown);
  window.addEventListener('beforeunload', () => {
    document.getElementById('root').classList.add('closing');
  });

  // Listen for messages from the background script (e.g., from the shortcut)
  chrome.runtime.onMessage.addListener((request) => {
    if (request?.action !== 'handleShortcut') return;
    // The other shortcut switches views in place instead of closing.
    const wantSite = request.scope === 'site';
    if (wantSite !== Boolean(state.siteHost)) {
      setSiteScope(wantSite);
      return;
    }
    flushFilterChange();
    if (state.selectedIndex !== -1 && state.filteredTabs[state.selectedIndex]) {
      // If a tab is selected, activate it
      activateTab(state.filteredTabs[state.selectedIndex]);
    } else {
      // If no tab is selected, just close the overview
      closeOverview();
    }
  });
}

function readUiState() {
  const searchEl = document.getElementById('search');
  const toggleHideDiscarded = document.getElementById('toggle-hide-discarded');
  const toggleCurrentWindow = document.getElementById('toggle-current-window');
  const toggleArt = document.getElementById('toggle-art');
  return {
    searchTerm: searchEl ? searchEl.value : '',
    showSleeping: toggleHideDiscarded ? toggleHideDiscarded.checked : false,
    showAllWindows: toggleCurrentWindow ? toggleCurrentWindow.checked : false,
    artMode: toggleArt ? toggleArt.checked : false,
  };
}

export function handleFilterChange({ persist = true } = {}) {
  const uiState = readUiState();
  applyFilters(uiState);
  render();
  updateScopeIndicators(uiState);

  // Persist only the toggles; the search text is never written to disk.
  if (persist) {
    const { showSleeping, showAllWindows, artMode } = uiState;
    saveSettings({ showSleeping, showAllWindows, artMode });
  }
}

// While searching (or in the site view) the toggles do not narrow results;
// dim them so their unchecked state does not suggest otherwise.
function updateScopeIndicators(uiState) {
  const toolbar = document.querySelector('.toolbar');
  const findEverywhere = uiState.searchTerm.trim() !== '' || Boolean(state.siteHost);
  toolbar?.classList.toggle('searching', findEverywhere);

  const chip = document.getElementById('scope-chip');
  const label = document.getElementById('scope-label');
  if (chip && label) {
    chip.hidden = !state.siteHost;
    label.textContent = state.siteHost
      ? (t('siteScopeLabel', [state.siteHost]) || `Only ${state.siteHost}`)
      : '';
  }
}

export function setSiteScope(on) {
  state.siteHost = on ? currentSiteHost() : '';
  state.selectedIndex = -1;
  handleFilterChange();
  document.getElementById('search')?.focus();
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

export async function closeTab(tab) {
  try {
    await chrome.tabs.remove(tab.id);
  } catch {
    return; // already gone
  }
  state.allTabs = state.allTabs.filter((t) => t.id !== tab.id);
  forgetTile(tab.id);
  handleFilterChange();
}

function handleKeydown(e) {
  const searchEl = document.getElementById('search');
  switch (e.key) {
    case 'Escape':
      closeOverview();
      break;
    case 'Enter':
      flushFilterChange();
      if (state.selectedIndex !== -1 && state.filteredTabs[state.selectedIndex]) {
        e.preventDefault();
        activateTab(state.filteredTabs[state.selectedIndex]);
      }
      break;
    case 'ArrowUp':
    case 'ArrowDown':
    case 'ArrowLeft':
    case 'ArrowRight':
      e.preventDefault();
      flushFilterChange();
      moveSelection(e.key, getColumnCount());
      updateSelection(true);
      break;
    default:
      // Typing anywhere goes to the search box, even after clicking a toggle.
      if (searchEl && document.activeElement !== searchEl &&
          e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        searchEl.focus();
      }
  }
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function closeOverview(fast = false) {
  const rootEl = document.getElementById('root');

  if (prefersReducedMotion()) {
    window.close();
    return;
  }

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
