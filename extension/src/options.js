// options.js: the settings page (right-click the toolbar icon, then Options).
import { localizeStaticText, t } from './i18n.js';
import { loadSettings, saveSettings } from './settings.js';

async function main() {
  localizeStaticText();

  const settings = await loadSettings();
  const current = settings.preselectPrevious ? 'previous' : 'none';
  for (const radio of document.querySelectorAll('input[name="open-selection"]')) {
    radio.checked = radio.value === current;
    radio.addEventListener('change', async () => {
      await saveSettings({ preselectPrevious: radio.value === 'previous' });
      document.getElementById('saved').hidden = false;
    });
  }

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

  document.getElementById('set-shortcut').addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });
}

main();
