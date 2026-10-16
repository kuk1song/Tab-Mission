// tips.js: tips in the Tab Mission window, one at a time, next to what they
// explain. On the selected card (the previous tab): "Press ⌘E again to come
// back here". Opened with the toolbar button: "Next time, press ⌘E on any
// page to open Tab Mission". Shown after a new install until the step is
// done, or every time with "Show tips" on in the settings. A key, the pointer
// choosing another card, scrolling or resizing hides the tip for this window.
import { t } from './i18n.js';
import { state } from './state.js';
import { stopTips } from './tryit.js';

let tip = null;
let blocked = false; // hidden once in this window: not shown again

export function hideTip() {
  blocked = true;
  tip?.remove();
  tip = null;
}

// The message with the shortcut in a <kbd>.
function withKbd(key, shortcut, fallback) {
  const marker = '%KBD%';
  const text = t(key, [marker]) || fallback(marker);
  const [before, after = ''] = text.split(marker);
  const kbd = document.createElement('kbd');
  kbd.textContent = shortcut;
  const span = document.createElement('span');
  span.append(before, kbd, after);
  return span;
}

function build(className, message, { showTips }) {
  const el = document.createElement('div');
  el.className = className;
  el.setAttribute('role', 'status');
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = t('tipDismiss') || 'Got it';
  button.addEventListener('click', () => {
    // With "Show tips" on, only this tip goes away.
    if (!showTips) stopTips();
    hideTip();
    document.getElementById('search')?.focus();
  });
  el.append(message, button);
  return el;
}

// Called once the cards have settled after opening. shortcut is the assigned
// key as text ('' when none, then there is nothing to teach).
export function showTip({ showTips, tryIt, shortcut, viaToolbar }) {
  const root = document.getElementById('root');
  const search = document.getElementById('search');
  if (blocked || !shortcut || !root || search?.value) return;
  // In a small window the tip would cover the cards.
  if (root.clientWidth < 480 || root.clientHeight < 320) return;
  const due = (step) => showTips || (tryIt.tipsDue && !tryIt[step]);

  if (viaToolbar && due('open')) {
    tip = build('tip tip-bar', withKbd('tipToolbar', shortcut, (s) => `Next time, press ${s} on any page to open Tab Mission`), { showTips });
    root.append(tip);
    return;
  }

  const card = state.selectedIndex === -1 ? null : document.querySelector(`#grid .tile[data-index="${state.selectedIndex}"]`);
  if (!card || !due('back')) return;
  tip = build('tip tip-card', withKbd('tipBack', shortcut, (s) => `Press ${s} again to come back here`), { showTips });
  root.append(tip);
  // Below the card, or above it when there is no room below.
  const c = card.getBoundingClientRect();
  const r = root.getBoundingClientRect();
  const below = c.bottom - r.top + 12;
  const top = below + tip.offsetHeight <= root.clientHeight - 8 ? below : c.top - r.top - tip.offsetHeight - 12;
  tip.classList.toggle('above', top < below);
  tip.style.top = `${top}px`;
  tip.style.left = `${Math.max(8, Math.min(c.left - r.left, root.clientWidth - tip.offsetWidth - 8))}px`;
  document.getElementById('grid')?.addEventListener('scroll', hideTip, { once: true });
  window.addEventListener('resize', hideTip, { once: true });
}
