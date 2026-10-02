// src/settings.js

const DEFAULTS = {
  showSleeping: false,
  showAllWindows: false,
  artMode: false,
  // Off by default: nothing is selected on open, so pressing the shortcut
  // twice closes the overview. On (options page): the previous tab is
  // pre-selected, so pressing it twice goes back to it (Alt+Tab style).
  preselectPrevious: false,
  // Add other settings here as needed
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
 * @returns {Promise<void>} A promise that resolves when saving is complete.
 */
export async function saveSettings(settings) {
  // Defensive check for environments where chrome APIs are not available
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
    return; // Silently fail if storage is not available
  }
  try {
    await chrome.storage.local.set(settings);
  } catch (error) {
    console.warn('Could not save settings.', error);
  }
}
