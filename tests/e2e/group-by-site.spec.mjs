import { test, expect, PAGES, selectedTitle, pointAt } from './fixtures.mjs';

// "Group tabs by site" (on by default; off on the settings page): the five
// most recent tabs first, then all the tabs of each site with two or more (in
// tab-bar order, packed row by row), which stays put as you switch, then the
// rest, without the tabs already in the recent row. It applies at any window
// size and any number of tabs. The fixture turns it off for the other specs;
// these turn it on.
const VISITED = ['alpha', 'doc1', 'tube1', 'code1', 'beta', 'tube2', 'notes1', 'gamma', 'code2', 'notes2', 'tube3'];
// By last use: the previous tab (notes2), the current one (tube3), then the rest.
const RECENT = ['notes2', 'tube3', 'code2', 'gamma', 'notes1'];
// localhost: alpha, beta, gamma; tube.test: tube1 to 3; code.test and
// notes.test: two each; docs.office.test has one tab, so doc1 goes last.
const SITES = ['localhost', 'tube.test', 'code.test', 'notes.test'];

test.beforeEach(async ({ ext }) => {
  await ext.sw.evaluate(() => chrome.storage.local.remove('groupBySite')); // as users have it
});

// Each group's name ('recent' and 'other' for those two), the count in its
// heading and its tiles' titles, in order.
function groups(page) {
  return page.locator('#grid .tile-group').evaluateAll((els) => els.map((el) => ({
    name: el.classList.contains('recent') ? 'recent' : el.classList.contains('other') ? 'other' : el.querySelector('.group-name').textContent,
    count: el.querySelector('.group-count')?.textContent ?? null,
    icon: Boolean(el.querySelector('.group-icon img')),
    titles: [...el.querySelectorAll('.tile .title')].map((t) => t.textContent),
  })));
}

test('grouped by site by default: five recent tabs, then sites that stay put after a switch, then the rest', async ({ ext }) => {
  const { windowId } = await ext.openWindow(VISITED);
  let page = await ext.open();
  await page.locator('#grid:not(.entering)').waitFor(); // the entrance has played
  const before = await groups(page);
  // The sites between the two; as panels, packed row by row, so their order
  // depends on the window's width (state.test covers it).
  expect(before.map((g) => g.name)).toEqual(['recent', ...before.slice(1, -1).map((g) => g.name), 'other']);
  expect(before.slice(1, -1).map((g) => g.name).sort()).toEqual([...SITES].sort());
  // Headings: the site's icon and its number of tabs; the rest has a count.
  const count = Object.fromEntries(before.map((g) => [g.name, g.count]));
  expect(count).toEqual({ recent: null, localhost: '3', 'tube.test': '3', 'code.test': '2', 'notes.test': '2', other: '1' });
  expect(before.map((g) => g.icon)).toEqual([false, true, true, true, true, false]);
  expect(before.at(-1).titles).toEqual([PAGES.doc1.title]);
  const last = page.locator('#grid .tile-group').last();
  expect(await last.getAttribute('aria-label')).toBe(await last.locator('.group-name').textContent());
  // The five most recent tabs, by last use.
  expect(before[0].titles).toEqual(RECENT.map((id) => PAGES[id].title));
  expect(before.find((g) => g.name === 'tube.test').titles).toEqual(['tube1', 'tube2', 'tube3'].map((id) => PAGES[id].title));
  expect(await selectedTitle(page)).toBe(PAGES.notes2.title);
  await expect(page.locator('#grid .tile')).toHaveCount(RECENT.length + VISITED.length);

  // ↓ goes to the tile straight below, ↑ comes back.
  const box = () => page.locator('#grid .tile.selected').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top };
  });
  const start = await box();
  await page.keyboard.press('ArrowDown');
  const below = await box();
  expect(below.top).toBeGreaterThan(start.top);
  expect(below.left < start.right && below.right > start.left).toBe(true);
  await page.keyboard.press('ArrowUp');
  expect(await selectedTitle(page)).toBe(PAGES.notes2.title);

  // Switch to the previous tab; the site groups are the same next time.
  await ext.pressToClose(page, 'Enter');
  expect(await ext.activeTitle(windowId)).toBe(PAGES.notes2.title);
  page = await ext.open();
  const after = await groups(page);
  expect(after.slice(1)).toEqual(before.slice(1));
  expect(after[0].titles[0]).toBe(PAGES.tube3.title);
});

test('a few tabs are grouped too, one-tab sites are not repeated, and a click shows on the tile you clicked', async ({ ext }) => {
  const { windowId } = await ext.openWindow(['alpha', 'tube1', 'tube2']);
  await ext.sw.evaluate((windowId) => chrome.tabs.create({ windowId, url: 'about:blank', active: false }), windowId);
  const page = await ext.open();
  // alpha and the blank page are in the recent row, so there is no last group.
  expect((await groups(page)).map((g) => [g.name, g.titles.length])).toEqual([['recent', 4], ['tube.test', 2]]);

  // tube1 is in the recent group and under its site; click the site's tile.
  const siteTile = page.locator('#grid .tile-group:not(.recent) .tile', { hasText: PAGES.tube1.title });
  const index = await siteTile.getAttribute('data-index');
  // The page closes right after the click, so it notes the pressed tile
  // where the test can read it afterwards.
  await page.evaluate(() => {
    new MutationObserver((records) => {
      const pressed = records.map((r) => r.target).filter((el) => el.classList.contains('activating'));
      if (pressed.length) chrome.storage.session.set({ pressed: pressed.map((el) => el.dataset.index) });
    }).observe(document.getElementById('grid'), { subtree: true, attributes: true, attributeFilter: ['class'] });
  });
  await siteTile.click();
  await expect.poll(() => ext.sw.evaluate(() => chrome.storage.session.get('pressed').then((r) => r.pressed))).toEqual([index]);
  await expect.poll(() => ext.activeTitle(windowId)).toBe(PAGES.tube1.title);
});

test('the shortcut pressed again goes back, and closing a tab removes both of its tiles', async ({ ext }) => {
  const { windowId } = await ext.openWindow(VISITED);
  let page = await ext.open();
  // notes2, the previous tab, has a tile in the recent row and one under its site.
  const notes2 = page.locator('#grid .tile', { hasText: PAGES.notes2.title });
  await expect(notes2).toHaveCount(2);
  // The × of the site's tile, under the pointer (only a selected tile's × is there).
  const siteTile = page.locator('#grid .tile-group:not(.recent) .tile', { hasText: PAGES.notes2.title });
  await siteTile.scrollIntoViewIfNeeded(); // the site may start below the fold
  await pointAt(page, siteTile);
  await siteTile.locator('.tile-close').click();
  await expect(notes2).toHaveCount(0);
  await expect(page.locator('#grid .tile', { hasText: PAGES.code2.title })).toHaveCount(2);
  await ext.pressToClose(page, 'Escape');

  page = await ext.open();
  expect(await selectedTitle(page)).toBe(PAGES.code2.title); // the previous tab now
  await ext.press();
  await ext.expectClosed();
  await expect.poll(() => ext.activeTitle(windowId)).toBe(PAGES.code2.title);
});

test('a search and the site view show the usual grid', async ({ ext }) => {
  await ext.openWindow(VISITED);
  const page = await ext.open();
  await expect(page.locator('#grid.grouped')).toHaveCount(1);
  await page.keyboard.type('tube');
  await expect(page.locator('#grid.grouped')).toHaveCount(0);
  await expect(page.locator('#grid .tile')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await expect(page.locator('#grid.grouped')).toHaveCount(1);
  await page.keyboard.press('Tab'); // the current tab's site
  await expect(page.locator('#grid.grouped')).toHaveCount(0);
  await expect(page.locator('#grid .tile')).toHaveCount(3);
});

test('the settings page switch turns it off', async ({ ext, context }) => {
  await ext.openWindow(VISITED.slice(0, 3));
  let page = await ext.open();
  await expect(page.locator('#grid.grouped')).toHaveCount(1);
  await ext.pressToClose(page, 'Escape');

  const options = await context.newPage();
  await options.goto(ext.welcome.url().replace('welcome.html', 'options.html'));
  const toggle = options.locator('#group-by-site');
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect.poll(() => ext.sw.evaluate(() => chrome.storage.local.get('groupBySite').then((r) => r.groupBySite))).toBe(false);
  await options.close();
  page = await ext.open();
  await expect(page.locator('#grid .tile')).toHaveCount(3); // the current window's
  await expect(page.locator('#grid.grouped')).toHaveCount(0);
});

// One set of columns: a site's panel spans as many of them as it has tiles,
// so small sites sit side by side, and every tile in the window has the same
// width and sits on the same column lines; panels in a row are equally tall.
test('every tile on the same columns, panels as wide as their tabs and side by side', async ({ ext }) => {
  await ext.openWindow(VISITED);
  const page = await ext.open();
  // A known width, wide enough for five columns.
  await ext.sw.evaluate(async () => {
    const [win] = await chrome.windows.getAll({ windowTypes: ['popup'] });
    await chrome.windows.update(win.id, { width: 1280 });
  });
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.getElementById('grid')).gridTemplateColumns.split(' ').length)).toBe(5);
  await page.locator('#grid:not(.entering)').waitFor(); // the entrance scales the tiles
  const shown = await page.evaluate(() => {
    const grid = document.getElementById('grid');
    const box = (el) => el.getBoundingClientRect();
    const sites = [...grid.querySelectorAll('.tile-group:not(.recent)')].map((el) => ({
      tiles: el.querySelectorAll('.tile').length,
      span: getComputedStyle(el).gridColumnStart,
      top: Math.round(box(el).top),
      height: Math.round(box(el).height),
    }));
    const tiles = [...grid.querySelectorAll('.tile')].map((el) => ({ left: box(el).left, width: box(el).width }));
    const recentLefts = [...grid.querySelectorAll('.tile-group.recent .tile')].map((el) => box(el).left);
    return { columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length, sites, tiles, recentLefts };
  });
  expect(shown.columns).toBeGreaterThanOrEqual(4);
  for (const site of shown.sites) expect(site.span).toBe(`span ${Math.min(site.tiles, shown.columns)}`);
  expect(new Set(shown.sites.map((s) => s.top)).size).toBeLessThan(shown.sites.length); // some side by side
  const widths = shown.tiles.map((t) => t.width);
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1);
  // Five recent tabs cover every column at four or five columns.
  for (const { left } of shown.tiles) expect(shown.recentLefts.some((l) => Math.abs(l - left) < 1)).toBe(true);
  for (const row of new Set(shown.sites.map((s) => s.top))) {
    expect(new Set(shown.sites.filter((s) => s.top === row).map((s) => s.height)).size).toBe(1);
  }
});

test('resizing the window keeps the groups and the five recent tabs, and redraws only when a row holds a different number of tiles', async ({ ext }) => {
  await ext.openWindow(VISITED);
  const page = await ext.open();
  await page.locator('#grid:not(.entering)').waitFor();
  const resize = (dw) => ext.sw.evaluate(async (dw) => {
    const [win] = await chrome.windows.getAll({ windowTypes: ['popup'] });
    await chrome.windows.update(win.id, { width: win.width + dw });
  }, dw);
  const recent = () => page.locator('#grid .tile-group.recent .tile').count();
  const columns = () => page.evaluate(() => getComputedStyle(document.getElementById('grid')).gridTemplateColumns.split(' ').length);
  // A redraw puts new groups into the grid (measuring the row adds and
  // removes a bare probe, which does not count).
  await page.evaluate(() => {
    window.redraws = 0;
    new MutationObserver((records) => {
      if (records.some((r) => [...r.addedNodes].some((n) => n.classList?.contains('tile-group')))) window.redraws++;
    }).observe(document.getElementById('grid'), { childList: true });
  });
  // Start at a known width, well inside five columns.
  await ext.sw.evaluate(async () => {
    const [win] = await chrome.windows.getAll({ windowTypes: ['popup'] });
    await chrome.windows.update(win.id, { width: 1280 });
  });
  await expect.poll(columns).toBe(5);
  await page.waitForTimeout(200);
  await page.evaluate(() => { window.redraws = 0; });
  const before = await columns();
  expect(await recent()).toBe(5);
  for (const dw of [6, 6, 6, -6, -6, -6]) {
    await resize(dw);
    await page.waitForTimeout(100);
  }
  expect(await page.evaluate(() => window.redraws)).toBe(0);
  // Narrower by more than a tile: fewer columns, redrawn, still grouped,
  // still five recent tabs; and the same back at the first width.
  await resize(-500);
  await expect.poll(columns).toBeLessThan(before);
  expect(await page.evaluate(() => window.redraws)).toBeGreaterThan(0);
  await expect(page.locator('#grid.grouped')).toHaveCount(1);
  expect(await recent()).toBe(5);
  await resize(500);
  await expect.poll(columns).toBe(before);
  await expect(page.locator('#grid.grouped')).toHaveCount(1);
  expect(await recent()).toBe(5);
});

test('a site icon Chrome does not hand over leaves no broken image', async ({ ext }) => {
  await ext.openWindow(['tube1', 'tube2', 'alpha']);
  const page = await ext.open();
  const tile = page.locator('#grid .tile-group:not(.recent) .tile', { hasText: PAGES.tube1.title });
  const heading = page.locator('#grid .tile-group:not(.recent):not(.other) .group-icon');
  // As if the icon failed to load (the favicon permission not yet granted).
  await page.evaluate(() => {
    for (const img of document.querySelectorAll('.preview-icon img, .site-badge img, .group-icon img')) img.dispatchEvent(new Event('error'));
  });
  await expect(tile.locator('.preview-icon img')).toBeHidden();
  await expect(tile.locator('.preview-icon b')).toBeVisible();
  await expect(tile.locator('.preview-icon b')).toHaveText('L'); // "Lo-fi jazz…"
  await expect(heading).toBeHidden();
  await expect(page.locator('#grid .tile-group:not(.recent):not(.other) .group-name')).toHaveText('tube.test');
});
