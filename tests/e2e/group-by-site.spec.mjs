import { test, expect, PAGES, selectedTitle } from './fixtures.mjs';

// "Group tabs by site" (on by default; off on the settings page): with more
// than two rows of tabs, one row of recent tabs first, then each site's tabs
// in tab-bar order, which stays put as you switch. Eleven tabs are more than
// two rows at any window width (a row holds at most five recent tabs).
const VISITED = ['alpha', 'tube1', 'code1', 'beta', 'tube2', 'notes1', 'gamma', 'code2', 'notes2', 'doc1', 'tube3'];
// By last use: the previous tab (doc1), the current one (tube3), then the rest.
const RECENT = ['doc1', 'tube3', 'notes2', 'code2', 'gamma'];

// Each group's label and its tiles' titles, in order. The recent group's
// label is translated, so it is left out.
function groups(page) {
  return page.locator('#grid .tile-group').evaluateAll((els) => els.map((el) => ({
    label: el.classList.contains('recent') ? 'recent' : el.querySelector('.group-label').textContent,
    titles: [...el.querySelectorAll('.tile .title')].map((t) => t.textContent),
  })));
}

test('grouped by site by default: one row of recent tabs, then sites in tab-bar order that stay put after a switch', async ({ ext }) => {
  const { windowId } = await ext.openWindow(VISITED);
  let page = await ext.open();
  await page.locator('#grid:not(.entering)').waitFor(); // the entrance has played
  const before = await groups(page);
  expect(before.map((g) => g.label)).toEqual(['recent', 'localhost', 'tube.test', 'code.test', 'notes.test', 'docs.office.test']);
  // As many recent tabs as fit in one row, at most five, by last use.
  const n = before[0].titles.length;
  expect(n).toBeGreaterThanOrEqual(1);
  expect(n).toBeLessThanOrEqual(5);
  expect(before[0].titles).toEqual(RECENT.slice(0, n).map((id) => PAGES[id].title));
  const tops = await page.locator('#grid .tile-group.recent .tile').evaluateAll((els) => els.map((el) => el.offsetTop));
  expect(new Set(tops).size).toBe(1);
  expect(before[2].titles).toEqual(['tube1', 'tube2', 'tube3'].map((id) => PAGES[id].title));
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

test('tabs without a site get a group of their own, and a click shows on the tile you clicked', async ({ ext }) => {
  const { windowId } = await ext.openWindow(VISITED);
  await ext.sw.evaluate((windowId) => chrome.tabs.create({ windowId, url: 'about:blank', active: false }), windowId);
  const page = await ext.open();
  await expect(page.locator('#grid .tile-group.recent')).toHaveCount(1);
  const last = page.locator('#grid .tile-group').last();
  await expect(last.locator('.tile')).toHaveCount(1);
  expect(await last.locator('.group-label').textContent()).not.toBe('');
  expect(await last.getAttribute('aria-label')).toBe(await last.locator('.group-label').textContent());

  // doc1 is in the recent group and under its site; click the site's tile.
  const siteTile = page.locator('#grid .tile-group:not(.recent) .tile', { hasText: PAGES.doc1.title });
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

test('the settings page switch turns it off, and with two rows of tabs or fewer the grid is as usual', async ({ ext, context }) => {
  // Six tabs fill no more than two rows at any width (five fit in one).
  await ext.openWindow(VISITED.slice(0, 6));
  let page = await ext.open();
  await expect(page.locator('#grid .tile').first()).toBeVisible();
  await expect(page.locator('#grid.grouped')).toHaveCount(0);
  await ext.pressToClose(page, 'Escape');

  const options = await context.newPage();
  await options.goto(ext.welcome.url().replace('welcome.html', 'options.html'));
  const toggle = options.locator('#group-by-site');
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect.poll(() => ext.sw.evaluate(() => chrome.storage.local.get('groupBySite').then((r) => r.groupBySite))).toBe(false);
  await options.close();
  await ext.openWindow(VISITED);
  page = await ext.open();
  await expect(page.locator('#grid .tile')).toHaveCount(VISITED.length); // the current window's
  await expect(page.locator('#grid.grouped')).toHaveCount(0);
});
