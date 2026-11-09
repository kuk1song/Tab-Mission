import { describe, it, expect, vi } from 'vitest';
import { shortcutKeys, isShortcut, openShortcutSettings } from '../extension/src/shortcuts.js';

describe('shortcutKeys', () => {
  it('splits Windows, Linux and ChromeOS shortcuts at "+"', () => {
    expect(shortcutKeys('Ctrl+Shift+E')).toEqual(['Ctrl', 'Shift', 'E']);
    expect(shortcutKeys('Alt+Comma')).toEqual(['Alt', 'Comma']);
  });
  it('splits Mac shortcuts into one key per modifier symbol', () => {
    expect(shortcutKeys('⌘E')).toEqual(['⌘', 'E']);
    expect(shortcutKeys('⌃⌥⇧⌘K')).toEqual(['⌃', '⌥', '⇧', '⌘', 'K']);
    expect(shortcutKeys('⇧⌘Space')).toEqual(['⇧', '⌘', 'Space']);
  });
  it('returns no keys for a shortcut that is not set', () => {
    expect(shortcutKeys('')).toEqual([]);
    expect(shortcutKeys(undefined)).toEqual([]);
  });
  it('keeps a lone key whole', () => {
    expect(shortcutKeys('F5')).toEqual(['F5']);
  });
});

describe('isShortcut', () => {
  const press = (code, key, held = {}) => ({ code, key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...held });
  it('matches a Mac shortcut, its modifiers exactly', () => {
    expect(isShortcut(press('KeyE', 'e', { metaKey: true }), '⌘E')).toBe(true);
    expect(isShortcut(press('KeyE', 'E', { metaKey: true, shiftKey: true }), '⌘E')).toBe(false);
    expect(isShortcut(press('KeyE', 'E', { metaKey: true, shiftKey: true }), '⇧⌘E')).toBe(true);
    expect(isShortcut(press('KeyE', 'e', { ctrlKey: true }), '⌃E')).toBe(true);
    expect(isShortcut(press('KeyE', 'e', { ctrlKey: true }), '⌘E')).toBe(false);
    expect(isShortcut(press('KeyE', 'e'), '⌘E')).toBe(false);
  });
  it('matches shortcuts as other systems report them, and as the badge shows them', () => {
    const e = press('KeyE', 'E', { ctrlKey: true, shiftKey: true });
    expect(isShortcut(e, 'Ctrl+Shift+E')).toBe(true);
    expect(isShortcut(e, 'Ctrl + Shift + E')).toBe(true);
    expect(isShortcut(press('KeyE', 'e', { ctrlKey: true }), 'Ctrl+Shift+E')).toBe(false);
    expect(isShortcut(press('KeyK', 'K', { ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+E')).toBe(false);
  });
  it('names the key by its place or by what it types', () => {
    // Option on a Mac types a symbol; the place still names the key.
    expect(isShortcut(press('KeyK', '˚', { altKey: true, shiftKey: true }), 'Alt+Shift+K')).toBe(true);
    // A layout that types another letter there: what it types names the key.
    expect(isShortcut(press('KeyD', 'e', { metaKey: true }), '⌘E')).toBe(true);
    expect(isShortcut(press('Digit5', '5', { altKey: true }), 'Alt+5')).toBe(true);
    expect(isShortcut(press('Comma', ',', { ctrlKey: true }), 'Ctrl+Comma')).toBe(true);
    expect(isShortcut(press('ArrowUp', 'ArrowUp', { ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+Up')).toBe(true);
    expect(isShortcut(press('Space', ' ', { metaKey: true, shiftKey: true }), '⇧⌘Space')).toBe(true);
  });
  it('matches nothing for a shortcut that is not set, has no modifier or one it cannot name', () => {
    const e = press('KeyE', 'e', { metaKey: true });
    expect(isShortcut(e, '')).toBe(false);
    expect(isShortcut(e, undefined)).toBe(false);
    expect(isShortcut(press('F5', 'F5'), 'F5')).toBe(false);
    expect(isShortcut(e, 'Search+E')).toBe(false);
  });
});

describe('openShortcutSettings', () => {

  it("opens Chrome's shortcuts page in a new tab", async () => {
    const create = vi.fn(async () => ({}));
    vi.stubGlobal('chrome', { commands: {}, tabs: { create } });
    await openShortcutSettings();
    expect(create).toHaveBeenCalledWith({ url: 'chrome://extensions/shortcuts' });
  });
  it('uses commands.openShortcutSettings() where the browser has it', async () => {
    const open = vi.fn(async () => {});
    const create = vi.fn();
    vi.stubGlobal('chrome', { commands: { openShortcutSettings: open }, tabs: { create } });
    await openShortcutSettings();
    expect(open).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
  });
});
