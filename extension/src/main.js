// main.js
import { state, fetchAllTabs, currentSiteHost } from './state.js';
import { initializeEventListeners, handleFilterChange, markReady } from './events.js';
import { loadSettings } from './settings.js';
import { localizeStaticText } from './i18n.js';
import { readTryIt } from './tryit.js';
import { showTip } from './tips.js';
import { markInView } from './dom.js';

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
  state.groupBySite = settings.groupBySite;

  // Opened by the "current site" shortcut: show only this site's tabs.
  if (params.get('scope') === 'site') {
    state.siteHost = currentSiteHost();
  }

  // The staggered entrance animation plays for the first render only, on the
  // tiles in view.
  const gridEl = document.getElementById('grid');
  gridEl?.classList.add('entering');
  handleFilterChange({ persist: false });
  markInView();
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

// The badge shows the shortcut, nothing more: the tips and the welcome page
// teach what it does.
function updateShortcutHint(rawShortcut) {
  const hintEl = document.getElementById('shortcut-hint');
  if (!hintEl || !rawShortcut) return;
  const kbd = document.createElement('kbd');
  kbd.textContent = rawShortcut;
  hintEl.replaceChildren(kbd);
}

// Presses that came while the window was loading act once main() is done
// (events.js), even should it fail: the shortcut then still switches or
// closes the window.
function start() {
  main().finally(markReady);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
