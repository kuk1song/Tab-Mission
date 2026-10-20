import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures.mjs';

// Tile geometry for every tile: preview aspect ratio, and whether the title
// row spills out of the tile.
// Once the window has settled: while it fades in, it is scaled down a little
// (rootFadeIn), and an overflow of a few pixels would not show.
const settled = (page) => page.locator('#grid:not(.entering)').waitFor();

function measure(page) {
  return page.evaluate(() => {
    const tiles = [...document.querySelectorAll('.tile')];
    const ratios = tiles.map((t) => {
      const r = t.querySelector('.preview').getBoundingClientRect();
      return r.width / r.height;
    });
    const clipped = tiles.filter((t) => t.querySelector('.title').getBoundingClientRect().bottom > t.getBoundingClientRect().bottom + 0.5).length;
    // 16:10 within a pixel of rounding.
    const off16by10 = ratios.filter((r) => Math.abs(r - 1.6) > 0.02).length;
    // Grouped by site, the recent tabs have a second tile each.
    const recent = document.querySelectorAll('.tile-group.recent .tile').length;
    return { tabs: tiles.length - recent, off16by10, clipped, overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth };
  });
}

test('40 tabs: tiles keep 16:10 previews and whole titles from 320 to 1280 px, grouped by site or not', async ({ ext }) => {
  const ids = Array.from({ length: 40 }, (_, i) => `beta?n=${i}`);
  await ext.openWindow(ids);
  for (const groupBySite of [true, false]) {
    await ext.sw.evaluate((groupBySite) => chrome.storage.local.set({ groupBySite }), groupBySite);
    const page = await ext.open();
    await settled(page);
    await expect(page.locator('#grid.grouped')).toHaveCount(groupBySite ? 1 : 0);
    for (const width of [320, 360, 700, 1280]) {
      await page.setViewportSize({ width, height: 700 });
      await expect.poll(() => measure(page)).toEqual({ tabs: 40, off16by10: 0, clipped: 0, overflowX: false });
    }
    await ext.pressToClose(page, 'Escape');
  }
});

test('the toolbar never overflows at narrow widths', async ({ ext }) => {
  await ext.openWindow(['tube1', 'tube2', 'alpha']);
  const page = await ext.open();
  await settled(page);
  for (const width of [320, 480, 760]) {
    await page.setViewportSize({ width, height: 600 });
    const out = await page.evaluate(() => [...document.querySelectorAll('.toolbar *')]
      .filter((el) => el.getClientRects().length && el.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5)
      .map((el) => el.id || el.className));
    expect(out, `elements past the right edge at ${width}px`).toEqual([]);
  }
});

// The shortcut, settings and reset stay together at the right edge at every
// width, clear of the toggles. Italian labels and the Windows shortcut are
// the longest, so the test uses them whatever the browser's language.
test('the toolbar actions stay together at the right edge', async ({ ext }) => {
  await ext.openWindow(['alpha', 'beta']);
  const page = await ext.open();
  await settled(page);
  await expect(page.locator('#shortcut-hint kbd')).toHaveCount(1);
  const it = JSON.parse(readFileSync('extension/_locales/it/messages.json', 'utf8'));
  await page.evaluate(([windows, sleeping]) => {
    document.querySelector('[data-i18n="showAllWindowsLabel"]').textContent = windows;
    document.querySelector('[data-i18n="showSleepingLabel"]').textContent = sleeping;
    document.querySelector('#shortcut-hint kbd').textContent = 'Ctrl + Shift + E';
  }, [it.showAllWindowsLabel.message, it.showSleepingLabel.message]);
  for (const width of [320, 400, 520, 683, 800, 1000]) {
    await page.setViewportSize({ width, height: 600 });
    const layout = await page.evaluate(() => {
      const box = (selector) => document.querySelector(selector).getBoundingClientRect();
      const sameRow = (a, b) => a.top < b.bottom && b.top < a.bottom;
      const toolbar = box('.toolbar');
      const edge = toolbar.right - parseFloat(getComputedStyle(document.querySelector('.toolbar')).paddingRight);
      const [gear, reset, shortcut] = [box('#open-settings'), box('#reset-window'), box('#shortcut-hint')];
      return {
        atRightEdge: Math.abs(reset.right - edge) < 1,
        oneRow: sameRow(gear, reset) && (shortcut.width === 0 || sameRow(shortcut, gear)),
        clearOfToggles: box('.toolbar-toggles').right <= box('.toolbar-actions').left + 0.5,
      };
    });
    expect(layout, `at ${width}px`).toEqual({ atRightEdge: true, oneRow: true, clearOfToggles: true });
  }
});
