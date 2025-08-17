// main.js
import { fetchAllTabs, applyFilters } from './state.js';
import { render } from './dom.js';
import { initializeEventListeners } from './events.js';
import { startThumbnailCapture } from './thumbnail.js';
import { loadSettings } from './settings.js';

async function main() {
  await fetchAllTabs();
  
  const settings = await loadSettings();

  const searchEl = document.getElementById('search');
  const toggleHideDiscarded = document.getElementById('toggle-hide-discarded');
  const toggleCurrentWindow = document.getElementById('toggle-current-window');
  
  // Apply loaded settings to the UI controls
  if (toggleHideDiscarded) toggleHideDiscarded.checked = settings.showSleeping;
  if (toggleCurrentWindow) toggleCurrentWindow.checked = settings.showAllWindows;

  const uiState = {
    searchTerm: searchEl ? searchEl.value : '',
    showSleeping: settings.showSleeping,
    showAllWindows: settings.showAllWindows,
  };
  applyFilters(uiState);
  
  render();

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
      const shortcut = openCommand.shortcut.replace(/\+/g, ' + ');
      hintEl.innerHTML = `
        <span>Toggle with <kbd>${shortcut}</kbd></span>
        <a href="chrome://extensions/shortcuts" title="Change shortcut" target="_blank">⚙️</a>
      `;
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
