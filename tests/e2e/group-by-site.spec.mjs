import { test, expect, PAGES, selectedTitle, pointAt } from './fixtures.mjs';

// "Group tabs by site" (on by default; off on the settings page): the five
// most recent tabs first, then all the tabs of each site with two or more (in
// tab-bar order, packed row by row), which stays put as you switch, then the
// rest, without the tabs already among the recent tabs. It applies at any window
// size and any number of tabs. The fixture turns it off for the other specs;
// these turn it on.
const VISITED = ['alpha', 'doc1', 'tube1', 'code1', 'beta', 'tube2', 'notes1', 'gamma', 'code2', 'notes2', 'tube3'];
// By last use: the previous tab (notes2), the current one (tube3), then the rest.
const RECENT = ['notes2', 'tube3', 'code2', 'gamma', 'notes1'];
// localhost: alpha, beta, gamma; tube.test: tube1 to 3; code.test and
// notes.test: two each; docs.office.test has one tab, so doc1 goes last.
const SITES = ['localhost', 'tube.test', 'code.test', 'notes.test'];

// A Tab Mission window 800 px wide holds four tiles a row on every CI
// system, with classic scrollbars (Windows) or without, and fits the Windows
// runner's 1024 px screen. Opened at that size (its saved size), it needs no
// resize first.
async function openAt800(ext) {
  await ext.sw.evaluate(() => chrome.storage.local.set({ overviewBounds: { width: 800, height: 600 } }));
  return ext.open();
}
const columnsOf = (page) => page.evaluate(() => getComputedStyle(document.getElementById('grid')).gridTemplateColumns.split(' ').length);

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
  let page = await openAt800(ext);
  await page.locator('#grid:not(.entering)').waitFor(); // the entrance has played
  expect(await columnsOf(page)).toBe(4);
  const before = await groups(page);
  // The sites between the two, as panels packed row by row in four columns:
  // localhost (3) alone, as no other site fits the column left, tube.test (3)
  // alone, then code.test and notes.test (2 each) side by side. Other widths
  // pack them otherwise (state.test).
  expect(before.map((g) => g.name)).toEqual(['recent', ...SITES, 'other']);
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

// What the plain grid's specs check, here with a tab's two tiles: the card
// tip and the shortcut pressed over a tile (tips.spec, window.spec).
test('grouped, the card tip points at the selected tile, and the shortcut goes to the tile you point at', async ({ ext, context }) => {
  const { windowId } = await ext.openWindow(VISITED);
  await ext.sw.evaluate(() => chrome.storage.local.set({ tipsLeft: { open: 3, back: 3 } }));
  // Opened with the real shortcut, from the current tab.
  const opened = context.waitForEvent('page', (p) => p.url().includes('/overview.html'));
  await ext.pressDefaultShortcut(context.pages().find((p) => p.url() === ext.url('tube3')));
  const page = await opened;
  // The tiles first: the grid is marked as entering before they are drawn,
  // so until then it would pass for settled.
  await page.locator('#grid .tile').first().waitFor();
  await page.locator('#grid:not(.entering)').waitFor();
  // The previous tab has a tile among the recent tabs and one in its site's
  // panel: the recent one is selected, and the tip points at it.
  const selected = page.locator('#grid .tile.selected');
  await expect(selected).toHaveCount(1);
  expect(await selectedTitle(page)).toBe(PAGES.notes2.title);
  expect(await selected.evaluate((el) => Boolean(el.closest('.tile-group.recent')))).toBe(true);
  const tip = page.locator('.tip');
  await expect(tip).toHaveAttribute('data-anchor', 'card');
  const card = await selected.boundingBox();
  const arrowX = await tip.evaluate((el) => el.getBoundingClientRect().left + parseFloat(el.style.getPropertyValue('--arrow-x')));
  expect(Math.abs(arrowX - (card.x + card.width / 2))).toBeLessThan(2);
  // Pointed at in its site's panel, a tab is selected there, and the
  // shortcut switches to it.
  const target = page.locator('#grid .tile-group:not(.recent) .tile', { hasText: PAGES.tube1.title });
  await target.scrollIntoViewIfNeeded();
  await pointAt(page, target);
  await expect(target).toHaveClass(/selected/);
  await expect(page.locator('#grid .tile.selected')).toHaveCount(1);
  await ext.pressDefaultShortcut(page);
  await ext.expectClosed();
  expect(await ext.activeTitle(windowId)).toBe(PAGES.tube1.title);
});

test('a few tabs are grouped too, one-tab sites are not repeated, and a click shows on the tile you clicked', async ({ ext }) => {
  const { windowId } = await ext.openWindow(['alpha', 'tube1', 'tube2']);
  await ext.sw.evaluate((windowId) => chrome.tabs.create({ windowId, url: 'about:blank', active: false }), windowId);
  const page = await ext.open();
  // alpha and the blank page are among the recent tabs, so there is no last group.
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
  // notes2, the previous tab, has a tile among the recent tabs and one under its site.
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

// Esc fades the whole window at once, as a switch does: the site panels and
// the toolbar leave with the tiles, none of which animates on its own.
test('Esc fades the whole window at once, the site panels with their tiles', async ({ ext }) => {
  await ext.openWindow(VISITED);
  const page = await ext.open();
  await expect(page.locator('#grid.grouped .tile-group:not(.recent, .other)')).toHaveCount(SITES.length);
  await page.locator('#grid:not(.entering)').waitFor(); // the entrance is over
  // The window closes 150 ms after Esc: each animation that starts is noted
  // as it starts, in storage that outlives the page.
  await page.evaluate(() => {
    const started = [];
    document.addEventListener('animationstart', (e) => {
      started.push({ name: e.animationName, target: e.target.id || e.target.className });
      chrome.storage.session.set({ exitAnimations: started });
    }, true);
  });
  await ext.pressToClose(page, 'Escape');
  await expect.poll(() => ext.sw.evaluate(() => chrome.storage.session.get('exitAnimations').then((r) => r.exitAnimations)))
    .toEqual([{ name: 'rootFadeOut', target: 'root' }]);
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
  const page = await openAt800(ext);
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
  expect(shown.columns).toBe(4);
  for (const site of shown.sites) expect(site.span).toBe(`span ${Math.min(site.tiles, shown.columns)}`);
  expect(new Set(shown.sites.map((s) => s.top)).size).toBeLessThan(shown.sites.length); // some side by side
  const widths = shown.tiles.map((t) => t.width);
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1);
  // The five recent tabs cover every column.
  for (const { left } of shown.tiles) expect(shown.recentLefts.some((l) => Math.abs(l - left) < 1)).toBe(true);
  for (const row of new Set(shown.sites.map((s) => s.top))) {
    expect(new Set(shown.sites.filter((s) => s.top === row).map((s) => s.height)).size).toBe(1);
  }
});

test('resizing the window keeps the groups and the five recent tabs, and redraws only when a row holds a different number of tiles', async ({ ext }) => {
  await ext.openWindow(VISITED);
  const page = await openAt800(ext);
  await page.locator('#grid:not(.entering)').waitFor();
  const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  // Resize by dw, wait until the page has the new width, then two frames:
  // a redraw it sets off runs in the next one (events.js).
  const resize = async (dw) => {
    const width = await page.evaluate(() => innerWidth);
    await ext.sw.evaluate(async (dw) => {
      const [win] = await chrome.windows.getAll({ windowTypes: ['popup'] });
      await chrome.windows.update(win.id, { width: win.width + dw });
    }, dw);
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width + dw);
    await frames();
  };
  const recent = () => page.locator('#grid .tile-group.recent .tile').count();
  // A redraw puts new groups into the grid (measuring the row adds and
  // removes a bare probe, which does not count).
  await page.evaluate(() => {
    window.redraws = 0;
    new MutationObserver((records) => {
      if (records.some((r) => [...r.addedNodes].some((n) => n.classList?.contains('tile-group')))) window.redraws++;
    }).observe(document.getElementById('grid'), { childList: true });
  });
  expect(await columnsOf(page)).toBe(4);
  expect(await recent()).toBe(5);
  // A few pixels either way keep four tiles a row: nothing is redrawn.
  for (const dw of [6, 6, 6, -6, -6, -6]) await resize(dw);
  expect(await page.evaluate(() => window.redraws)).toBe(0);
  // Narrower by more than a tile: fewer columns, redrawn, still grouped,
  // still five recent tabs; and the same back at the first width.
  await resize(-300);
  expect(await columnsOf(page)).toBeLessThan(4);
  expect(await page.evaluate(() => window.redraws)).toBeGreaterThan(0);
  await expect(page.locator('#grid.grouped')).toHaveCount(1);
  expect(await recent()).toBe(5);
  await resize(300);
  expect(await columnsOf(page)).toBe(4);
  await expect(page.locator('#grid.grouped')).toHaveCount(1);
  expect(await recent()).toBe(5);
});

// The window fades in scaled down a little (rootFadeIn), and the grid can be
// drawn during it: the tiles that fit in a row are counted from the layout,
// so a draw then packs the panels as any later one does.
test('the opening fade does not change how many tiles a row holds', async ({ ext }) => {
  await ext.openWindow(VISITED);
  const page = await ext.open();
  await ext.sw.evaluate(async () => {
    const [win] = await chrome.windows.getAll({ windowTypes: ['popup'] });
    await chrome.windows.update(win.id, { width: 1280 });
  });
  const columns = () => page.evaluate(() => getComputedStyle(document.getElementById('grid')).gridTemplateColumns.split(' ').length);
  await expect.poll(columns).toBe(5);
  // Held scaled down, more than the fade does, then drawn again (a search and back).
  await page.addStyleTag({ content: '#root { animation: none; transform: scale(0.8); }' });
  await page.locator('#search').fill('a');
  await expect(page.locator('#grid.grouped')).toHaveCount(0);
  await page.locator('#search').fill('');
  await expect(page.locator('#grid.grouped')).toHaveCount(1);
  expect(await columns()).toBe(5);
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
