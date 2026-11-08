// tips.js: a tip in the Tab Mission window, one at a time, pointing at what
// it explains. Opened with the shortcut, it points at the selected card (the
// previous tab): "Press ⌘E again to come back here". Opened with a click (the
// toolbar button, or the welcome page's button), at the shortcut badge: "Press
// ⌘E anytime to open Tab Mission". Once the cards have settled, a card the
// pointer picks and stays on gets "Press ⌘E to go to this tab", once per
// window and only while no other tip shows. After a new install each shows
// until its step is done, at most TIP_SHOWS times (tryit.js); with "Show
// tips" on, every time. It has no button and takes neither the pointer nor
// focus: it goes with the window, or once it no longer applies (a key,
// scrolling, resizing, or for a card's tip the selection leaving that card),
// and does not come back.
import { t } from './i18n.js';
import { state } from './state.js';
import { noteTipShown } from './tryit.js';

// Say this to screen readers, through the window's one live region (#status
// in overview.html; '' clears it). A tip and the empty grid use it.
export function announce(text) {
  const status = document.getElementById('status');
  if (status && status.textContent !== text) status.textContent = text;
}

let tip = null;
let blocked = false; // a tip went away in this window: none comes back
// What showTip was given once the cards settled (null until then), for the
// tip on a card the pointer picks; whether that tip has shown in this window,
// and the wait before it does.
let due = null;
let pointShown = false;
let pointTimer = 0;
// How long the pointer stays on a card before its tip shows, so a card it
// only passes over on its way gets none.
const POINT_DELAY_MS = 600;

export function hideTip() {
  blocked = true;
  if (!tip) return;
  const el = tip;
  tip = null;
  // What screen readers can still read goes with it.
  if (document.getElementById('status')?.textContent === el.textContent) announce('');
  el.classList.add('out');
  // Removed after its fade (none with reduced motion, so the timer does it).
  el.addEventListener('animationend', () => el.remove(), { once: true });
  setTimeout(() => el.remove(), 200);
}

// The selection moved: a tip on the card no longer applies (the shortcut
// now goes to the new selection). The badge tip stays.
export function selectionMoved() {
  clearTimeout(pointTimer);
  if (tip?.dataset.anchor === 'card') hideTip();
}

// The pointer picked this card (dom.js): once it has stayed there a moment,
// a tip says that the shortcut goes to it. Not on the current tab's card,
// where the shortcut only closes the window.
export function pointedAt(tile, tab) {
  clearTimeout(pointTimer);
  if (!due || pointShown || tip || tab.id === state.currentTabId) return;
  const { showTips, tryIt, shortcut } = due;
  if (!shortcut || (!showTips && (tryIt.point || !tryIt.tipsLeft.point))) return;
  pointTimer = setTimeout(() => {
    if (tip || !tile.classList.contains('selected') || document.getElementById('root')?.classList.contains('closing')) return;
    pointShown = show('point', tile);
  }, POINT_DELAY_MS);
}

// The message with the shortcut in a <kbd>.
function message(key, shortcut, fallback) {
  const marker = '%KBD%';
  const text = t(key, [marker]) || fallback(marker);
  const [before, after = ''] = text.split(marker);
  const kbd = document.createElement('kbd');
  kbd.textContent = shortcut;
  const el = document.createElement('div');
  el.className = 'tip';
  el.append(before, kbd, after);
  return el;
}

const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

// Centered below the anchor with the arrow pointing at it, or above it when
// there is no room below; kept inside the window.
function place(el, anchor, root) {
  const a = anchor.getBoundingClientRect();
  const r = root.getBoundingClientRect();
  const center = a.left + a.width / 2 - r.left;
  const below = a.bottom - r.top + 12;
  const top = below + el.offsetHeight <= root.clientHeight - 8 ? below : a.top - r.top - el.offsetHeight - 12;
  const left = clamp(center - el.offsetWidth / 2, 8, root.clientWidth - el.offsetWidth - 8);
  el.classList.toggle('above', top !== below);
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
  el.style.setProperty('--arrow-x', `${clamp(center - left, 16, el.offsetWidth - 16)}px`);
}

const TEXTS = {
  open: ['tipOpen', (s) => `Press ${s} anytime to open Tab Mission`],
  back: ['tipBack', (s) => `Press ${s} again to come back here`],
  point: ['tipPoint', (s) => `Press ${s} to go to this tab`],
};

// Called once the cards have settled after opening. shortcut is the assigned
// key as text ('' when none, then there is nothing to teach).
export function showTip(options) {
  due = options;
  const { showTips, tryIt, shortcut, viaClick } = options;
  const search = document.getElementById('search');
  if (blocked || !shortcut || search?.value) return;
  const step = viaClick ? 'open' : 'back';
  if (!showTips && (tryIt[step] || !tryIt.tipsLeft[step])) return;

  let anchor = null;
  if (viaClick) {
    anchor = document.querySelector('#shortcut-hint kbd');
  } else {
    // Only while the previous tab is still the automatic selection: the
    // shortcut goes back there.
    const tab = state.filteredTabs[state.selectedIndex];
    if (tab && state.selectedIndex === state.defaultIndex && tab.id !== state.currentTabId) {
      anchor = document.querySelector(`#grid .tile[data-index="${state.selectedIndex}"]`);
    }
  }
  show(step, anchor);
}

// Show a step's tip at its anchor; whether it showed.
function show(step, anchor) {
  const root = document.getElementById('root');
  // In a small window the tip would cover the cards.
  if (!root || root.clientWidth < 480 || root.clientHeight < 320) return false;
  if (!anchor?.getClientRects().length) return false;

  const { showTips, tryIt, shortcut } = due;
  tip = message(TEXTS[step][0], shortcut, TEXTS[step][1]);
  tip.dataset.anchor = step === 'open' ? 'badge' : 'card';
  root.append(tip);
  place(tip, anchor, root);
  announce(tip.textContent);
  if (!showTips) tryIt.tipsLeft = noteTipShown(step, tryIt.tipsLeft);
  document.getElementById('grid')?.addEventListener('scroll', hideTip, { once: true });
  window.addEventListener('resize', hideTip, { once: true });
  return true;
}
