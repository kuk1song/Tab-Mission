// dom.js
import { state } from './state.js';
import { activateTab, closeTab, setSiteScope } from './events.js';
import { getHostname, isSleeping, isCapturableUrl, faviconUrl, hueColor } from './utils.js';
import { observeTiles } from './thumbnail.js';
import { t } from './i18n.js';
import { selectionMoved } from './tips.js';

// One tile per tab, built on first render and reused afterwards. Filtering
// only reorders these nodes, so previews never reload and the entrance
// animation never replays while typing. Grouped by site, a tab in the recent
// group has a second tile there (recentTiles).
const tiles = new Map();
const recentTiles = new Map();

// Bind the delegated grid listeners exactly once. render() swaps the grid's
// children but keeps the same #grid element.
export function initializeGridListeners() {
  const gridEl = document.getElementById('grid');
  if (!gridEl) return;
  gridEl.addEventListener('mousemove', handleGridMouseMove);
  gridEl.addEventListener('mouseleave', handleGridMouseLeave);
  gridEl.addEventListener('click', (e) => {
    const tab = tabForEvent(e);
    if (!tab) return;
    if (e.target.closest('.tile-close')) closeTab(tab);
    else activateTab(tab, e.target.closest('.tile'));
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

// The pointer takes over the selection only once it has really moved. The
// overview opens under a resting pointer, and a twitch must not move the
// pre-selected tile away from the next press of the shortcut. Once it has
// taken over, the selection is the tile under the pointer, or none over a gap
// or outside the grid. Any key hands the selection back to the keyboard.
const POINTER_TAKEOVER_PX = 8;
let pointerAnchor = null;
let pointerSelects = false;

export function releasePointerSelection() {
  pointerAnchor = null;
  pointerSelects = false;
}

function select(index) {
  if (state.selectedIndex !== index) {
    selectionMoved(); // a tip on the card that was selected no longer applies
    state.selectedIndex = index;
    updateSelection();
  }
}

function handleGridMouseMove(e) {
  if (!pointerSelects) {
    if (!pointerAnchor) {
      pointerAnchor = { x: e.clientX, y: e.clientY };
      return;
    }
    if (Math.hypot(e.clientX - pointerAnchor.x, e.clientY - pointerAnchor.y) < POINTER_TAKEOVER_PX) return;
    pointerSelects = true;
  }
  const tile = e.target.closest('.tile');
  select(tile ? parseInt(tile.dataset.index, 10) : -1);
}

function handleGridMouseLeave() {
  if (pointerSelects) select(-1);
}

let shown = null; // what the grid shows: its groups and tiles, in order

export function render() {
  const gridEl = document.getElementById('grid');
  if (!gridEl) return;

  document.getElementById('search')?.setAttribute('aria-expanded', String(state.filteredTabs.length > 0));
  if (state.filteredTabs.length === 0) {
    shown = null;
    gridEl.classList.remove('grouped');
    gridEl.replaceChildren(createEmptyMessage());
    updateSelection();
    return;
  }

  const recentEnd = state.groups ? state.groups[0].count : 0;
  const nodes = state.filteredTabs.map((tab, index) => {
    const map = index < recentEnd ? recentTiles : tiles;
    let tile = map.get(tab.id);
    if (!tile) {
      tile = createTile(tab, index);
      if (map === recentTiles) tile.id = `tile-recent-${tab.id}`;
      map.set(tab.id, tile);
    }
    tile.dataset.index = String(index);
    return tile;
  });
  // A keystroke that leaves the same tiles (most do, with many tabs) only
  // moves the selection: putting hundreds of tiles back costs a layout.
  const now = JSON.stringify([state.groups, state.filteredTabs.map((tab) => tab.id)]);
  if (now !== shown) {
    shown = now;
    gridEl.classList.toggle('grouped', Boolean(state.groups));
    gridEl.replaceChildren(...(state.groups ? state.groups.map((group) => createGroup(group, nodes)) : nodes));
  }

  updateSelection();
  observeTiles(nodes);
}

// Mark the tiles and group labels in the grid's view, the only ones worth
// animating: with hundreds of tabs, animating all of them cost a long frame.
// Every position is read before any class is written, so this takes one
// layout. Returns the marked elements, in order.
export function markInView() {
  const gridEl = document.getElementById('grid');
  if (!gridEl) return [];
  const view = gridEl.getBoundingClientRect();
  const els = [...gridEl.querySelectorAll('.tile, .group-label')];
  const inView = els.map((el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > view.top && r.top < view.bottom;
  });
  els.forEach((el, i) => el.classList.toggle('in-view', inView[i]));
  return els.filter((el, i) => inView[i]);
}

// A group of tiles under a small label: the recent tabs, one site's tabs,
// or tabs without a site (local files, blank pages). It is as wide as its
// tiles (--n), up to the grid's width.
function createGroup({ recent, host, start, count }, nodes) {
  const group = document.createElement('div');
  group.className = recent ? 'tile-group recent' : 'tile-group';
  group.setAttribute('role', 'group');
  const label = recent
    ? (t('groupRecent') || 'Recent')
    : host.replace(/^www\./, '') || t('groupOther') || 'Other pages';
  group.setAttribute('aria-label', label);
  group.style.setProperty('--n', String(count));
  const heading = document.createElement('div');
  heading.className = 'group-label';
  heading.setAttribute('aria-hidden', 'true');
  heading.textContent = label;
  group.append(heading, ...nodes.slice(start, start + count));
  return group;
}

export function forgetTile(tabId) {
  tiles.delete(tabId);
  recentTiles.delete(tabId);
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
  const preview = document.createElement('div');
  preview.className = 'preview';
  // The icon card's color until thumbnail.js has the icon's own.
  preview.style.setProperty('--c', hueColor(hostname || tab.title));

  // Shown until a picture loads over it, and for pages without one: the
  // site's icon from Chrome's own store (no network request), or the first
  // letter of a page that is not a web page.
  const icon = document.createElement('div');
  icon.className = 'preview-icon';
  icon.setAttribute('aria-hidden', 'true'); // the title says it; a letter is not part of the name
  const plate = document.createElement('span');
  if (isCapturableUrl(tab.url)) {
    plate.appendChild(siteIcon(tab.url));
  } else {
    const letter = document.createElement('b');
    letter.textContent = Array.from(tab.title || hostname || '?')[0].toUpperCase();
    plate.appendChild(letter);
  }
  icon.appendChild(plate);
  preview.appendChild(icon);

  const img = document.createElement('img');
  img.className = 'thumbnail';
  img.alt = '';
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  preview.appendChild(img);

  // With a picture, the site's icon on its corner.
  if (isCapturableUrl(tab.url)) {
    const badge = document.createElement('span');
    badge.className = 'site-badge';
    badge.appendChild(siteIcon(tab.url));
    preview.appendChild(badge);
  }

  if (isSleeping(tab)) {
    const badge = document.createElement('span');
    badge.className = 'badge-sleeping';
    badge.textContent = t('sleepingBadge') || 'Sleeping';
    preview.appendChild(badge);
  }

  return preview;
}

function siteIcon(url) {
  const img = document.createElement('img');
  img.alt = '';
  img.src = faviconUrl(url);
  return img;
}

function createMetaElement(tab) {
  const meta = document.createElement('div');
  meta.className = 'meta';

  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = tab.title || t('untitled') || 'Untitled';
  meta.appendChild(title);

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
