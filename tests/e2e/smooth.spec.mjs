import { test, expect } from './fixtures.mjs';

// Work the Tab Mission window skips with many tabs: tiles out of view do not
// animate, and a keystroke that leaves the same results does not put the
// tiles back.

test('only the tiles in view play the entrance, grouped by site or not', async ({ ext, context }) => {
  // Each element whose entrance starts, noted as it starts: once the grid
  // is no longer entering, no animation is left to read.
  await context.addInitScript(() => {
    window.entered = new WeakSet();
    document.addEventListener('animationstart', (e) => {
      if (e.animationName === 'fadeInUp') window.entered.add(e.target);
    }, true);
  });
  await ext.openWindow(Array.from({ length: 40 }, (_, i) => `beta?n=${i}`));
  for (const groupBySite of [true, false]) {
    await ext.sw.evaluate((groupBySite) => chrome.storage.local.set({ groupBySite }), groupBySite);
    await entranceInViewOnly(ext);
  }
});

test('a window whose first frame comes late still plays the whole entrance', async ({ ext, context }) => {
  // A slow machine (seen on GitHub's macOS runners): the first frame after
  // the entrance is set up comes 900 ms late, past the 700 ms it takes on a
  // quick one.
  await context.addInitScript(() => {
    window.entered = new WeakSet();
    document.addEventListener('animationstart', (e) => {
      if (e.animationName === 'fadeInUp') window.entered.add(e.target);
    }, true);
    const late = new MutationObserver(() => {
      if (!document.getElementById('grid')?.classList.contains('entering')) return;
      late.disconnect();
      requestAnimationFrame(() => {
        const end = performance.now() + 900;
        while (performance.now() < end);
      });
    });
    late.observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
  });
  await ext.openWindow(Array.from({ length: 24 }, (_, i) => `beta?n=${i}`));
  await entranceInViewOnly(ext);
});

async function entranceInViewOnly(ext) {
  const page = await ext.open();
  await page.locator('#grid:not(.entering)').waitFor(); // tiles at rest
  const tiles = await page.locator('#grid .tile').evaluateAll((els) => {
    const view = document.getElementById('grid').getBoundingClientRect();
    return els.map((el) => {
      const r = el.getBoundingClientRect();
      // Wholly in view, or well below it. A tile on the bottom edge may go
      // either way: the tiles are marked while the window still fades in
      // (scaled), so the edge is not where it rests.
      const place = r.bottom <= view.bottom ? 'in' : r.top >= view.bottom + 24 ? 'out' : 'edge';
      return { place, entered: window.entered.has(el) };
    });
  });
  const inView = tiles.filter((t) => t.place === 'in');
  const outOfView = tiles.filter((t) => t.place === 'out');
  expect(inView.length).toBeGreaterThan(0);
  expect(outOfView.length).toBeGreaterThan(0);
  expect(inView.every((t) => t.entered)).toBe(true);
  expect(outOfView.some((t) => t.entered)).toBe(false);
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
  // The search runs in the next animation frame (events.js): two frames on,
  // it has run.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  expect(await page.evaluate(() => window.redraws)).toBe(0);
  await expect(page.locator('#grid .tile')).toHaveCount(3);
  await page.keyboard.type('x'); // now nothing matches
  await expect(page.locator('#grid .empty')).toHaveCount(1);
});
