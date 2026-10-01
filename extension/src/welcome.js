// welcome.js: first-install page. Shows the assigned shortcuts (or explains
// that Chrome could not assign one) and a few usage tips.
import { localizeStaticText, t } from './i18n.js';

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

async function main() {
  localizeStaticText();

  let commands = [];
  try {
    commands = await chrome.commands.getAll();
  } catch {}
  const shortcutOf = (name) => formatShortcut(commands.find((c) => c.name === name)?.shortcut);
  const notSet = t('shortcutNotSet') || 'not set';

  const openShortcut = shortcutOf('open-overview');
  const lead = document.getElementById('lead');
  if (openShortcut) {
    setWithKbd(lead, 'welcomeLead', openShortcut, (s) => `Press ${s} anywhere in Chrome to see all your tabs.`);
  } else {
    lead.hidden = true;
    document.getElementById('no-shortcut').hidden = false;
    document.getElementById('set-shortcut').textContent = t('welcomeSetShortcut') || 'Choose shortcut';
  }

  setWithKbd(document.getElementById('tip-site'), 'welcomeTipSite', shortcutOf('open-overview-site') || notSet,
    (s) => `Site view (${s}): shows only the tabs from the site you are on.`);

  try {
    const { isOnToolbar } = await chrome.action.getUserSettings();
    document.getElementById('pin').hidden = isOnToolbar;
  } catch {}

  document.getElementById('try').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'openOverview' }).catch(() => {});
  });
  document.getElementById('set-shortcut').addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });
}

main();
