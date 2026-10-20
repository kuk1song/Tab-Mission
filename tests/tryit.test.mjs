import { describe, it, expect, beforeEach, vi } from 'vitest';
import { recordTryIt, readTryIt, startTips, noteTipShown } from '../extension/src/tryit.js';

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

describe('tryit.js', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('records a step with one write of its own key, without reading first', () => {
    recordTryIt('back');
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ tryItBack: true });
    expect(chrome.storage.local.get).not.toHaveBeenCalled();
  });

  it('reads the two steps, counting only true, and no tips for users without a count', async () => {
    Object.assign(chrome.storage.local.data, { tryItOpen: true, tryItBack: 'yes', other: true });
    expect(await readTryIt()).toEqual({ open: true, back: false, tipsLeft: { open: 0, back: 0 } });
  });

  it('a new install gives each tip three showings; each shown tip uses one, down to none', async () => {
    startTips();
    await tick();
    let { tipsLeft } = await readTryIt();
    expect(tipsLeft).toEqual({ open: 3, back: 3 });
    for (let i = 0; i < 4; i++) {
      noteTipShown('back', tipsLeft);
      await tick();
      ({ tipsLeft } = await readTryIt());
    }
    expect(tipsLeft).toEqual({ open: 3, back: 0 });
  });

  it('reads a damaged count as none', async () => {
    chrome.storage.local.data.tipsLeft = { open: 'many', back: -2 };
    expect((await readTryIt()).tipsLeft).toEqual({ open: 0, back: 0 });
  });

  it('never throws when storage is unavailable', async () => {
    vi.stubGlobal('chrome', {});
    expect(() => recordTryIt('open')).not.toThrow();
    expect(() => startTips()).not.toThrow();
    expect(() => noteTipShown('open', { open: 1, back: 1 })).not.toThrow();
    expect(await readTryIt()).toEqual({ open: false, back: false, tipsLeft: { open: 0, back: 0 } });
  });

  it('ignores a failed write', async () => {
    chrome.storage.local.set.mockRejectedValueOnce(new Error('quota'));
    expect(() => recordTryIt('back')).not.toThrow();
    await tick();
  });
});
