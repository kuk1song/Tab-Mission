import { describe, it, expect, vi, afterEach } from 'vitest';
import { shortcutKeys, openShortcutSettings } from '../extension/src/shortcuts.js';

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

describe('openShortcutSettings', () => {
  afterEach(() => vi.unstubAllGlobals());

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
