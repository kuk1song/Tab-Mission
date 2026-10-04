// main.js
import { state, fetchAllTabs, currentSiteHost } from './state.js';
import { initializeEventListeners, handleFilterChange } from './events.js';
import { loadSettings } from './settings.js';
import { localizeStaticText, t } from './i18n.js';

async function main() {
  // Apply localization for any static text before interacting with the UI
  localizeStaticText();

  const searchEl = document.getElementById('search');
  // Focus first: keystrokes typed while the window is still loading land in
  // the search box instead of being lost.
  searchEl?.focus();

  const [settings] = await Promise.all([loadSettings(), fetchAllTabs()]);

  const toggleHideDiscarded = document.getElementById('toggle-hide-discarded');
  const toggleCurrentWindow = document.getElementById('toggle-current-window');

  // Apply loaded settings to the UI controls
  if (toggleHideDiscarded) toggleHideDiscarded.checked = settings.showSleeping;
  if (toggleCurrentWindow) toggleCurrentWindow.checked = settings.showAllWindows;
  state.preselectPrevious = settings.preselectPrevious;
  // TEMPORARY A/B: denser grid, few tabs grow to fill.
  document.getElementById('grid')?.classList.toggle('dense', settings.experimentGrid === 'dense');

  // Opened by the "current site" shortcut: show only this site's tabs.
  if (new URLSearchParams(location.search).get('scope') === 'site') {
    state.siteHost = currentSiteHost();
  }

  // The staggered entrance animation plays for the first render only.
  const gridEl = document.getElementById('grid');
  gridEl?.classList.add('entering');
  handleFilterChange({ persist: false });
  setTimeout(() => gridEl?.classList.remove('entering'), 700);

  updateShortcutHint();

  initializeEventListeners();
  searchEl?.focus();
}

async function updateShortcutHint() {
  const hintEl = document.getElementById('shortcut-hint');
  if (!hintEl) return;
  try {
    const commands = await chrome.commands.getAll();
    const openCommand = commands.find(cmd => cmd.name === 'open-overview');
    if (openCommand && openCommand.shortcut) {
      const rawShortcut = openCommand.shortcut.replace(/\+/g, ' + ');
      hintEl.textContent = '';
      const kbd = document.createElement('kbd');
      kbd.textContent = rawShortcut;

      // Localize tooltip text: "Toggle with $shortcut$"
      const tooltip = t('toggleWithShortcut', [rawShortcut]) || `Toggle with ${rawShortcut}`;

      kbd.title = tooltip; // full hint on hover
      kbd.setAttribute('aria-label', tooltip);
      hintEl.appendChild(kbd);
    }
  } catch (error) {
    console.warn('Could not load shortcut command.', error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
