// events.js
import { state, applyFilters, moveSelection, currentSiteHost, countSiteTabs } from './state.js';
import { render, updateSelection, initializeGridListeners, forgetTile } from './dom.js';
import { saveSettings } from './settings.js';
import { t } from './i18n.js';
import { isValidIconUrl, createPlaceholderIcon } from './utils.js';

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
  const resetBtn = document.getElementById('reset-window');
  const openSettingsBtn = document.getElementById('open-settings');
  const scopeClearBtn = document.getElementById('scope-clear');

  if (searchEl) searchEl.addEventListener('input', scheduleFilterChange);
  // After a checkbox click, hand focus back to the search box so typing works.
  for (const toggle of [toggleHideDiscarded, toggleCurrentWindow]) {
    if (!toggle) continue;
    toggle.addEventListener('change', () => {
      handleFilterChange({ persist: true });
      searchEl?.focus();
    });
  }

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

  // The shortcut pressed while the overview is open (sent by background.js).
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request?.action !== 'handleShortcut') return;
    sendResponse({ ok: true });
    // The site shortcut narrows the open overview to the current site. Every
    // other press acts on the selection, so hovering a tile and pressing the
    // shortcut switches to it in the site view too.
    if (request.scope === 'site' && !state.siteHost && currentSiteHost()) {
      setSiteScope(true);
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
  return {
    searchTerm: searchEl ? searchEl.value : '',
    showSleeping: toggleHideDiscarded ? toggleHideDiscarded.checked : false,
    showAllWindows: toggleCurrentWindow ? toggleCurrentWindow.checked : false,
    preselectPrevious: state.preselectPrevious,
  };
}

// persist: save the two toggles (only when one of them changed). The search
// text is never written to disk.
export function handleFilterChange({ persist = false } = {}) {
  const uiState = readUiState();
  applyFilters(uiState);
  render();
  updateScopeIndicators(uiState);

  if (persist) {
    const { showSleeping, showAllWindows } = uiState;
    saveSettings({ showSleeping, showAllWindows });
  }
}

// While a query is typed the toggles do not narrow results; dim them so their
// unchecked state does not suggest otherwise. Also keeps the site-scope token,
// the Tab hint and the placeholder in step with the state.
function updateScopeIndicators(uiState) {
  const toolbar = document.querySelector('.toolbar');
  toolbar?.classList.toggle('searching', uiState.searchTerm.trim() !== '');

  const site = currentSite(uiState);
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
// how many tabs the site view would show under the current toggles.
function currentSite(uiState = readUiState()) {
  const host = state.siteHost || currentSiteHost();
  const currentTab = state.allTabs.find((tab) => tab.id === state.currentTabId);
  const count = countSiteTabs(host, uiState);
  const icon = currentTab?.favIconUrl && isValidIconUrl(currentTab.favIconUrl)
    ? currentTab.favIconUrl
    : createPlaceholderIcon(host);
  return { host, label: host.replace(/^www\./, ''), icon, count };
}

export function setSiteScope(on) {
  state.siteHost = on ? currentSiteHost() : '';
  // Mark the selection as automatic, so the new view gets its own default
  // (the best match, or the previous tab with preselectPrevious on).
  state.selectedIndex = state.defaultIndex;
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

  // Switch at once; the closing animation runs in parallel. A tab closed in
  // the meantime just fails quietly.
  chrome.tabs.update(tab.id, { active: true }).catch(() => {});
  chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  closeOverview(true); // Pass true for a fast close
}

export async function closeTab(tab) {
  try {
    await chrome.tabs.remove(tab.id);
  } catch {
    // Already gone: drop its tile all the same.
  }
  state.allTabs = state.allTabs.filter((t) => t.id !== tab.id);
  forgetTile(tab.id);
  handleFilterChange();
  // Clicking × focused the removed tile; give focus back to the search box.
  document.getElementById('search')?.focus();
}

function handleKeydown(e) {
  // Keys that pick or commit an input method candidate (pinyin, kana) belong
  // to the input method, not to the overview.
  if (e.isComposing || e.keyCode === 229) return;
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
      // Enter on a focused toolbar button presses that button.
      if (document.activeElement !== searchEl && document.activeElement?.closest('.toolbar')) break;
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
      // Space keeps its own role (it toggles a focused checkbox or button).
      if (searchEl && document.activeElement !== searchEl && e.key !== ' ' &&
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
