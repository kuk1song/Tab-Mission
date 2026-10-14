// welcome.js: first-install page. Shows the overview shortcut (or explains
// that Chrome could not assign one) and a few usage tips.
import { localizeStaticText, t } from './i18n.js';
import { openShortcutSettings } from './shortcuts.js';

function formatShortcut(shortcut) {
  return shortcut ? shortcut.replace(/\+/g, ' + ') : '';
}

// Fill a message that contains one $shortcut$ placeholder with a <kbd>.
function setWithKbd(el, key, shortcut, fallback) {
  const marker = '%KBD%';
  const text = t(key, [marker]) || fallback(marker);
  const [before, after = ''] = text.split(marker);
  const kbd = document.createElement('kbd');
  kbd.textContent = shortcut;
  el.replaceChildren(before, kbd, after);
}

// Called again whenever the page becomes visible, so a shortcut chosen at
// chrome://extensions/shortcuts shows up on return.
async function showShortcut() {
  let commands = [];
  try {
    commands = await chrome.commands.getAll();
  } catch {}
  const openShortcut = formatShortcut(commands.find((c) => c.name === 'open-overview')?.shortcut);

  const lead = document.getElementById('lead');
  lead.hidden = !openShortcut;
  document.getElementById('no-shortcut').hidden = Boolean(openShortcut);
  document.getElementById('set-shortcut').textContent = openShortcut
    ? (t('changeShortcutTitle') || 'Change shortcut')
    : (t('welcomeSetShortcut') || 'Choose shortcut');
  if (openShortcut) {
    setWithKbd(lead, 'welcomeLead', openShortcut, (s) => `Press ${s} anywhere in Chrome to see all your tabs.`);
  }
}

async function showPinHint() {
  try {
    const { isOnToolbar } = await chrome.action.getUserSettings();
    document.getElementById('pin').hidden = isOnToolbar;
  } catch {}
}

async function main() {
  try {
    localizeStaticText();
    setWithKbd(document.getElementById('tip-site'), 'welcomeTipSite', 'Tab',
      (s) => `Press ${s} in the search box to see only the tabs from the site you are on.`);
    await Promise.all([showShortcut(), showPinHint()]);
  } finally {
    // Shown complete, a few frames after load (see welcome.css).
    document.documentElement.classList.remove('loading');
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) showShortcut();
  });

  document.getElementById('try').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'openOverview' }).catch(() => {});
  });
  document.getElementById('set-shortcut').addEventListener('click', () => {
    openShortcutSettings().catch(() => {});
  });
}

main();
