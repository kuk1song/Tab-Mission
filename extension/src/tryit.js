// tryit.js: which of the welcome page's three "Try it" steps are done, one
// key per step in chrome.storage.session (in memory, cleared when the browser
// quits). background.js records the first step, the overview the other two,
// and the welcome page shows them. Also imported by the service worker, so it
// must not touch the DOM.

// open: a Tab Mission shortcut was pressed (not the toolbar button);
// back: the shortcut pressed in the window switched to a tab;
// search: Enter switched to a tab with search text typed.
export const TRY_IT_KEYS = { open: 'tryItOpen', back: 'tryItBack', search: 'tryItSearch' };

// One key per step, so recording needs no read: the write goes out at once
// and lands even when the overview closes right after a switch (at once with
// reduced motion). Callers do not wait for it; it never throws.
export function recordTryIt(step) {
  try {
    chrome.storage.session.set({ [TRY_IT_KEYS[step]]: true }).catch(() => {});
  } catch {}
}

export async function readTryIt() {
  let stored = {};
  try {
    stored = await chrome.storage.session.get(Object.values(TRY_IT_KEYS));
  } catch {}
  return Object.fromEntries(Object.entries(TRY_IT_KEYS).map(([step, key]) => [step, stored[key] === true]));
}
