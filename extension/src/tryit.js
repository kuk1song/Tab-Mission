// tryit.js: what a new user has learned, saved with chrome.storage.local on
// this computer: the welcome page's two "Try it" steps (open Tab Mission with
// the shortcut; press it again to go back), and whether the tips in the Tab
// Mission window are still due. background.js records the first step, the
// overview the second; the welcome page and the overview read them. Also
// imported by the service worker, so it must not touch the DOM.

// open: a Tab Mission shortcut was pressed (not the toolbar button);
// back: the shortcut pressed in the window switched to a tab.
export const TRY_IT_KEYS = { open: 'tryItOpen', back: 'tryItBack' };

// Set on a new install and by the settings page's Getting started: until
// then, users who already know Tab Mission never see the window's tips
// (unless they turn on "Show tips"). "Got it" on a tip clears it.
export const TIPS_DUE_KEY = 'tipsDue';

// One key per step, so recording needs no read: the write goes out at once
// and lands even when the overview closes right after a switch (at once with
// reduced motion). Callers do not wait for it; it never throws.
export function recordTryIt(step) {
  try {
    chrome.storage.local.set({ [TRY_IT_KEYS[step]]: true }).catch(() => {});
  } catch {}
}

// "Got it" on a tip: no more tips until Getting started.
export function stopTips() {
  try {
    chrome.storage.local.set({ [TIPS_DUE_KEY]: false }).catch(() => {});
  } catch {}
}

// Start over (the settings page's Getting started): both steps undone and
// the window's tips due again.
export async function resetTryIt() {
  try {
    await chrome.storage.local.remove(Object.values(TRY_IT_KEYS));
    await chrome.storage.local.set({ [TIPS_DUE_KEY]: true });
  } catch {}
}

export async function readTryIt() {
  let stored = {};
  try {
    stored = await chrome.storage.local.get([...Object.values(TRY_IT_KEYS), TIPS_DUE_KEY]);
  } catch {}
  return {
    ...Object.fromEntries(Object.entries(TRY_IT_KEYS).map(([step, key]) => [step, stored[key] === true])),
    tipsDue: stored[TIPS_DUE_KEY] === true,
  };
}
