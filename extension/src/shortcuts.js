// shortcuts.js: show Tab Mission's shortcuts and send the user to change them
// (settings and welcome pages).

// The keys of a shortcut as chrome.commands reports it: "Ctrl+Shift+E" on
// Windows, Linux and ChromeOS, "⇧⌘E" on Mac (modifier symbols, no separator).
export function shortcutKeys(shortcut) {
  if (!shortcut) return [];
  if (shortcut.includes('+')) return shortcut.split(/\+(?=.)/);
  const [, modifiers, key] = /^([⌃⌥⇧⌘]*)(.*)$/u.exec(shortcut);
  return [...modifiers, ...(key ? [key] : [])];
}

// The event property that reports each modifier as held, by its name on Mac
// and elsewhere ("Ctrl" is Control outside a Mac; on a Mac Chrome reports ⌘).
const MODIFIERS = {
  '⌘': 'metaKey', '⌃': 'ctrlKey', '⌥': 'altKey', '⇧': 'shiftKey',
  Ctrl: 'ctrlKey', Alt: 'altKey', Shift: 'shiftKey',
};
const EVENT_MODIFIERS = ['metaKey', 'ctrlKey', 'altKey', 'shiftKey'];

// With a shortcut's modifiers held (⌘ for ⌘E, Ctrl and Shift for
// Ctrl+Shift+E), its last key is the one left to press: { key, modifiers },
// the modifiers as event properties. null for no shortcut, or one without a
// modifier.
export function finishingKey(shortcut) {
  const keys = shortcutKeys(shortcut);
  const modifiers = keys.slice(0, -1).map((name) => MODIFIERS[name]);
  if (keys.length < 2 || modifiers.some((m) => !m)) return null;
  return { key: keys.at(-1), modifiers };
}

// Whether a key or pointer event has exactly these modifiers down: with one
// more, the key would not press the shortcut.
export function holdsModifiers(event, modifiers) {
  return EVENT_MODIFIERS.every((m) => Boolean(event[m]) === modifiers.includes(m));
}

// Only the user can change an extension's shortcuts, at
// chrome://extensions/shortcuts, and Chrome cannot open that page at one
// extension. Firefox's commands.openShortcutSettings() does; use it if Chrome
// adds it.
export async function openShortcutSettings() {
  if (typeof chrome.commands?.openShortcutSettings === 'function') {
    return chrome.commands.openShortcutSettings();
  }
  return chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
}
