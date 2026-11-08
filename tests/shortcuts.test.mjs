import { describe, it, expect, vi } from 'vitest';
import { shortcutKeys, finishingKey, holdsModifiers, openShortcutSettings } from '../extension/src/shortcuts.js';

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

describe('finishingKey', () => {
  it('is the last key, with the modifiers as the event properties that report them', () => {
    expect(finishingKey('⌘E')).toEqual({ key: 'E', modifiers: ['metaKey'] });
    expect(finishingKey('Ctrl+Shift+E')).toEqual({ key: 'E', modifiers: ['ctrlKey', 'shiftKey'] });
    expect(finishingKey('⌃⌥⇧⌘K')).toEqual({ key: 'K', modifiers: ['ctrlKey', 'altKey', 'shiftKey', 'metaKey'] });
    expect(finishingKey('Alt+Comma')).toEqual({ key: 'Comma', modifiers: ['altKey'] });
  });
  it('is none for no shortcut, a lone key or a modifier it does not know', () => {
    expect(finishingKey('')).toBeNull();
    expect(finishingKey(undefined)).toBeNull();
    expect(finishingKey('F5')).toBeNull();
    expect(finishingKey('Search+E')).toBeNull();
  });
});

describe('holdsModifiers', () => {
  const none = { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
  it('holds when exactly those modifiers are down', () => {
    expect(holdsModifiers({ ...none, metaKey: true }, ['metaKey'])).toBe(true);
    expect(holdsModifiers({ ...none, ctrlKey: true, shiftKey: true }, ['ctrlKey', 'shiftKey'])).toBe(true);
  });
  it('does not hold with one missing or one more, which would not press the shortcut', () => {
    expect(holdsModifiers(none, ['metaKey'])).toBe(false);
    expect(holdsModifiers({ ...none, ctrlKey: true }, ['ctrlKey', 'shiftKey'])).toBe(false);
    expect(holdsModifiers({ ...none, metaKey: true, shiftKey: true }, ['metaKey'])).toBe(false);
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
