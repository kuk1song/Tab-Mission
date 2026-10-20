// options.js: the settings page (the gear in Tab Mission, or right-click the
// toolbar icon, then Options).
import { localizeStaticText, t } from './i18n.js';
import { loadSettings, saveSettings } from './settings.js';
import { shortcutKeys, openShortcutSettings } from './shortcuts.js';

async function main() {
  const preselect = document.getElementById('preselect-previous');
  const showTips = document.getElementById('show-tips');
  const groupBySite = document.getElementById('group-by-site');
  try {
    localizeStaticText();
    const { version } = chrome.runtime.getManifest();
    document.getElementById('version').textContent = t('optionVersion', [version]) || `Version ${version}`;
    const [settings] = await Promise.all([loadSettings(), showShortcuts()]);
    preselect.checked = settings.preselectPrevious;
    showTips.checked = settings.showTips;
    groupBySite.checked = settings.groupBySite;
  } finally {
    reveal(preselect);
  }
  // Each switch saves at once; the switch shows the new state and screen
  // readers also hear "Saved."
  for (const [input, key] of [[preselect, 'preselectPrevious'], [groupBySite, 'groupBySite'], [showTips, 'showTips']]) {
    input.addEventListener('change', async () => {
      if (await saveSettings({ [key]: input.checked })) announce(t('optionSaved') || 'Saved.');
    });
  }
  // Refresh after the user changes a shortcut in the tab opened from here
  // (Chrome has no event for it): on coming back to this tab or window.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) showShortcuts();
  });
  window.addEventListener('focus', () => showShortcuts());
}

// Show the page once the text, the saved settings and the shortcut are in
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
