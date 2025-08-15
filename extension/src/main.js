// main.js
import { fetchAllTabs, applyFilters } from './state.js';
import { render } from './dom.js';
import { initializeEventListeners } from './events.js';
import { startThumbnailCapture } from './thumbnail.js';

async function main() {
  await fetchAllTabs();
  
  const uiState = {
    searchTerm: document.getElementById('search').value,
    hideDiscarded: document.getElementById('toggle-hide-discarded').checked,
    currentWindowOnly: document.getElementById('toggle-current-window').checked,
  };
  applyFilters(uiState);
  
  render();

  requestAnimationFrame(() => {
    if (document.getElementById('toggle-thumbnails').checked) {
      startThumbnailCapture();
    }
  });

  initializeEventListeners();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
