// tryit.js: what a new user has learned, saved with chrome.storage.local on
// this computer: the welcome page's three "Try it" steps (open Tab Mission
// with the shortcut; press it again to go back; point at a card and press
// it), and how many more times the Tab Mission window shows each step's tip
// on its own. background.js records the first step, the overview the others;
// the welcome page and the overview read them. Also imported by the service
// worker, so it must not touch the DOM.

// open: a Tab Mission shortcut was pressed (not the toolbar button);
// back: the shortcut pressed in the window switched to a tab;
// point: it switched to the card the pointer had picked.
export const TRY_IT_KEYS = { open: 'tryItOpen', back: 'tryItBack', point: 'tryItPoint' };

// Set on a new install: each step's tip shows until the step is done, at most
// TIP_SHOWS times (users who already know Tab Mission have no count, so they
// see tips only with "Show tips" on).
const TIPS_KEY = 'tipsLeft';
const TIP_SHOWS = 3;

// One key per step, so recording needs no read: the write goes out at once
// and lands even when the overview closes right after a switch (at once with
// reduced motion). Steps done by one press go in one write, so the welcome
// page announces them together. Callers do not wait for it; it never throws.
export function recordTryIt(...steps) {
  try {
    chrome.storage.local.set(Object.fromEntries(steps.map((step) => [TRY_IT_KEYS[step], true]))).catch(() => {});
  } catch {}
}

// A new install (background.js).
export function startTips() {
  try {
    // The mark is measurement only (test/measure-install-timing), not for
    // merge: tests/e2e/fixtures.mjs reads when the write resolved.
    chrome.storage.local.set({ [TIPS_KEY]: Object.fromEntries(Object.keys(TRY_IT_KEYS).map((step) => [step, TIP_SHOWS])) })
      .then(() => performance.mark('tm:tips-written')).catch(() => {});
  } catch {}
}

// A tip shown on its own uses up one of its showings. left is tipsLeft as
// read when the window opened, or as this returned for an earlier tip in the
// same window (only one Tab Mission window is open at a time); returns what
// is left now.
export function noteTipShown(step, left) {
  const now = { ...left, [step]: Math.max(0, left[step] - 1) };
  try {
    chrome.storage.local.set({ [TIPS_KEY]: now }).catch(() => {});
  } catch {}
  return now;
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
