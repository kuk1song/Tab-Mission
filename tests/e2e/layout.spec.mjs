import { test, expect } from './fixtures.mjs';

// Tile geometry for every tile: preview aspect ratio, and whether the title
// row spills out of the tile.
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
    return { tiles: tiles.length, off16by10, clipped, overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth };
  });
}

test('40 tabs: tiles keep 16:10 previews and whole titles from 320 to 1280 px', async ({ ext }) => {
  const ids = Array.from({ length: 40 }, (_, i) => `beta?n=${i}`);
  await ext.openWindow(ids);
  const page = await ext.open();
  for (const width of [320, 360, 700, 1280]) {
    await page.setViewportSize({ width, height: 700 });
    await expect.poll(() => measure(page)).toEqual({ tiles: 40, off16by10: 0, clipped: 0, overflowX: false });
  }
});

test('the toolbar never overflows at narrow widths', async ({ ext }) => {
  await ext.openWindow(['tube1', 'tube2', 'alpha']);
  const page = await ext.open();
  for (const width of [320, 480, 760]) {
    await page.setViewportSize({ width, height: 600 });
    const out = await page.evaluate(() => [...document.querySelectorAll('.toolbar *')]
      .filter((el) => el.getClientRects().length && el.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5)
      .map((el) => el.id || el.className));
    expect(out, `elements past the right edge at ${width}px`).toEqual([]);
  }
});
