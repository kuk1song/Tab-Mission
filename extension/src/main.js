// main.js
import { state, fetchAllTabs, currentSiteHost } from './state.js';
import { initializeEventListeners, handleFilterChange, markReady } from './events.js';
import { loadSettings } from './settings.js';
import { localizeStaticText, t } from './i18n.js';
import { readTryIt } from './tryit.js';
import { showTip } from './tips.js';
import { markInView, prepareSpreadEntrance } from './dom.js';
import { showBackdrop } from './backdrop.js';
import { preloadCovers, followCurrentCover } from './thumbnail.js';

async function main() {
  const params = new URLSearchParams(location.search);
  // In a frame, or under the name pages can frame it by (overlay.html), the
  // overview shows only where background.js just put it (a trial, on the
  // page in front, src/host.js): a page that frames or opens it on its own
  // gets nothing to show or to click, and it takes no messages (events.js).
  if (window.top !== window || location.pathname !== '/overview.html') {
    state.host = 'refused';
    if (!(await claimFrame(params))) {
      document.documentElement.hidden = true;
      chrome.runtime.sendMessage({ action: 'closeOverlay', refused: true }).catch(() => {});
      return false;
    }
    state.host = 'page';
  }

  // Apply localization for any static text before interacting with the UI
  localizeStaticText();
  nameToggles();

  const searchEl = document.getElementById('search');
  // Focus first: keystrokes typed while the window is still loading land in
  // the search box instead of being lost.
  searchEl?.focus();

  const [settings, , tryIt, shortcuts] = await Promise.all([loadSettings(), fetchAllTabs(), readTryIt(), readShortcuts()]);
  const shortcut = shortcuts['open-overview'];
  // The picture behind the cards, when chosen, comes in on its own: nothing waits for it.
  showBackdrop();

  const toggleSleeping = document.getElementById('toggle-sleeping');
  const toggleAllWindows = document.getElementById('toggle-all-windows');

  // Apply loaded settings to the UI controls
  if (toggleSleeping) toggleSleeping.checked = settings.showSleeping;
  if (toggleAllWindows) toggleAllWindows.checked = settings.showAllWindows;
  state.preselectPrevious = settings.preselectPrevious;
  state.groupBySite = settings.groupBySite;
  state.spreadOut = settings.spread === true;
  state.spreadEqual = settings.cardSizes === 'equal';

  // Opened by the "current site" shortcut: show only this site's tabs.
  if (params.get('scope') === 'site') {
    state.siteHost = currentSiteHost();
  }

  // The staggered entrance animation plays for the first render only, on the
  // tiles in view. It ends 700 ms after opening, or once its animations have
  // played when the window's first frame comes later (a slow machine, seen
  // on GitHub's macOS runners): ended by the clock alone, it would take the
  // entrance from the tiles still waiting for their turn. 2 s at most, for a
  // window that draws no frames.
  // The badge first: it can wrap the toolbar onto a second row, and cards
  // spread out are placed for the room the toolbar leaves.
  updateShortcutHint(shortcut);

  const gridEl = document.getElementById('grid');
  gridEl?.classList.add('entering');
  handleFilterChange({ persist: false });
  if (gridEl) prepareSpreadEntrance(gridEl);
  markInView();
  followCurrentCover();
  // The entrance waits (look.js, overview.css) until the cards in view have
  // their pictures and are drawn, and then plays as one.
  firstFrame(gridEl).then(() => {
    const entrance = (gridEl?.getAnimations({ subtree: true }) ?? []).filter((a) => ENTRANCES.includes(a.animationName));
    return Promise.race([
      Promise.all([after(700), Promise.allSettled(entrance.map((a) => a.finished))]),
      after(2000),
    ]);
  }).then(() => {
    gridEl?.classList.remove('entering');
    // A tip, if one is due, once the cards have settled (tips.js). Opened
    // with the site shortcut, the tip names that key: pressed again, it too
    // goes to the selection.
    const pressed = params.get('scope') === 'site' ? shortcuts['open-overview-site'] || shortcut : shortcut;
    showTip({ showTips: settings.showTips, tryIt, shortcut: pressed, viaClick: params.get('via') === 'click' });
  });

  initializeEventListeners(Object.values(shortcuts));
  searchEl?.focus();
  return true;
}

const after = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// How long the first frame waits for the pictures of the cards in view, for
// a frame with them on, and, on a page, for background.js to show the layer
// (src/host.js).
const PICTURES_WAIT_MS = 100;
const FRAME_WAIT_MS = 50;
const SHOW_WAIT_MS = 400;

// Let the entrance go (look.js holds it): once the cards in view have their
// pictures, Chrome has had a frame to draw them in (too faint to see,
// overview.css), and, on a page, the layer shows. The entrance then starts
// only when the cards are drawn, so it starts moving. Late pictures fade in
// as ever. A window that draws no frames (hidden, say) is let go by the
// clock.
async function firstFrame(gridEl) {
  try {
    const tiles = gridEl ? [...gridEl.querySelectorAll('.tile.in-view')] : [];
    await Promise.race([preloadCovers(tiles), after(PICTURES_WAIT_MS)]);
    await Promise.race([new Promise((resolve) => requestAnimationFrame(resolve)), after(FRAME_WAIT_MS)]);
    // That frame's drawing comes after its callbacks: let go once it is
    // under way. Meanwhile, on a page, ask for the layer to show.
    const shown = state.host === 'page'
      ? Promise.race([chrome.runtime.sendMessage({ action: 'showOverlay' }).catch(() => {}), after(SHOW_WAIT_MS)])
      : null;
    await Promise.all([after(0), shown]);
  } catch {}
  release();
}

// The mark is for timelines only (DevTools' Performance panel shows it, and
// tests/e2e/timing.spec.mjs reads it): it stays in the page.
function release() {
  delete document.documentElement.dataset.wait;
  performance.mark('entrance');
}

async function claimFrame(params) {
  try {
    const answer = await chrome.runtime.sendMessage({ action: 'claimOverlay', token: params.get('token') });
    return params.get('host') === 'page' && answer?.ok === true;
  } catch {
    return false;
  }
}

// The tiles' entrance animations (overview.css): in the grid, and spread out.
const ENTRANCES = ['fadeInUp', 'spreadOut', 'pageIn'];

// Each command's shortcut as shown on the badge and in tips, read when the
// window opens, so a key changed at chrome://extensions/shortcuts shows the
// next time ('' when none).
async function readShortcuts() {
  const shortcuts = { 'open-overview': '', 'open-overview-site': '' };
  try {
    for (const command of await chrome.commands.getAll()) {
      shortcuts[command.name] = (command.shortcut || '').replace(/\+/g, ' + ');
    }
  } catch (error) {
    console.warn('Could not load shortcut command.', error);
  }
  return shortcuts;
}

// The badge shows the shortcut, nothing more: the tips and the welcome page
// teach what it does. Screen readers also hear what the keys are.
function updateShortcutHint(rawShortcut) {
  const hintEl = document.getElementById('shortcut-hint');
  if (!hintEl || !rawShortcut) return;
  const label = document.createElement('span');
  label.className = 'visually-hidden';
  label.textContent = `${t('shortcutHintLabel') || 'Your shortcut:'} `;
  const kbd = document.createElement('kbd');
  kbd.textContent = rawShortcut;
  hintEl.replaceChildren(label, kbd);
  // Spread out, the toolbar is a search box alone in the middle (look.js,
  // overview.css): the badge sits inside it, at its end.
  if ('spread' in document.documentElement.dataset) document.querySelector('.search-field')?.append(hintEl);
}

// Spread out, the two switches are icons (look.js, overview.css): each has
// its words as its tooltip.
function nameToggles() {
  if (!('spread' in document.documentElement.dataset)) return;
  for (const text of document.querySelectorAll('.ctrl span')) {
    const label = text.closest('.ctrl');
    if (label) label.title = text.textContent;
  }
}

// Presses that came while the window was loading act once main() is done
// (events.js), even should it fail: the shortcut then still switches or
// closes the window.
// A frame that was refused never acts on one.
function start() {
  main().then((shown) => {
    if (shown !== false) markReady();
  }, (error) => {
    release();
    markReady();
    throw error;
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
