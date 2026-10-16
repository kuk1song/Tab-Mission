import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { recordTryIt, readTryIt, resetTryIt, stopTips } from '../extension/src/tryit.js';

function fakeChrome() {
  const data = {};
  const local = {
    data,
    get: vi.fn(async (keys) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]]))),
    set: vi.fn(async (items) => { Object.assign(data, items); }),
    remove: vi.fn(async (keys) => { for (const k of keys) delete data[k]; }),
  };
  return { storage: { local } };
}

let chrome;
beforeEach(() => {
  chrome = fakeChrome();
  vi.stubGlobal('chrome', chrome);
});
afterEach(() => vi.unstubAllGlobals());

describe('tryit.js', () => {
  it('records a step with one write of its own key, without reading first', () => {
    recordTryIt('back');
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ tryItBack: true });
    expect(chrome.storage.local.get).not.toHaveBeenCalled();
  });

  it('reads the two steps and whether tips are due, counting only true', async () => {
    Object.assign(chrome.storage.local.data, { tryItOpen: true, tryItBack: 'yes', tipsDue: true, other: true });
    expect(await readTryIt()).toEqual({ open: true, back: false, tipsDue: true });
  });

  it('starts over: both steps undone and tips due again', async () => {
    Object.assign(chrome.storage.local.data, { tryItOpen: true, tryItBack: true, tipsDue: false });
    await resetTryIt();
    expect(await readTryIt()).toEqual({ open: false, back: false, tipsDue: true });
  });

  it('"Got it" stops the tips until starting over', async () => {
    chrome.storage.local.data.tipsDue = true;
    stopTips();
    await new Promise((r) => setTimeout(r, 0));
    expect((await readTryIt()).tipsDue).toBe(false);
  });

  it('never throws when storage is unavailable', async () => {
    vi.stubGlobal('chrome', {});
    expect(() => recordTryIt('open')).not.toThrow();
    expect(() => stopTips()).not.toThrow();
    await expect(resetTryIt()).resolves.toBeUndefined();
    expect(await readTryIt()).toEqual({ open: false, back: false, tipsDue: false });
  });

  it('ignores a failed write', async () => {
    chrome.storage.local.set.mockRejectedValueOnce(new Error('quota'));
    expect(() => recordTryIt('back')).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});
