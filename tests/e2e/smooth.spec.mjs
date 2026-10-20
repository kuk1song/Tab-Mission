import { test, expect } from './fixtures.mjs';

// Work the Tab Mission window skips with many tabs: tiles out of view do not
// animate, and a keystroke that leaves the same results does not put the
// tiles back.

test('only the tiles in view play the entrance, grouped by site or not', async ({ ext }) => {
  await ext.openWindow(Array.from({ length: 40 }, (_, i) => `beta?n=${i}`));
  for (const groupBySite of [true, false]) {
    await ext.sw.evaluate((groupBySite) => chrome.storage.local.set({ groupBySite }), groupBySite);
    await entranceInViewOnly(ext);
  }
});

async function entranceInViewOnly(ext) {
  const page = await ext.open();
  const tiles = await page.locator('#grid .tile').evaluateAll((els) => {
    const view = document.getElementById('grid').getBoundingClientRect();
    return els.map((el) => {
      // Where the tile rests: the entrance moves it 12 px meanwhile.
      const shift = new DOMMatrix(getComputedStyle(el).transform).m42;
      const r = el.getBoundingClientRect();
      return { inView: r.bottom - shift > view.top && r.top - shift < view.bottom, animated: el.getAnimations().length > 0 };
    });
  });
  expect(tiles.filter((t) => !t.inView).length).toBeGreaterThan(0);
  expect(tiles.filter((t) => t.inView).every((t) => t.animated)).toBe(true);
  expect(tiles.filter((t) => !t.inView).some((t) => t.animated)).toBe(false);
  await ext.pressToClose(page, 'Escape');
}

test('a keystroke that leaves the same results does not redraw the grid', async ({ ext }) => {
  await ext.openWindow(['alpha', 'tube1', 'tube2', 'tube3']);
  const page = await ext.open();
  // "tub" matches only the three tube tabs, never the welcome tab (whose
  // address is chrome-extension://<id made of a to p>/welcome.html).
  await page.keyboard.type('tub');
  await expect(page.locator('#grid .tile')).toHaveCount(3);
  await page.evaluate(() => {
    window.redraws = 0;
    new MutationObserver(() => { window.redraws++; }).observe(document.getElementById('grid'), { childList: true });
  });
  await page.keyboard.type('e tu');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.redraws)).toBe(0);
  await expect(page.locator('#grid .tile')).toHaveCount(3);
  await page.keyboard.type('x'); // now nothing matches
  await expect(page.locator('#grid .empty')).toHaveCount(1);
});
