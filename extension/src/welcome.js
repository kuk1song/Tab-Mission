// welcome.js: first-install page. Shows the overview shortcut (or explains
// that Chrome could not assign one), a "Try it" checklist that ticks itself
// as the user does each step (progress kept by tryit.js), and a few tips.
import { localizeStaticText, t } from './i18n.js';
import { openShortcutSettings } from './shortcuts.js';
import { TRY_IT_KEYS, readTryIt } from './tryit.js';

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

  document.getElementById('no-shortcut').hidden = Boolean(openShortcut);
  document.getElementById('set-shortcut').textContent = openShortcut
    ? (t('changeShortcutTitle') || 'Change shortcut')
    : (t('welcomeSetShortcut') || 'Choose shortcut');

  const openStep = document.querySelector('#step-open .step-text');
  if (openShortcut) {
    setWithKbd(openStep, 'welcomeStepOpen', openShortcut, (s) => `Press ${s} on any page to open Tab Mission.`);
  } else {
    openStep.textContent = t('welcomeStepOpenUnset') || 'Choose a shortcut, then press it to open Tab Mission.';
  }
}

async function showPinHint() {
  try {
    const { isOnToolbar } = await chrome.action.getUserSettings();
    document.getElementById('pin').hidden = isOnToolbar;
  } catch {}
}

const STEPS = Object.keys(TRY_IT_KEYS);
// The steps as last shown, so a change can announce only what is new.
let shown = { open: false, back: false };

function stepItem(step) {
  return document.getElementById(`step-${step}`);
}

// Tick the steps that are done: a check mark in place of the number, and the
// state written out ("Done", or "Not done yet" for screen readers only). A
// live change is also announced, with "You're all set" once both are done.
// Steps only ever become done, so a slower read never unticks one.
function showTryIt(value, { announce = false } = {}) {
  const done = Object.fromEntries(STEPS.map((step) => [step, value[step] || shown[step]]));
  const newlyDone = STEPS.filter((step) => done[step] && !shown[step]);
  shown = done;

  for (const step of STEPS) {
    const item = stepItem(step);
    item.classList.toggle('done', done[step]);
    item.querySelector('.step-state').textContent = done[step]
      ? (t('welcomeStepDone') || 'Done')
      : (t('welcomeStepTodo') || 'Not done yet');
  }
  const allSet = STEPS.every((step) => done[step]);
  document.getElementById('all-set').hidden = !allSet;

  if (announce && newlyDone.length > 0) {
    const parts = [];
    for (const step of newlyDone) {
      const text = stepItem(step).querySelector('.step-text').textContent;
      parts.push(t('welcomeStepAnnounce', [text]) || `Done: ${text}`);
      stepItem(step).classList.add('just-done');
    }
    if (allSet) parts.push(document.getElementById('all-set').textContent);
    document.getElementById('try-status').textContent = parts.join(' ');
  }
}

async function main() {
  // Steps done in Tab Mission while this page is open tick here at once.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const changed = STEPS.filter((step) => TRY_IT_KEYS[step] in changes);
    if (changed.length === 0) return;
    const done = { ...shown };
    for (const step of changed) done[step] = changes[TRY_IT_KEYS[step]].newValue === true;
    showTryIt(done, { announce: true });
  });
  try {
    localizeStaticText();
    setWithKbd(document.getElementById('tip-site'), 'welcomeTipSite', 'Tab',
      (s) => `When the site you are on has several tabs open, press ${s} in the search box to see only its tabs.`);
    const [, , done] = await Promise.all([showShortcut(), showPinHint(), readTryIt()]);
    showTryIt(done);
  } finally {
    // Shown complete, a few frames after load (see welcome.css).
    document.documentElement.classList.remove('loading');
  }
  // A shortcut changed at chrome://extensions/shortcuts shows on coming back
  // to this tab or window (Chrome has no event for it).
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) showShortcut();
  });
  window.addEventListener('focus', () => showShortcut());
  document.getElementById('try-it').addEventListener('animationend', (e) => {
    e.target.closest('.step')?.classList.remove('just-done');
  });

  // The second click of a double click is not a second press: it would reach
  // the window the first click opened as a press of the shortcut, and switch
  // tabs (ticking the second step without the shortcut).
  document.getElementById('try').addEventListener('click', (e) => {
    if (e.detail > 1) return;
    chrome.runtime.sendMessage({ action: 'openOverview' }).catch(() => {});
  });
  document.getElementById('set-shortcut').addEventListener('click', () => {
    openShortcutSettings().catch(() => {});
  });
}

main();
