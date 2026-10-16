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
  const [settings, , tryIt, shortcuts] = await Promise.all([loadSettings(), fetchAllTabs(), readTryIt(), readShortcuts()]);
  const shortcut = shortcuts['open-overview'];

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
    // A tip, if one is due, once the cards have settled (tips.js). Opened
    // with the site shortcut, the tip names that key: pressed again, it too
    // goes to the selection.
    const pressed = params.get('scope') === 'site' ? shortcuts['open-overview-site'] || shortcut : shortcut;
    showTip({ showTips: settings.showTips, tryIt, shortcut: pressed, viaClick: params.get('via') === 'click' });
  }, 700);

  updateShortcutHint(shortcut);

  initializeEventListeners();
  searchEl?.focus();
}

// Each command's shortcut as shown on the badge and in tips, read when the
// window opens, so a key changed at chrome://extensions/shortcuts shows the
// next time ('' when none).
async function readShortcuts() {
  const shortcuts = { 'open-overview': '', 'open-overview-site': '' };
  try {
    for (const command of await chrome.commands.getAll()) {
      shortcuts[command.name] = (command.shortcut || '').replace(/\+/g, ' + ');
    }
  } catch (error) {
    console.warn('Could not load shortcut command.', error);
  }
  return shortcuts;
}

function updateShortcutHint(rawShortcut) {
  const hintEl = document.getElementById('shortcut-hint');
  if (!hintEl || !rawShortcut) return;
  hintEl.textContent = '';
  const kbd = document.createElement('kbd');
  kbd.textContent = rawShortcut;

  // The badge says what pressing the shortcut here does (opened with a
  // click, it has not been pressed yet, so no "again").
  const tooltip = t('shortcutHintTitle', [rawShortcut]) || `Press ${rawShortcut} to switch to the selected tab`;

  kbd.title = tooltip; // full hint on hover
  kbd.setAttribute('aria-label', tooltip);
  hintEl.appendChild(kbd);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
