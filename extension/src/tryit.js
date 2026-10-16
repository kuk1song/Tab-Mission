// tryit.js: what a new user has learned, saved with chrome.storage.local on
// this computer: the welcome page's two "Try it" steps (open Tab Mission with
// the shortcut; press it again to go back), and how many more times the Tab
// Mission window shows each step's tip on its own. background.js records the
// first step, the overview the second; the welcome page and the overview read
// them. Also imported by the service worker, so it must not touch the DOM.

// open: a Tab Mission shortcut was pressed (not the toolbar button);
// back: the shortcut pressed in the window switched to a tab.
export const TRY_IT_KEYS = { open: 'tryItOpen', back: 'tryItBack' };

// Set on a new install: each step's tip shows until the step is done, at most
// TIP_SHOWS times (users who already know Tab Mission have no count, so they
// see tips only with "Show tips" on).
export const TIPS_KEY = 'tipsLeft';
export const TIP_SHOWS = 3;

// One key per step, so recording needs no read: the write goes out at once
// and lands even when the overview closes right after a switch (at once with
// reduced motion). Callers do not wait for it; it never throws.
export function recordTryIt(step) {
  try {
    chrome.storage.local.set({ [TRY_IT_KEYS[step]]: true }).catch(() => {});
  } catch {}
}

// A new install (background.js).
export function startTips() {
  try {
    chrome.storage.local.set({ [TIPS_KEY]: { open: TIP_SHOWS, back: TIP_SHOWS } }).catch(() => {});
  } catch {}
}

// A tip shown on its own uses up one of its showings. left is tipsLeft as
// read when the window opened (only one Tab Mission window is open at a time).
export function noteTipShown(step, left) {
  try {
    chrome.storage.local.set({ [TIPS_KEY]: { ...left, [step]: Math.max(0, left[step] - 1) } }).catch(() => {});
  } catch {}
}

export async function readTryIt() {
  let stored = {};
  try {
    stored = await chrome.storage.local.get([...Object.values(TRY_IT_KEYS), TIPS_KEY]);
  } catch {}
  const steps = Object.keys(TRY_IT_KEYS);
  const left = stored[TIPS_KEY] ?? {};
  return {
    ...Object.fromEntries(steps.map((step) => [step, stored[TRY_IT_KEYS[step]] === true])),
    tipsLeft: Object.fromEntries(steps.map((step) => [step, Number.isInteger(left[step]) && left[step] > 0 ? left[step] : 0])),
  };
}
