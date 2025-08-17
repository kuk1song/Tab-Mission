// main.js
import { fetchAllTabs, applyFilters } from './state.js';
import { render } from './dom.js';
import { initializeEventListeners } from './events.js';
import { startThumbnailCapture } from './thumbnail.js';
import { loadSettings } from './settings.js';
import { applyArtLayout } from './layout.js';

async function main() {
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

  // Persist window bounds on hide/close to ensure latest resize is saved
  const saveBoundsNow = async () => {
    try {
      const win = await chrome.windows.getCurrent();
      if (!win) return;
      const bounds = { width: win.width, height: win.height, top: win.top, left: win.left };
      await chrome.storage.local.set({ overviewBounds: bounds });
    } catch {}
  };
  window.addEventListener('pagehide', saveBoundsNow);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) saveBoundsNow();
  });
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
        <a href="#" data-shortcuts="chrome://extensions/shortcuts" title="Change shortcut">⚙️</a>
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
