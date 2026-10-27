import { describe, it, expect, beforeEach, vi } from 'vitest';

// The service worker's side of thumbnail.js: a small fake of the tab event
// it listens to and of session storage, which copies what it stores as
// Chrome does.
function fakeChrome() {
  const listeners = {};
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
    tabs: { onReplaced: { addListener: (fn) => { listeners.onReplaced = fn; } } },
  };
}

let chrome;
beforeEach(async () => {
  vi.resetModules();
  chrome = fakeChrome();
  vi.stubGlobal('chrome', chrome);
  (await import('../extension/src/thumbnail.js')).movePreviewsOfReplacedTabs();
});

// The fake answers at once, so one turn of the event loop runs every move.
const settled = () => new Promise((r) => setImmediate(r));

describe('thumbnail.js, in the service worker', () => {
  it('moves the image found for a tab put to sleep to its new id', async () => {
    const found = { url: 'https://site.test/a', img: 'https://img.test/a.png', at: 1 };
    const other = { url: 'https://site.test/b', img: null, at: 2 };
    chrome.data.previewCache = { 5: found, 6: other };
    // Two tabs put to sleep at once: both moves are kept.
    chrome.listeners.onReplaced(9, 5);
    chrome.listeners.onReplaced(10, 6);
    await settled();
    expect(chrome.data.previewCache).toEqual({ 9: found, 10: other });
  });

  it('writes nothing for a tab without a cached image, or when storage fails', async () => {
    chrome.data.previewCache = { 5: { url: 'https://site.test/a', img: null, at: 1 } };
    chrome.listeners.onReplaced(9, 7);
    await settled();
    chrome.storage.session.get.mockRejectedValueOnce(new Error('no storage'));
    chrome.listeners.onReplaced(9, 5);
    await settled();
    expect(chrome.storage.session.set).not.toHaveBeenCalled();
    // The next move still runs.
    chrome.listeners.onReplaced(9, 5);
    await settled();
    expect(Object.keys(chrome.data.previewCache)).toEqual(['9']);
  });
});
