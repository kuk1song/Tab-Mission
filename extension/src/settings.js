// src/settings.js

const DEFAULTS = {
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
  // Off by default (settings page): while browsing, the most recent tabs
  // stay first and the rest follow grouped by site, in tab-strip order
  // (state.js). Not "artMode": updates delete that old key (background.js).
  groupBySite: false,
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
