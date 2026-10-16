// tips.js: a tip in the Tab Mission window, at most one, pointing at what it
// explains. Opened with the shortcut, it points at the selected card (the
// previous tab): "Press ⌘E again to come back here". Opened with a click (the
// toolbar button, or the welcome page's button), at the shortcut badge: "Next
// time, press ⌘E on any page to open Tab Mission". After a new install each shows until its step is done, at most
// TIP_SHOWS times (tryit.js); with "Show tips" on, every time. It has no
// button and takes neither the pointer nor focus: it goes with the window,
// or once it no longer applies (a key, scrolling, resizing, or for the card
// tip the selection leaving that card), and does not come back.
import { t } from './i18n.js';
import { state } from './state.js';
import { noteTipShown } from './tryit.js';

let tip = null;
let blocked = false; // a tip went away in this window: none comes back

export function hideTip() {
  blocked = true;
  if (!tip) return;
  const el = tip;
  tip = null;
  el.classList.add('out');
  // Removed after its fade (none with reduced motion, so the timer does it).
  el.addEventListener('animationend', () => el.remove(), { once: true });
  setTimeout(() => el.remove(), 200);
}

// The selection moved: a tip on the card no longer applies (the shortcut
// now goes to the new selection). The badge tip stays.
export function selectionMoved() {
  if (tip?.dataset.anchor === 'card') hideTip();
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
  el.setAttribute('role', 'status');
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

// Called once the cards have settled after opening. shortcut is the assigned
// key as text ('' when none, then there is nothing to teach).
export function showTip({ showTips, tryIt, shortcut, viaClick }) {
  const root = document.getElementById('root');
  const search = document.getElementById('search');
  if (blocked || !shortcut || !root || search?.value) return;
  // In a small window the tip would cover the cards.
  if (root.clientWidth < 480 || root.clientHeight < 320) return;
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
  if (!anchor?.getClientRects().length) return;

  tip = viaClick
    ? message('tipOpen', shortcut, (s) => `Next time, press ${s} on any page to open Tab Mission`)
    : message('tipBack', shortcut, (s) => `Press ${s} again to come back here`);
  tip.dataset.anchor = viaClick ? 'badge' : 'card';
  root.append(tip);
  place(tip, anchor, root);
  if (!showTips) noteTipShown(step, tryIt.tipsLeft);
  document.getElementById('grid')?.addEventListener('scroll', hideTip, { once: true });
  window.addEventListener('resize', hideTip, { once: true });
}
