// options.js: the settings page (the gear in the overview, or right-click the
// toolbar icon, then Options).
import { localizeStaticText, t } from './i18n.js';
import { loadSettings, saveSettings } from './settings.js';

async function main() {
  localizeStaticText();

  const settings = await loadSettings();
  const preselect = document.getElementById('preselect-previous');
  preselect.checked = settings.preselectPrevious;
  preselect.addEventListener('change', async () => {
    const saved = await saveSettings({ preselectPrevious: preselect.checked });
    document.getElementById('saved').hidden = !saved;
  });

  // TEMPORARY A/B experiments.
  for (const [id, key] of [['exp-window', 'experimentWindowSizing'], ['exp-grid', 'experimentGrid']]) {
    const select = document.getElementById(id);
    select.value = settings[key];
    select.addEventListener('change', async () => {
      const saved = await saveSettings({ [key]: select.value });
      document.getElementById('saved').hidden = !saved;
    });
  }

  await showShortcuts();
  // Refresh after the user changes a shortcut in the tab opened below.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) showShortcuts();
  });

  document.getElementById('set-shortcut').addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });
}

async function showShortcuts() {
  let commands = [];
  try {
    commands = await chrome.commands.getAll();
  } catch {}
  const notSet = t('shortcutNotSet') || 'not set';
  const lines = commands
    .filter((c) => c.name !== '_execute_action')
    .map((c) => {
      const row = document.createElement('div');
      const kbd = document.createElement('kbd');
      kbd.textContent = c.shortcut ? c.shortcut.replace(/\+/g, ' + ') : notSet;
      row.append(kbd, ` ${c.description}`);
      return row;
    });
  document.getElementById('shortcuts').replaceChildren(...lines);
}

main();
