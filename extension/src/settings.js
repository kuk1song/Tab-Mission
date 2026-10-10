// src/settings.js

const DEFAULTS = {
  showSleeping: false,
  showAllWindows: false,
  // On by default: the previous tab is pre-selected, so pressing the
  // shortcut twice goes back to it (Alt+Tab style). Off (options page):
  // nothing is selected on open, so pressing it twice closes the overview.
  preselectPrevious: true,
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
