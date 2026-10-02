// events.js
import { state, applyFilters, moveSelection, currentSiteHost } from './state.js';
import { render, updateSelection, initializeGridListeners, forgetTile } from './dom.js';
import { applyArtLayout } from './layout.js';
import { saveSettings } from './settings.js';
import { t } from './i18n.js';
import { getHostname, isValidIconUrl, createPlaceholderIcon } from './utils.js';

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
  const openSettingsBtn = document.getElementById('open-settings');
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

  // The gear opens Tab Mission's own settings page (open behaviour, and the
  // shortcuts with a link to change them).
  if (openSettingsBtn) {
    openSettingsBtn.addEventListener('click', () => {
      try {
        chrome.runtime.openOptionsPage();
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
  const scopeHintBtn = document.getElementById('scope-hint');
  if (scopeHintBtn) {
    scopeHintBtn.addEventListener('click', () => setSiteScope(true));
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
    preselectPrevious: state.preselectPrevious,
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
// dim them so their unchecked state does not suggest otherwise. Also keeps the
// site-scope token, the Tab hint and the placeholder in step with the state.
function updateScopeIndicators(uiState) {
  const toolbar = document.querySelector('.toolbar');
  const findEverywhere = uiState.searchTerm.trim() !== '' || Boolean(state.siteHost);
  toolbar?.classList.toggle('searching', findEverywhere);

  const site = currentSite();
  const token = document.getElementById('scope-token');
  const hint = document.getElementById('scope-hint');
  const searchEl = document.getElementById('search');
  if (!token || !hint || !searchEl) return;

  token.hidden = !state.siteHost;
  if (state.siteHost) {
    document.getElementById('scope-label').textContent = site.label;
    document.getElementById('scope-icon').src = site.icon;
    searchEl.placeholder = t('searchSitePlaceholder', [site.label]) || `Search ${site.label} tabs…`;
  } else {
    searchEl.placeholder = t('searchPlaceholder') || 'Search tabs (title or URL)…';
  }

  // Offer the scope only when it narrows something: an empty box, a real
  // site, and at least one other tab from it.
  const offer = !state.siteHost && uiState.searchTerm === '' && site.count >= 2;
  hint.hidden = !offer;
  if (offer) {
    document.getElementById('scope-hint-label').textContent =
      t('siteScopeHint', [site.label, String(site.count)]) || `Only ${site.label} · ${site.count}`;
    hint.title = t('siteScopeHintTitle') || 'Show only tabs from this site';
  }
}

// The current tab's site: a short label (no leading "www."), its favicon, and
// how many open tabs share its hostname.
function currentSite() {
  const host = state.siteHost || currentSiteHost();
  const currentTab = state.allTabs.find((tab) => tab.id === state.currentTabId);
  const count = host
    ? state.allTabs.filter((tab) => tab.windowId !== state.selfWindowId && getHostname(tab.url) === host).length
    : 0;
  const icon = currentTab?.favIconUrl && isValidIconUrl(currentTab.favIconUrl)
    ? currentTab.favIconUrl
    : createPlaceholderIcon(host);
  return { host, label: host.replace(/^www\./, ''), icon, count };
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
      // Layered, innermost first: clear the query, then leave the site
      // scope, then close (as Raycast and Chrome's address bar do).
      e.preventDefault();
      if (searchEl && searchEl.value !== '') {
        searchEl.value = '';
        handleFilterChange();
      } else if (state.siteHost) {
        setSiteScope(false);
      } else {
        closeOverview();
      }
      break;
    case 'Tab':
      // Tab toggles the site scope, like "Tab to search" in Chrome's
      // address bar; Shift+Tab leaves it. Without a site to scope to, Tab
      // keeps its usual role.
      if (document.activeElement !== searchEl || e.metaKey || e.ctrlKey || e.altKey) break;
      if (state.siteHost) {
        e.preventDefault();
        setSiteScope(false);
      } else if (!e.shiftKey && currentSite().count >= 2) {
        e.preventDefault();
        setSiteScope(true);
      }
      break;
    case 'Backspace':
      // Backspace with the caret at the very start removes the scope token,
      // keeping any typed text (Chrome and Firefox address bars).
      if (state.siteHost && searchEl && document.activeElement === searchEl &&
          searchEl.selectionStart === 0 && searchEl.selectionEnd === 0) {
        e.preventDefault();
        setSiteScope(false);
      }
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
