// shortcuts.js: show Tab Mission's shortcuts and send the user to change them
// (settings and welcome pages), and know one pressed in the overview, and the
// key that closes the selected card there.

// The keys of a shortcut as chrome.commands reports it: "Ctrl+Shift+E" on
// Windows, Linux and ChromeOS, "⇧⌘E" on Mac (modifier symbols, no separator).
export function shortcutKeys(shortcut) {
  if (!shortcut) return [];
  if (shortcut.includes('+')) return shortcut.split(/\+(?=.)/);
  const [, modifiers, key] = /^([⌃⌥⇧⌘]*)(.*)$/u.exec(shortcut);
  return [...modifiers, ...(key ? [key] : [])];
}

// Whether a key press is a shortcut as chrome.commands reports it (or as the
// overview's badge shows it, "Ctrl + Shift + E"): the same modifiers, no
// others, and the key, by its place on the keyboard or by what it types. A
// shortcut with a key this cannot name (a symbol in a Mac shortcut, a media
// key) never matches.
const MODIFIERS = {
  '⌘': 'metaKey', Command: 'metaKey',
  '⌃': 'ctrlKey', Ctrl: 'ctrlKey', MacCtrl: 'ctrlKey',
  '⌥': 'altKey', Alt: 'altKey',
  '⇧': 'shiftKey', Shift: 'shiftKey',
};

export function isShortcut(e, shortcut) {
  const keys = shortcutKeys(shortcut).map((k) => k.trim());
  const key = keys.pop();
  if (!key || !keys.length || keys.some((k) => !MODIFIERS[k])) return false;
  const held = new Set(keys.map((k) => MODIFIERS[k]));
  if (!['metaKey', 'ctrlKey', 'altKey', 'shiftKey'].every((m) => Boolean(e[m]) === held.has(m))) return false;
  const place = String(e.code).replace(/^(Key|Digit|Arrow)/, '');
  return place === key || String(e.key).toUpperCase() === key;
}

// Whether a key press closes the selected card (events.js). Shift+Delete, the
// key that removes a highlighted suggestion in Chrome's address bar
// (Shift+fn+Delete on a Mac), unless text is selected in the search box
// (Windows cuts it); and Shift+Backspace while the box is empty, which a Mac
// laptop can type without fn and which never takes a character from the
// text. Shift and no other modifier. box: the search box's value, selection
// and whether it has focus.
export function isCloseKey(e, box) {
  if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.key === 'Delete') return !(box.focused && box.selectionStart !== box.selectionEnd);
  return e.key === 'Backspace' && box.value === '';
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
