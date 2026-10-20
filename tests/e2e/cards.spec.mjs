import { test, expect, PAGES } from './fixtures.mjs';

// The cards (overview.css, dom.js): a picture with its title under it and no
// frame, an icon card for a page without a picture, colors that follow the
// system's light or dark appearance, and no blur.

const tile = (page, tabId) => page.locator(`.tile[data-tab-id="${tabId}"]`);

test('a page without a picture shows its site icon on a plate in the icon\'s color; one that is not a web page, its first letter', async ({ ext }) => {
  // beta, the window's first tab, may be pictured while the others load.
  const { windowId, tabIds } = await ext.openWindow(['beta', 'red', 'gamma']);
  const blank = await ext.openTab(windowId, 'about:blank');
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
  // A title of a tile that is not selected (the selected one takes the
  // accent), and the --fg token it should take, as a color.
  const look = () => page.evaluate(() => {
    const token = document.createElement('i');
    token.style.color = 'var(--fg)';
    document.body.append(token);
    const fg = getComputedStyle(token).color;
    token.remove();
    return {
      bg: getComputedStyle(document.body).backgroundColor,
      title: getComputedStyle(document.querySelector('.tile:not(.selected) .title')).color,
      fg,
      scheme: getComputedStyle(document.documentElement).colorScheme,
    };
  });
  await page.emulateMedia({ colorScheme: 'light' });
  const light = await look();
  await page.emulateMedia({ colorScheme: 'dark' });
  const dark = await look();
  expect(light.bg).toBe('rgb(244, 244, 247)');
  expect(dark.bg).toBe('rgb(22, 22, 24)'); // a neutral grey, not the old navy
  expect(light.title).toBe(light.fg);
  expect(dark.title).toBe(dark.fg);
  expect(light.fg).not.toBe(dark.fg);
  expect(light.scheme).toBe('light dark');
  const blurred = await page.evaluate(() => [...document.querySelectorAll('*')]
    .flatMap((el) => [getComputedStyle(el).backdropFilter, getComputedStyle(el, '::before').backdropFilter])
    .filter((v) => v && v !== 'none'));
  expect(blurred).toEqual([]);
});

test('the line under the title says where the page is, as the address bar does', async ({ ext }) => {
  const { windowId, tabIds } = await ext.openWindow(['alpha', 'tube1']);
  const ids = {
    version: await ext.openTab(windowId, 'chrome://version/'),
    blank: await ext.openTab(windowId, 'about:blank'),
    welcome: await ext.sw.evaluate(() => chrome.tabs.query({ url: chrome.runtime.getURL('welcome.html') }).then(([t]) => t.id)),
  };
  const page = await ext.open();
  await page.locator('#toggle-all-windows').check(); // the welcome page is in another window
  const line = (id) => page.locator(`.tile[data-tab-id="${id}"] .url`);
  await expect(line(tabIds.tube1)).toHaveText('tube.test'); // www.tube.test
  await expect(line(tabIds.alpha)).toHaveText('localhost');
  await expect(line(ids.version)).toHaveText('chrome://version');
  await expect(line(ids.blank)).toHaveText('about:blank');
  await expect(line(ids.welcome)).toHaveText('Tab Mission');
});

// A tab whose site has not answered yet has no address or title, only the
// address it is going to (Tab.pendingUrl): its card shows that address, and
// search and grouping by site use it.
test('a tab still waiting for its site shows where it is going, and search and grouping find it there', async ({ ext }) => {
  await ext.sw.evaluate(() => chrome.storage.local.remove('groupBySite')); // grouped, as users have it
  const { windowId } = await ext.openWindow(['alpha', 'tube1']);
  const waiting = ext.url('tube1').replace('/tube1.html', '/held/watch.html'); // tube1's site
  const id = await ext.sw.evaluate(({ windowId, url }) => chrome.tabs.create({ windowId, url, active: false }).then((t) => t.id), { windowId, url: waiting });
  await expect.poll(() => ext.sw.evaluate((id) => chrome.tabs.get(id).then((t) => [t.url, t.title, t.pendingUrl]), id)).toEqual(['', '', waiting]);
  const page = await ext.open();
  // In tube1's site's panel, beside it.
  const panel = page.locator('#grid .tile-group:not(.recent)', { has: page.locator(`.tile[data-tab-id="${id}"]`) });
  await expect(panel.locator('.group-name')).toHaveText('tube.test');
  const tile = panel.locator(`.tile[data-tab-id="${id}"]`);
  await expect(tile.locator('.title')).toHaveText(`${new URL(waiting).host.replace(/^www\./, '')}/held/watch.html`);
  await expect(tile.locator('.url')).toHaveText('tube.test');
  await page.keyboard.type('watch');
  await expect(page.locator('#grid .tile')).toHaveCount(1);
  await expect(page.locator(`#grid .tile[data-tab-id="${id}"]`)).toHaveCount(1);
});
