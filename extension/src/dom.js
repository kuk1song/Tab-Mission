// dom.js
import { state } from './state.js';
import { activateTab } from './events.js';
import { getHostname, isValidIconUrl, generateGradient, getPlaceholderDataUrl } from './utils.js';
import { applyArtLayout } from './layout.js';

// Removed top-level element getters to prevent race conditions.

export function render() {
  const gridEl = document.getElementById('grid');
  if (!gridEl) return;
  gridEl.innerHTML = '';
  
  // Add a mouseleave event to the grid container to clear the selection
  gridEl.addEventListener('mouseleave', () => {
    state.selectedIndex = -1;
    updateSelection();
  });

  if (state.filteredTabs.length === 0) {
    renderEmptyMessage();
    return;
  }
  
  const fragment = document.createDocumentFragment();
  state.filteredTabs.forEach((tab, index) => {
    const tile = createTile(tab, index);
    fragment.appendChild(tile);
  });
  gridEl.appendChild(fragment);

  updateSelection();
  applyArtLayout();
}

function createTile(tab, index) {
  const tile = document.createElement('button');
  tile.className = 'tile';
  tile.style.setProperty('--stagger', `${(index % 10) * 20}ms`);
  tile.setAttribute('data-tab-id', String(tab.id));
  tile.setAttribute('data-index', String(index));
  tile.addEventListener('click', () => activateTab(tab));

  // Add mouseenter listener to update selection on hover
  tile.addEventListener('mouseenter', () => {
    state.selectedIndex = index;
    updateSelection();
  });

  const preview = createPreviewElement(tab);
  tile.appendChild(preview);
  
  const meta = createMetaElement(tab);
  tile.appendChild(meta);
  
  return tile;
}

function createPreviewElement(tab) {
  const preview = document.createElement('div');
  preview.className = 'preview';
  
  const img = document.createElement('img');
  img.className = 'thumbnail';
  img.alt = 'Tab preview';
  img.src = getPlaceholderDataUrl(tab.title || 'Untitled', getHostname(tab.url));
  preview.appendChild(img);
  
  return preview;
}

function createMetaElement(tab) {
  const meta = document.createElement('div');
  meta.className = 'meta';
  
  const titleRow = document.createElement('div');
  titleRow.className = 'title-row';
  
  if (tab.favIconUrl && isValidIconUrl(tab.favIconUrl)) {
    const favicon = document.createElement('img');
    favicon.className = 'favicon';
    favicon.src = tab.favIconUrl;
    favicon.alt = '';
    titleRow.appendChild(favicon);
  }
  
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = tab.title || 'Untitled';
  titleRow.appendChild(title);
  
  meta.appendChild(titleRow);
  
  const url = document.createElement('div');
  url.className = 'url';
  url.textContent = getHostname(tab.url);
  meta.appendChild(url);
  
  return meta;
}

function renderEmptyMessage() {
  const gridEl = document.getElementById('grid');
  if (!gridEl) return;
  const emptyMessage = document.createElement('div');
  emptyMessage.style.cssText = 'padding: 40px; text-align: center; color: #9aa0a6; font-size: 14px;';
  emptyMessage.textContent = state.allTabs.length === 0 
    ? 'No tabs found. Please check permissions.'
    : 'No tabs match current filters.';
  gridEl.appendChild(emptyMessage);
}

export function updateSelection() {
  const gridEl = document.getElementById('grid');
  if (!gridEl) return;
  const tiles = Array.from(gridEl.querySelectorAll('.tile'));
  tiles.forEach((tile, index) => {
    tile.classList.toggle('selected', index === state.selectedIndex);
  });
  
  const selectedTile = tiles[state.selectedIndex];
  if (selectedTile) {
    selectedTile.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}
