import { test, expect, PAGES } from './fixtures.mjs';

// The cards (overview.css, dom.js): a picture with its title under it and no
// frame, an icon card for a page without a picture, colors that follow the
// system's light or dark appearance, and no blur.

const tile = (page, tabId) => page.locator(`.tile[data-tab-id="${tabId}"]`);

test('a page without a picture shows its site icon on a plate in the icon\'s color; one that is not a web page, its first letter', async ({ ext }) => {
  // beta, the window's first tab, may be pictured while the others load.
  const { windowId, tabIds } = await ext.openWindow(['beta', 'red', 'gamma']);
  const blank = await ext.sw.evaluate((windowId) => chrome.tabs.create({ windowId, url: 'about:blank', active: false }).then((t) => t.id), windowId);
  const page = await ext.open();
  const red = tile(page, tabIds.red);
  // The icon comes from Chrome's own store, not from the site.
  await expect(red.locator('.preview-icon img')).toHaveAttribute('src', /\/_favicon\/\?pageUrl=.*red\.html&size=32$/);
  await expect(red.locator('.preview-icon')).toBeVisible();
  // Tinted with the icon's red once the icon is read.
  await expect.poll(() => red.locator('.preview').evaluate((el) => el.style.getPropertyValue('--c'))).toBe('rgb(224 32 42)');
  await expect(tile(page, blank).locator('.preview-icon b')).toHaveText('A'); // about:blank
  // The title is shown once, under the picture, on up to two lines.
  const lines = await red.locator('.title').evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
  expect(lines).toBe(2);
  expect(await red.locator('.title').textContent()).toBe(PAGES.red.title);
});

test('a card with a picture shows the site icon on its corner, and the selected card a ring around its picture', async ({ ext }) => {
  const { tabIds } = await ext.openWindow(['beta', 'gamma']);
  await expect.poll(() => ext.sw.evaluate((key) => chrome.storage.local.get(key).then((r) => r[key]?.url ?? null), `cover:${tabIds.gamma}`), { timeout: 10_000 }).toBe(ext.url('gamma'));
  const page = await ext.open();
  const gamma = tile(page, tabIds.gamma);
  await expect(gamma.locator('.thumbnail.cover.loaded')).toHaveCount(1);
  await expect(gamma.locator('.site-badge')).toBeVisible();
  await expect(gamma.locator('.preview-icon')).toBeHidden();
  const selected = page.locator('.tile.selected');
  const ring = await selected.locator('.preview').evaluate((el) => {
    const s = getComputedStyle(el);
    return { style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor };
  });
  expect(ring.style).toBe('solid');
  expect(ring.width).toBe('3px');
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  expect(await selected.locator('.title').evaluate((el) => getComputedStyle(el).color)).toBe(await page.evaluate((c) => {
    const el = document.createElement('i'); el.style.color = c; document.body.append(el);
    const rgb = getComputedStyle(el).color; el.remove(); return rgb;
  }, accent));
});

test('the window follows the system appearance, and nothing is blurred', async ({ ext }) => {
  await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  const look = () => page.evaluate(() => ({
    bg: getComputedStyle(document.body).backgroundColor,
    fg: getComputedStyle(document.querySelector('.tile .title')).color,
    scheme: getComputedStyle(document.documentElement).colorScheme,
  }));
  await page.emulateMedia({ colorScheme: 'light' });
  const light = await look();
  await page.emulateMedia({ colorScheme: 'dark' });
  const dark = await look();
  expect(light.bg).toBe('rgb(244, 244, 247)');
  expect(dark.bg).toBe('rgb(22, 22, 24)'); // a neutral grey, not the old navy
  expect(light.fg).not.toBe(dark.fg);
  expect(light.scheme).toBe('light dark');
  const blurred = await page.evaluate(() => [...document.querySelectorAll('*')]
    .flatMap((el) => [getComputedStyle(el).backdropFilter, getComputedStyle(el, '::before').backdropFilter])
    .filter((v) => v && v !== 'none'));
  expect(blurred).toEqual([]);
});

test('the line under the title says where the page is, as the address bar does', async ({ ext }) => {
  const { windowId, tabIds } = await ext.openWindow(['alpha', 'tube1']);
  const ids = await ext.sw.evaluate(async (windowId) => {
    const version = await chrome.tabs.create({ windowId, url: 'chrome://version/', active: false });
    const blank = await chrome.tabs.create({ windowId, url: 'about:blank', active: false });
    const [welcome] = await chrome.tabs.query({ url: chrome.runtime.getURL('welcome.html') });
    return { version: version.id, blank: blank.id, welcome: welcome.id };
  }, windowId);
  const page = await ext.open();
  await page.locator('#toggle-all-windows').check(); // the welcome page is in another window
  const line = (id) => page.locator(`.tile[data-tab-id="${id}"] .url`);
  await expect(line(tabIds.tube1)).toHaveText('tube.test'); // www.tube.test
  await expect(line(tabIds.alpha)).toHaveText('localhost');
  await expect(line(ids.version)).toHaveText('chrome://version');
  await expect(line(ids.blank)).toHaveText('about:blank');
  await expect(line(ids.welcome)).toHaveText('Tab Mission');
});
