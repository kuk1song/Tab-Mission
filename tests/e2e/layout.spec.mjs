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

// TEMPORARY A/B (experimentGrid): remove with the experiment.
test('grid B: few tabs grow to fill the grid; typing returns the standard size', async ({ ext }) => {
  await ext.sw.evaluate(() => chrome.storage.local.set({ experimentGrid: 'dense' }));
  await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  await page.setViewportSize({ width: 1200, height: 800 });
  const grid = page.locator('#grid');
  await expect(grid).toHaveClass(/dense/);
  await expect(grid).toHaveClass(/filled/);
  const tiles = () => page.evaluate(() => {
    const g = document.getElementById('grid').getBoundingClientRect();
    return [...document.querySelectorAll('.tile')].map((t) => {
      const r = t.getBoundingClientRect();
      return { width: Math.round(r.width), inside: r.top >= g.top && r.bottom <= g.bottom + 1 };
    });
  });
  const filled = await tiles();
  expect(filled.every((t) => t.inside && t.width > 300 && t.width <= 361)).toBe(true);
  await page.keyboard.type('page');
  await expect(grid).not.toHaveClass(/filled/);
  const standard = await tiles();
  expect(standard[0].width).toBeLessThan(filled[0].width);
});

test('grid A (default): standard columns, nothing grows', async ({ ext }) => {
  await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  await page.setViewportSize({ width: 1200, height: 800 });
  await expect(page.locator('#grid')).not.toHaveClass(/dense|filled/);
});
