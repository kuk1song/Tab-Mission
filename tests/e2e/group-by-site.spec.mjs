import { test, expect, PAGES, selectedTitle } from './fixtures.mjs';

// "Group tabs by site" (settings page): the recent tabs first, then each
// site's tabs in tab-bar order, which stays put as you switch.
const VISITED = ['tube1', 'code1', 'tube2', 'notes1', 'code2', 'doc1', 'tube3'];

// Each group's label and its tiles' titles, in order. The recent group's
// label is translated, so it is left out.
function groups(page) {
  return page.locator('#grid .tile-group').evaluateAll((els) => els.map((el) => ({
    label: el.classList.contains('recent') ? 'recent' : el.querySelector('.group-label').textContent,
    titles: [...el.querySelectorAll('.tile .title')].map((t) => t.textContent),
  })));
}

test('grouped by site: the previous tab first, then sites in tab-bar order that stay put after a switch', async ({ ext }) => {
  await ext.sw.evaluate(() => chrome.storage.local.set({ groupBySite: true }));
  const { windowId } = await ext.openWindow(VISITED);
  let page = await ext.open();
  const before = await groups(page);
  expect(before.map((g) => g.label)).toEqual(['recent', 'tube.test', 'code.test', 'notes.test', 'docs.office.test']);
  // Recent: the previous tab (doc1), then the current one (tube3), then by last use.
  expect(before[0].titles).toEqual(['doc1', 'tube3', 'code2', 'notes1', 'tube2'].map((id) => PAGES[id].title));
  expect(before[1].titles).toEqual(['tube1', 'tube2', 'tube3'].map((id) => PAGES[id].title));
  expect(await selectedTitle(page)).toBe(PAGES.doc1.title);
  await expect(page.locator('#grid .tile')).toHaveCount(5 + VISITED.length);

  // ↓ goes to the tile straight below (which one depends on the window's
  // width: the recent group wraps when five tiles do not fit), ↑ comes back.
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
  await ext.sw.evaluate(() => chrome.storage.local.set({ groupBySite: true }));
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
  await ext.sw.evaluate(() => chrome.storage.local.set({ groupBySite: true }));
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

test('the settings page switch turns it on', async ({ ext, context }) => {
  const options = await context.newPage();
  await options.goto(ext.welcome.url().replace('welcome.html', 'options.html'));
  const toggle = options.locator('#group-by-site');
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect.poll(() => ext.sw.evaluate(() => chrome.storage.local.get('groupBySite').then((r) => r.groupBySite))).toBe(true);
  await options.close();
  await ext.openWindow(VISITED);
  const page = await ext.open();
  await expect(page.locator('#grid.grouped')).toHaveCount(1);
});
