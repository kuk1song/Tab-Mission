import { test, expect, PAGES, selectedTitle, pointAt } from './fixtures.mjs';

// "Group tabs by site" (on by default; off on the settings page): one row of
// recent tabs first, then each site with two tabs or more (in tab-bar order;
// as panels, packed row by row), which stays put as you switch, then the
// rest together. It applies at any window size and any number of tabs. The
// fixture turns it off for the other specs; these turn it on.
const VISITED = ['alpha', 'tube1', 'code1', 'beta', 'tube2', 'notes1', 'gamma', 'code2', 'notes2', 'doc1', 'tube3'];
// By last use: the previous tab (doc1), the current one (tube3), then the rest.
const RECENT = ['doc1', 'tube3', 'notes2', 'code2', 'gamma'];
// localhost: alpha, beta, gamma; tube.test: tube1 to 3; code.test and
// notes.test: two each; docs.office.test has one tab, so doc1 goes last.
const SITES = ['localhost', 'tube.test', 'code.test', 'notes.test'];

test.beforeEach(async ({ ext }) => {
  await ext.sw.evaluate(() => chrome.storage.local.remove(['groupBySite', 'groupStyle'])); // as users have it
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

test('grouped by site by default: one row of recent tabs, then sites in tab-bar order that stay put after a switch, then the rest', async ({ ext }) => {
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
  // As many recent tabs as fit in one row, at most five, by last use.
  const n = before[0].titles.length;
  expect(n).toBeGreaterThanOrEqual(1);
  expect(n).toBeLessThanOrEqual(5);
  expect(before[0].titles).toEqual(RECENT.slice(0, n).map((id) => PAGES[id].title));
  const tops = await page.locator('#grid .tile-group.recent .tile').evaluateAll((els) => els.map((el) => el.offsetTop));
  expect(new Set(tops).size).toBe(1);
  expect(before.find((g) => g.name === 'tube.test').titles).toEqual(['tube1', 'tube2', 'tube3'].map((id) => PAGES[id].title));
  expect(await selectedTitle(page)).toBe(PAGES.doc1.title);
  await expect(page.locator('#grid .tile')).toHaveCount(n + VISITED.length);

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
  expect(await selectedTitle(page)).toBe(PAGES.doc1.title);

  // Switch to the previous tab; the site groups are the same next time.
  await ext.pressToClose(page, 'Enter');
  expect(await ext.activeTitle(windowId)).toBe(PAGES.doc1.title);
  page = await ext.open();
  const after = await groups(page);
  expect(after.slice(1)).toEqual(before.slice(1));
  expect(after[0].titles[0]).toBe(PAGES.tube3.title);
});

test('a few tabs are grouped too, pages without a site go last, and a click shows on the tile you clicked', async ({ ext }) => {
  const { windowId } = await ext.openWindow(['alpha', 'tube1', 'tube2']);
  await ext.sw.evaluate((windowId) => chrome.tabs.create({ windowId, url: 'about:blank', active: false }), windowId);
  const page = await ext.open();
  expect((await groups(page)).map((g) => [g.name, g.titles.length])).toEqual([['recent', 4], ['tube.test', 2], ['other', 2]]);
  const last = page.locator('#grid .tile-group').last();
  expect(await last.getAttribute('aria-label')).toBe(await last.locator('.group-name').textContent());

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
  // doc1, the previous tab, has a tile in the recent row and one in the last group.
  const doc1 = page.locator('#grid .tile', { hasText: PAGES.doc1.title });
  await expect(doc1).toHaveCount(2);
  // The × of the site's tile, under the pointer (only a selected tile's × is there).
  const siteTile = page.locator('#grid .tile-group:not(.recent) .tile', { hasText: PAGES.doc1.title });
  await siteTile.scrollIntoViewIfNeeded(); // the last group may start below the fold
  await pointAt(page, siteTile);
  await siteTile.locator('.tile-close').click();
  await expect(doc1).toHaveCount(0);
  await expect(page.locator('#grid .tile', { hasText: PAGES.notes2.title })).toHaveCount(2);
  await ext.pressToClose(page, 'Escape');

  page = await ext.open();
  expect(await selectedTitle(page)).toBe(PAGES.notes2.title); // the previous tab now
  await ext.press();
  await ext.expectClosed();
  await expect.poll(() => ext.activeTitle(windowId)).toBe(PAGES.notes2.title);
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

// Panels: a site's panel spans as many of the grid's columns as it has
// tiles, so small sites sit side by side. Rows: each site starts a row of its
// own, on the plain grid's columns.
test('panels by default, rows from the settings page', async ({ ext, context }) => {
  await ext.openWindow(VISITED);
  // Measured once the entrance (which scales the tiles) has played.
  const layout = async (page) => (await page.locator('#grid:not(.entering)').waitFor()) ?? page.evaluate(() => {
    const grid = document.getElementById('grid');
    const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    const sites = [...grid.querySelectorAll('.tile-group:not(.recent)')].map((el) => {
      const r = el.getBoundingClientRect();
      return { tiles: el.querySelectorAll('.tile').length, span: getComputedStyle(el).gridColumnStart, top: Math.round(r.top), left: Math.round(r.left) };
    });
    const widths = [...grid.querySelectorAll('.tile')].map((el) => Math.round(el.getBoundingClientRect().width));
    return { style: grid.dataset.groupStyle, columns, sites, widths };
  });

  let page = await ext.open();
  let shown = await layout(page);
  expect(shown.style).toBe('panels');
  expect(shown.columns).toBeGreaterThanOrEqual(4);
  for (const site of shown.sites) expect(site.span).toBe(`span ${Math.min(site.tiles, shown.columns)}`);
  expect(new Set(shown.sites.map((s) => s.top)).size).toBeLessThan(shown.sites.length); // some side by side
  await ext.pressToClose(page, 'Escape');

  const options = await context.newPage();
  await options.goto(ext.welcome.url().replace('welcome.html', 'options.html'));
  await expect(options.locator('#group-style')).toHaveValue('panels');
  await options.locator('#group-style').selectOption('rows');
  await expect.poll(() => ext.sw.evaluate(() => chrome.storage.local.get('groupStyle').then((r) => r.groupStyle))).toBe('rows');
  await options.close();

  page = await ext.open();
  shown = await layout(page);
  expect(shown.style).toBe('rows');
  expect(new Set(shown.sites.map((s) => s.left)).size).toBe(1);
  expect(shown.sites.map((s) => s.top)).toEqual([...shown.sites.map((s) => s.top)].sort((a, b) => a - b));
  expect(new Set(shown.sites.map((s) => s.top)).size).toBe(shown.sites.length); // one per row
  expect(Math.max(...shown.widths) - Math.min(...shown.widths)).toBeLessThanOrEqual(1); // one column width
});

test('resizing the window keeps the groups, and redraws only when a row holds a different number of tiles', async ({ ext }) => {
  await ext.openWindow(VISITED);
  const page = await ext.open();
  await page.locator('#grid:not(.entering)').waitFor();
  const resize = (dw) => ext.sw.evaluate(async (dw) => {
    const [win] = await chrome.windows.getAll({ windowTypes: ['popup'] });
    await chrome.windows.update(win.id, { width: win.width + dw });
  }, dw);
  const recent = () => page.locator('#grid .tile-group.recent .tile').count();
  // A redraw puts new groups into the grid (measuring the row adds and
  // removes a bare probe, which does not count).
  await page.evaluate(() => {
    window.redraws = 0;
    new MutationObserver((records) => {
      if (records.some((r) => [...r.addedNodes].some((n) => n.classList?.contains('tile-group')))) window.redraws++;
    }).observe(document.getElementById('grid'), { childList: true });
  });
  const before = await recent();
  for (const dw of [6, 6, 6, -6, -6, -6]) {
    await resize(dw);
    await page.waitForTimeout(100);
  }
  expect(await page.evaluate(() => window.redraws)).toBe(0);
  // Narrower by more than a tile: the recent row holds fewer, and it is
  // still grouped, as it is when much wider.
  await resize(-400);
  await expect.poll(recent).toBeLessThan(before);
  expect(await page.evaluate(() => window.redraws)).toBeGreaterThan(0);
  await expect(page.locator('#grid.grouped')).toHaveCount(1);
  await resize(800);
  await expect.poll(recent).toBeGreaterThanOrEqual(before);
  await expect(page.locator('#grid.grouped')).toHaveCount(1);
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
