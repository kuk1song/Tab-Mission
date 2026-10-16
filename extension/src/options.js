// options.js: the settings page (the gear in Tab Mission, or right-click the
// toolbar icon, then Options).
import { localizeStaticText, t } from './i18n.js';
import { loadSettings, saveSettings } from './settings.js';
import { shortcutKeys, openShortcutSettings } from './shortcuts.js';
import { resetTryIt } from './tryit.js';

async function main() {
  const preselect = document.getElementById('preselect-previous');
  try {
    localizeStaticText();
    const { version } = chrome.runtime.getManifest();
    document.getElementById('version').textContent = t('optionVersion', [version]) || `Version ${version}`;
    const [settings] = await Promise.all([loadSettings(), showShortcuts()]);
    preselect.checked = settings.preselectPrevious;
  } finally {
    reveal(preselect);
  }
  preselect.addEventListener('change', async () => {
    const saved = await saveSettings({ preselectPrevious: preselect.checked });
    // The switch shows the new state; screen readers also hear "Saved."
    if (saved) announce(t('optionSaved') || 'Saved.');
  });
  // The welcome page's steps, from the first one, in a new tab.
  document.getElementById('open-guide').addEventListener('click', async () => {
    await resetTryIt();
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') }).catch(() => {});
  });
  // Refresh after the user changes a shortcut in the tab opened from here.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) showShortcuts();
  });
}

// Show the page once the text, the saved setting and the shortcut are in
// place. Reading the knob's style applies the saved state while transitions
// are still off, so removing the class afterwards starts no slide.
function reveal(preselect) {
  void getComputedStyle(preselect, '::before').transform;
  document.documentElement.classList.remove('loading');
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
