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
