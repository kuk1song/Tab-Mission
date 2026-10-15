import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { recordTryIt, readTryIt } from '../extension/src/tryit.js';

function fakeChrome() {
  const data = {};
  const session = {
    data,
    get: vi.fn(async (keys) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]]))),
    set: vi.fn(async (items) => { Object.assign(data, items); }),
  };
  return { storage: { session } };
}

let chrome;
beforeEach(() => {
  chrome = fakeChrome();
  vi.stubGlobal('chrome', chrome);
});
afterEach(() => vi.unstubAllGlobals());

describe('tryit.js', () => {
  it('records a step with one write of its own key, without reading first', () => {
    recordTryIt('search');
    expect(chrome.storage.session.set).toHaveBeenCalledWith({ tryItSearch: true });
    expect(chrome.storage.session.get).not.toHaveBeenCalled();
  });

  it('reads the three steps, counting only true as done', async () => {
    Object.assign(chrome.storage.session.data, { tryItOpen: true, tryItBack: 'yes', other: true });
    expect(await readTryIt()).toEqual({ open: true, back: false, search: false });
  });

  it('never throws when storage is unavailable', async () => {
    vi.stubGlobal('chrome', {});
    expect(() => recordTryIt('open')).not.toThrow();
    expect(await readTryIt()).toEqual({ open: false, back: false, search: false });
  });

  it('ignores a failed write', async () => {
    chrome.storage.session.set.mockRejectedValueOnce(new Error('quota'));
    expect(() => recordTryIt('back')).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});
