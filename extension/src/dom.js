// dom.js
import { state } from './state.js';
import { activateTab, closeTab, setSiteScope } from './events.js';
import { getHostname, isValidIconUrl, isSleeping, generateGradient, createPlaceholderIcon } from './utils.js';
import { observeTiles } from './thumbnail.js';
import { t } from './i18n.js';

// One tile per tab, built on first render and reused afterwards. Filtering
// only reorders these nodes, so previews never reload and the entrance
// animation never replays while typing.
const tiles = new Map();

// Bind the delegated grid listeners exactly once. render() swaps the grid's
// children but keeps the same #grid element.
export function initializeGridListeners() {
  const gridEl = document.getElementById('grid');
  if (!gridEl) return;
  gridEl.addEventListener('mousemove', handleGridMouseMove);
  gridEl.addEventListener('mouseleave', restDefaultSelection);
  gridEl.addEventListener('click', (e) => {
    const tab = tabForEvent(e);
    if (!tab) return;
    if (e.target.closest('.tile-close')) closeTab(tab);
    else activateTab(tab);
  });
  // Middle-click closes a tab, as on Chrome's own tab strip.
  gridEl.addEventListener('mousedown', (e) => {
    if (e.button === 1) e.preventDefault(); // no autoscroll cursor
  });
  gridEl.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    const tab = tabForEvent(e);
    if (tab) closeTab(tab);
  });
}

function tabForEvent(e) {
  const tile = e.target.closest('.tile');
  if (!tile) return null;
  return state.filteredTabs[parseInt(tile.dataset.index, 10)] || null;
}

function restDefaultSelection() {
  if (state.selectedIndex !== state.defaultIndex) {
    state.selectedIndex = state.defaultIndex;
    updateSelection();
  }
}

function handleGridMouseMove(e) {
  const tile = e.target.closest('.tile');
  if (!tile) {
    // In a grid gap: fall back to the default (the best search match, or none).
    restDefaultSelection();
    return;
  }
  const index = parseInt(tile.dataset.index, 10);
  if (state.selectedIndex !== index) {
    state.selectedIndex = index;
    updateSelection();
  }
}

export function render() {
  const gridEl = document.getElementById('grid');
  if (!gridEl) return;

  document.getElementById('search')?.setAttribute('aria-expanded', String(state.filteredTabs.length > 0));
  if (state.filteredTabs.length === 0) {
    gridEl.replaceChildren(createEmptyMessage());
    updateSelection();
    return;
  }

  const nodes = state.filteredTabs.map((tab, index) => {
    let tile = tiles.get(tab.id);
    if (!tile) {
      tile = createTile(tab, index);
      tiles.set(tab.id, tile);
    }
    tile.dataset.index = String(index);
    return tile;
  });
  gridEl.replaceChildren(...nodes);

  updateSelection();
  observeTiles(nodes);
}

export function forgetTile(tabId) {
  tiles.delete(tabId);
}

function createTile(tab, index) {
  const tile = document.createElement('button');
  tile.className = 'tile';
  tile.id = `tile-${tab.id}`;
  tile.setAttribute('role', 'option');
  tile.setAttribute('aria-selected', 'false');
  tile.tabIndex = -1; // focus stays in the search box; arrows move the highlight
  tile.style.setProperty('--stagger', `${(index % 10) * 20}ms`);
  tile.setAttribute('data-tab-id', String(tab.id));
  if (isSleeping(tab)) tile.classList.add('sleeping');

  tile.appendChild(createPreviewElement(tab));
  tile.appendChild(createMetaElement(tab));

  // A span, not a nested <button> (invalid inside a button); clicks on it are
  // handled by the grid's delegated listener.
  const close = document.createElement('span');
  close.className = 'tile-close';
  close.textContent = '×';
  close.title = t('closeTabTitle') || 'Close tab';
  close.setAttribute('aria-hidden', 'true');
  tile.appendChild(close);

  return tile;
}

function createPreviewElement(tab) {
  const hostname = getHostname(tab.url);
  const title = tab.title || t('untitled') || 'Untitled';

  const preview = document.createElement('div');
  preview.className = 'preview';
  preview.style.backgroundImage = generateGradient(hostname);

  // Placeholder text (title top-left, hostname bottom-left). It stays visible
  // until a real preview image loads over it, and remains for pages without one.
  const textPreview = document.createElement('div');
  textPreview.className = 'text-preview';
  const previewTitle = document.createElement('div');
  previewTitle.className = 'preview-title';
  previewTitle.textContent = title;
  const previewUrl = document.createElement('div');
  previewUrl.className = 'preview-url';
  previewUrl.textContent = hostname;
  textPreview.append(previewTitle, previewUrl);
  preview.appendChild(textPreview);

  const img = document.createElement('img');
  img.className = 'thumbnail';
  img.alt = '';
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  preview.appendChild(img);

  if (isSleeping(tab)) {
    const badge = document.createElement('span');
    badge.className = 'badge-sleeping';
    badge.textContent = t('sleepingBadge') || 'Sleeping';
    preview.appendChild(badge);
  }

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
  title.textContent = tab.title || t('untitled') || 'Untitled';
  titleRow.appendChild(title);

  meta.appendChild(titleRow);

  const url = document.createElement('div');
  url.className = 'url';
  url.textContent = getHostname(tab.url);
  meta.appendChild(url);

  return meta;
}

function createEmptyMessage() {
  const emptyMessage = document.createElement('div');
  emptyMessage.className = 'empty';
  emptyMessage.textContent = state.allTabs.length === 0
    ? (t('emptyNoTabs') || 'No tabs found.')
    : (t('emptyNoMatch') || 'No tabs match.');
  // Inside the site scope, name the scope and offer one click to search
  // every tab instead. (Without a query, e.g. after closing the site's last
  // tab, the generic message above stays.)
  if (state.siteHost && state.allTabs.length > 0) {
    const site = state.siteHost.replace(/^www\./, '');
    if (document.getElementById('search')?.value.trim()) {
      emptyMessage.textContent = t('emptyNoMatchInSite', [site]) || `No ${site} tabs match.`;
    }
    const widen = document.createElement('button');
    widen.className = 'empty-widen';
    widen.type = 'button';
    widen.textContent = t('searchAllTabs') || 'Search all tabs';
    widen.addEventListener('click', () => setSiteScope(false));
    emptyMessage.append(document.createElement('br'), widen);
  }
  return emptyMessage;
}

export function updateSelection(scrollToSelected = false) {
  const gridEl = document.getElementById('grid');
  if (!gridEl) return;
  const tileEls = Array.from(gridEl.querySelectorAll('.tile'));
  tileEls.forEach((tile, index) => {
    const selected = index === state.selectedIndex;
    tile.classList.toggle('selected', selected);
    tile.setAttribute('aria-selected', String(selected));
  });

  const selectedTile = tileEls[state.selectedIndex];
  const searchEl = document.getElementById('search');
  if (searchEl) {
    if (selectedTile) searchEl.setAttribute('aria-activedescendant', selectedTile.id);
    else searchEl.removeAttribute('aria-activedescendant');
  }

  // Only scroll for keyboard navigation. Scrolling on hover makes the grid
  // drift when the pointer merely grazes a tile near an edge.
  if (scrollToSelected && selectedTile) {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    selectedTile.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' });
  }
}
