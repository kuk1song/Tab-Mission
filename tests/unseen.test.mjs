import { describe, it, expect, beforeEach, vi } from 'vitest';

// A small fake of what unseen.js uses: the three tab events and session
// storage, which copies what it stores as Chrome does.
function fakeChrome() {
  const listeners = {};
  const event = (name) => ({ addListener: (fn) => { listeners[name] = fn; } });
  const data = {};
  return {
    listeners,
    data,
    storage: {
      session: {
        get: vi.fn(async (key) => (key in data ? { [key]: structuredClone(data[key]) } : {})),
        set: vi.fn(async (items) => { Object.assign(data, structuredClone(items)); }),
      },
    },
    tabs: { onCreated: event('onCreated'), onActivated: event('onActivated'), onRemoved: event('onRemoved') },
  };
}

let chrome;
let unseen;
beforeEach(async () => {
  vi.resetModules();
  chrome = fakeChrome();
  vi.stubGlobal('chrome', chrome);
  unseen = await import('../extension/src/unseen.js');
  unseen.trackUnseenTabs();
});

// The fake answers at once, so one turn of the event loop runs every update.
const settled = () => new Promise((r) => setImmediate(r));
const ids = async () => [...(await unseen.unseenTabIds())].sort();

describe('unseen.js', () => {
  it('notes a tab opened in the background until it is shown', async () => {
    chrome.listeners.onCreated({ id: 5, active: false });
    chrome.listeners.onCreated({ id: 6, active: true }); // opened in front
    await settled();
    expect(await ids()).toEqual([5]);
    chrome.listeners.onActivated({ tabId: 5, windowId: 1 });
    await settled();
    expect(await ids()).toEqual([]);
  });

  it('forgets a tab closed before it was shown', async () => {
    chrome.listeners.onCreated({ id: 5, active: false });
    await settled();
    chrome.listeners.onRemoved(5, { windowId: 1, isWindowClosing: false });
    await settled();
    expect(await ids()).toEqual([]);
  });

  it('keeps every tab of a burst (links opened at once), one update at a time', async () => {
    for (const id of [5, 6, 7]) chrome.listeners.onCreated({ id, active: false });
    chrome.listeners.onActivated({ tabId: 6, windowId: 1 });
    await settled();
    expect(await ids()).toEqual([5, 7]);
  });

  it('writes nothing for a switch to a tab it does not hold', async () => {
    chrome.listeners.onActivated({ tabId: 9, windowId: 1 });
    await settled();
    expect(chrome.storage.session.set).not.toHaveBeenCalled();
  });

  it('reads an empty list when storage holds none or fails', async () => {
    expect(await ids()).toEqual([]);
    chrome.storage.session.get.mockRejectedValueOnce(new Error('no storage'));
    expect(await ids()).toEqual([]);
  });
});
