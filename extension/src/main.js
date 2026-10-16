// main.js
import { state, fetchAllTabs, currentSiteHost } from './state.js';
import { initializeEventListeners, handleFilterChange } from './events.js';
import { loadSettings } from './settings.js';
import { localizeStaticText, t } from './i18n.js';
import { readTryIt } from './tryit.js';
import { showTip } from './tips.js';

async function main() {
  // Apply localization for any static text before interacting with the UI
  localizeStaticText();

  const searchEl = document.getElementById('search');
  // Focus first: keystrokes typed while the window is still loading land in
  // the search box instead of being lost.
  searchEl?.focus();

  const params = new URLSearchParams(location.search);
  const [settings, , tryIt, shortcut] = await Promise.all([loadSettings(), fetchAllTabs(), readTryIt(), readShortcut()]);

  const toggleSleeping = document.getElementById('toggle-sleeping');
  const toggleAllWindows = document.getElementById('toggle-all-windows');

  // Apply loaded settings to the UI controls
  if (toggleSleeping) toggleSleeping.checked = settings.showSleeping;
  if (toggleAllWindows) toggleAllWindows.checked = settings.showAllWindows;
  state.preselectPrevious = settings.preselectPrevious;

  // Opened by the "current site" shortcut: show only this site's tabs.
  if (params.get('scope') === 'site') {
    state.siteHost = currentSiteHost();
  }

  // The staggered entrance animation plays for the first render only.
  const gridEl = document.getElementById('grid');
  gridEl?.classList.add('entering');
  handleFilterChange({ persist: false });
  setTimeout(() => {
    gridEl?.classList.remove('entering');
    // A tip, if one is due, once the cards have settled (tips.js).
    showTip({ showTips: settings.showTips, tryIt, shortcut, viaToolbar: params.get('via') === 'toolbar' });
  }, 700);

  updateShortcutHint(shortcut);

  initializeEventListeners();
  searchEl?.focus();
}

// The main shortcut as shown on the badge and in tips ('' when none).
async function readShortcut() {
  try {
    const commands = await chrome.commands.getAll();
    return (commands.find((cmd) => cmd.name === 'open-overview')?.shortcut || '').replace(/\+/g, ' + ');
  } catch (error) {
    console.warn('Could not load shortcut command.', error);
    return '';
  }
}

function updateShortcutHint(rawShortcut) {
  const hintEl = document.getElementById('shortcut-hint');
  if (!hintEl || !rawShortcut) return;
  hintEl.textContent = '';
  const kbd = document.createElement('kbd');
  kbd.textContent = rawShortcut;

  // The overview is open, so the badge says what pressing it again does.
  const tooltip = t('shortcutHintTitle', [rawShortcut]) || `Press ${rawShortcut} again to go to the selected tab (or close when none is selected)`;

  kbd.title = tooltip; // full hint on hover
  kbd.setAttribute('aria-label', tooltip);
  hintEl.appendChild(kbd);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
