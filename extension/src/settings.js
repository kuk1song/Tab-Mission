// src/settings.js

// Set by an update from 1.x (background.js) until the overview has said,
// once, that the cards are now spread out and where the grid is (tips.js).
export const LOOK_NOTICE_KEY = 'lookNotice';

// Also read by background.js, which opens the overview by them.
export const DEFAULTS = {
  showSleeping: false,
  showAllWindows: false,
  // On by default: the previous tab is pre-selected, so pressing the
  // shortcut twice goes back to it (Alt+Tab style). Off (options page):
  // nothing is selected on open, so pressing it twice closes the overview.
  preselectPrevious: true,
  // Off by default: tips in the Tab Mission window show only after a new
  // install, until learned and at most a few times (tips.js). On (settings
  // page): every time.
  showTips: false,
  // On by default (off on the settings page, under Classic mode: only the
  // grid groups): while browsing, the five most recent tabs, then the tabs
  // grouped by site in tab-strip order (state.js), at any window size and
  // number of tabs. Not "artMode": updates delete that old key
  // (background.js).
  groupBySite: true,
  // 'system' follows the system's light or dark appearance; 'light' or
  // 'dark' fixes it for the Tab Mission window (settings page).
  appearance: 'system',
  // What is behind the cards (backdrop.js): 'page' (the default since 2.0),
  // a blurred picture of the page you were on; 'wallpaper', colors of Tab
  // Mission's own; or 'plain'.
  backdrop: 'page',
  // On by default (2.0), "Art mode" on the settings page: the cards spread
  // out, the tabs used more recently larger, every one in view while they
  // fit (spread.js). Off, "Classic mode": the grid.
  spread: true,
  // In Art mode: how much the overview covers. 'page', the page only, the tab
  // strip in view: a layer over the page in front, or where a page takes
  // none, a window over the page (background.js, src/host.js); 'window', the
  // whole browser window (a window of its own over it).
  openAs: 'page',
  // On by default (off on the settings page): the service worker takes
  // pictures of the pages you look at for their cards (covers.js). Off, it
  // takes none and deletes the ones it kept.
  pagePictures: true,
};

/**
 * Loads settings from chrome.storage.local.
 * Merges them with defaults to ensure all keys are present.
 * @returns {Promise<Object>} A promise that resolves to the settings object.
 */
export async function loadSettings() {
  // Defensive check for environments where chrome APIs are not available
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
    console.warn('chrome.storage.local is not available, falling back to defaults.');
    return { ...DEFAULTS };
  }
  try {
    const storedSettings = await chrome.storage.local.get(DEFAULTS);
    return { ...DEFAULTS, ...storedSettings };
  } catch (error) {
    console.warn('Could not load settings, falling back to defaults.', error);
    return { ...DEFAULTS };
  }
}

/**
 * Saves a settings object to chrome.storage.local.
 * @param {Object} settings The settings object to save.
 * @returns {Promise<boolean>} Whether the settings were saved.
 */
export async function saveSettings(settings) {
  // Defensive check for environments where chrome APIs are not available
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
    return false;
  }
  try {
    await chrome.storage.local.set(settings);
    return true;
  } catch (error) {
    console.warn('Could not save settings.', error);
    return false;
  }
}
