// dom.js
import { state } from './state.js';
import { activateTab } from './events.js';
import { getHostname, isValidIconUrl, generateGradient, getPlaceholderDataUrl, createPlaceholderIcon } from './utils.js';
import { applyArtLayout } from './layout.js';

// Removed top-level element getters to prevent race conditions.

export function render() {
  const gridEl = document.getElementById('grid');
  if (!gridEl) return;
  gridEl.innerHTML = '';
  
  // Single, delegated mousemove listener for efficient hover handling.
  gridEl.addEventListener('mousemove', handleGridMouseMove);
  
  // Add a mouseleave event to the grid container to clear the selection
  gridEl.addEventListener('mouseleave', () => {
    if (state.selectedIndex !== -1) {
      state.selectedIndex = -1;
      updateSelection();
    }
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

  const preview = createPreviewElement(tab);
  tile.appendChild(preview);
  
  const meta = createMetaElement(tab);
  tile.appendChild(meta);
  
  return tile;
}

function handleGridMouseMove(e) {
  const target = e.target;
  const tile = target.closest('.tile');
  
  if (tile) {
    const index = parseInt(tile.dataset.index, 10);
    if (state.selectedIndex !== index) {
      state.selectedIndex = index;
      updateSelection();
    }
  } else {
    // If we are not over any tile (e.g., in the grid gap)
    if (state.selectedIndex !== -1) {
      state.selectedIndex = -1;
      updateSelection();
    }
  }
}

function createPreviewElement(tab) {
  const preview = document.createElement('div');
  preview.className = 'preview';
  
  // 1. Create the image element for the thumbnail
  const img = document.createElement('img');
  img.className = 'thumbnail';
  img.alt = 'Tab preview';
  img.src = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
  preview.appendChild(img);
  
  // 2. Create the text-based fallback preview, initially hidden
  const textPreview = document.createElement('div');
  textPreview.className = 'text-preview';
  textPreview.style.display = 'none'; // Initially hidden
  
  const title = document.createElement('div');
  title.className = 'preview-title';
  title.textContent = tab.title || 'Untitled';
  
  const url = document.createElement('div');
  url.className = 'preview-url';
  url.textContent = getHostname(tab.url);
  
  textPreview.appendChild(title);
  textPreview.appendChild(url);
  preview.appendChild(textPreview);

  // Set the initial blurry placeholder as a background on the main preview container
  preview.style.backgroundImage = `url('${getPlaceholderDataUrl(tab.title || 'Untitled', getHostname(tab.url))}')`;
  preview.style.backgroundSize = 'cover';
  preview.style.backgroundPosition = 'center';
  
  return preview;
}

function createMetaElement(tab) {
  const meta = document.createElement('div');
  meta.className = 'meta';
  
  const titleRow = document.createElement('div');
  titleRow.className = 'title-row';
  
  const favicon = document.createElement('img');
  favicon.className = 'favicon';
  favicon.alt = '';

  if (tab.favIconUrl && isValidIconUrl(tab.favIconUrl)) {
    favicon.src = tab.favIconUrl;
    favicon.onerror = () => {
      favicon.src = createPlaceholderIcon(getHostname(tab.url));
    };
  } else {
    favicon.src = createPlaceholderIcon(getHostname(tab.url));
  }
  titleRow.appendChild(favicon);
  
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
