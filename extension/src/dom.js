// dom.js
import { state } from './state.js';
import { activateTab } from './events.js';
import { getHostname, isValidIconUrl, getPlaceholderDataUrl, createPlaceholderIcon } from './utils.js';
import { applyArtLayout } from './layout.js';

// Removed top-level element getters to prevent race conditions.

// Bind the delegated hover listeners exactly once. render() rebuilds the
// grid's children but keeps the same #grid element, so these must not be
// re-added per render — the old per-render anonymous mouseleave listener
// leaked a new closure on every render.
export function initializeGridListeners() {
  const gridEl = document.getElementById('grid');
  if (!gridEl) return;
  gridEl.addEventListener('mousemove', handleGridMouseMove);
  gridEl.addEventListener('mouseleave', handleGridMouseLeave);
}

function handleGridMouseLeave() {
  if (state.selectedIndex !== -1) {
    state.selectedIndex = -1;
    updateSelection();
  }
}

export function render() {
  const gridEl = document.getElementById('grid');
  if (!gridEl) return;
  gridEl.innerHTML = '';

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

// Hover should not take over until the pointer genuinely moves. When the
// overview window opens under a stationary cursor, the browser can fire a
// synthetic mousemove that would otherwise clobber the keyboard preselection
// (the previous tab). Ignore movement until the pointer position changes.
let pointerArmed = false;
let lastPointerX = null;
let lastPointerY = null;

function handleGridMouseMove(e) {
  if (!pointerArmed) {
    if (lastPointerX === null) {
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;
      return;
    }
    if (e.clientX === lastPointerX && e.clientY === lastPointerY) {
      return;
    }
    pointerArmed = true;
  }

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

export function updateSelection(scrollToSelected = false) {
  const gridEl = document.getElementById('grid');
  if (!gridEl) return;
  const tiles = Array.from(gridEl.querySelectorAll('.tile'));
  tiles.forEach((tile, index) => {
    tile.classList.toggle('selected', index === state.selectedIndex);
  });

  // Only scroll for keyboard navigation. Scrolling on hover makes the grid
  // drift when the pointer merely grazes a tile near an edge.
  if (scrollToSelected) {
    const selectedTile = tiles[state.selectedIndex];
    if (selectedTile) {
      selectedTile.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
}
