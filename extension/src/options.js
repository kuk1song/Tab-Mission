// options.js: the settings page (the gear in Tab Mission, or right-click the
// toolbar icon, then Options).
import { localizeStaticText, t } from './i18n.js';
import { loadSettings, saveSettings } from './settings.js';
import { shortcutKeys, openShortcutSettings } from './shortcuts.js';

async function main() {
  localizeStaticText();

  const { version } = chrome.runtime.getManifest();
  document.getElementById('version').textContent = t('optionVersion', [version]) || `Version ${version}`;

  const settings = await loadSettings();
  const preselect = document.getElementById('preselect-previous');
  preselect.checked = settings.preselectPrevious;
  preselect.addEventListener('change', async () => {
    const saved = await saveSettings({ preselectPrevious: preselect.checked });
    // The switch shows the new state; screen readers also hear "Saved."
    if (saved) announce(t('optionSaved') || 'Saved.');
  });

  await showShortcuts();
  // Refresh after the user changes a shortcut in the tab opened from here.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) showShortcuts();
  });
}

// A live region repeats a message only when its text changes, so clear it
// first (every change of the switch is announced).
function announce(message) {
  const status = document.getElementById('saved');
  status.textContent = '';
  requestAnimationFrame(() => {
    status.textContent = message;
  });
}

async function showShortcuts() {
  let commands = [];
  try {
    commands = await chrome.commands.getAll();
  } catch {}
  // Only the main shortcut. The optional site shortcut (no default) stays on
  // Chrome's shortcuts page: Tab in the search box does the same.
  const rows = commands
    .filter((c) => c.name === 'open-overview')
    .map(shortcutRow);
  document.getElementById('shortcuts').replaceChildren(...rows);
}

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

// The command's name (Chrome's own description of it) on the left; its keys
// (or "Not set") and a button that opens Chrome's shortcuts page in a new tab
// on the right.
function shortcutRow(command) {
  const title = element('div', 'title', command.description);
  title.id = `command-${command.name}`;
  const text = element('div', 'text');
  text.append(title);

  const keys = shortcutKeys(command.shortcut);
  const control = element('div', 'control');
  if (keys.length) {
    const combo = element('kbd', 'combo');
    combo.append(...keys.map((key) => element('kbd', '', key)));
    control.append(combo);
  } else {
    control.append(element('span', 'unset', t('shortcutNotSet') || 'Not set'));
  }
  // Without a shortcut Tab Mission opens only from the toolbar, so adding one
  // stands out.
  const button = element('button', keys.length ? 'external' : 'external primary',
    keys.length ? (t('shortcutChange') || 'Change') : (t('shortcutSet') || 'Add'));
  button.type = 'button';
  button.setAttribute('aria-describedby', title.id);
  button.addEventListener('click', () => {
    openShortcutSettings().catch(() => {});
  });
  control.append(button);

  const row = element('div', 'row');
  row.append(text, control);
  return row;
}

main();
