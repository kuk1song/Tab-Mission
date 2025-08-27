// main.js
import { fetchAllTabs, applyFilters } from './state.js';
import { render } from './dom.js';
import { initializeEventListeners } from './events.js';
import { startThumbnailCapture } from './thumbnail.js';
import { loadSettings } from './settings.js';
import { applyArtLayout } from './layout.js';
import { localizeStaticText } from './i18n.js';

async function main() {
  // Apply localization for any static text before interacting with the UI
  localizeStaticText();

  await fetchAllTabs();
  
  const settings = await loadSettings();

  const searchEl = document.getElementById('search');
  const toggleHideDiscarded = document.getElementById('toggle-hide-discarded');
  const toggleCurrentWindow = document.getElementById('toggle-current-window');
  const toggleArt = document.getElementById('toggle-art');
  
  // Apply loaded settings to the UI controls
  if (toggleHideDiscarded) toggleHideDiscarded.checked = settings.showSleeping;
  if (toggleCurrentWindow) toggleCurrentWindow.checked = settings.showAllWindows;
  if (toggleArt) toggleArt.checked = settings.artMode;

  const uiState = {
    searchTerm: searchEl ? searchEl.value : '',
    showSleeping: settings.showSleeping,
    showAllWindows: settings.showAllWindows,
  };
  applyFilters(uiState);
  
  render();

  // Apply art layout after initial render based on settings
  if (toggleArt && toggleArt.checked) {
    requestAnimationFrame(() => {
      applyArtLayout();
    });
  }

  updateShortcutHint();

  // Thumbnails are now a default feature, so we always start the capture.
  requestAnimationFrame(() => {
    startThumbnailCapture();
  });

  initializeEventListeners();
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
      let tooltip = '';
      try {
        tooltip = chrome.i18n.getMessage('toggleWithShortcut', [rawShortcut]);
      } catch {}
      if (!tooltip) {
        tooltip = `Toggle with ${rawShortcut}`;
      }

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
