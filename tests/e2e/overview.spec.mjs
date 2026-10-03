import { test, expect, PAGES, tileTitles, selectedTitle } from './fixtures.mjs';

const { alpha, beta, gamma } = PAGES;

test('opens with the search focused, the previous tab first and nothing selected', async ({ ext }) => {
  await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  await expect(page.locator('#search')).toBeFocused();
  expect(await tileTitles(page)).toEqual([beta.title, gamma.title, alpha.title]);
  expect(await selectedTitle(page)).toBeNull();
});

test('→ selects the previous tab; typing pre-selects the best match; Enter switches', async ({ ext }) => {
  const { windowId } = await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  await page.keyboard.press('ArrowRight');
  expect(await selectedTitle(page)).toBe(beta.title);
  await page.keyboard.type('alp');
  await expect(page.locator('#search')).toHaveValue('alp');
  await expect.poll(() => selectedTitle(page)).toBe(alpha.title);
  await page.keyboard.press('Enter');
  await ext.expectClosed();
  expect(await ext.activeTitle(windowId)).toBe(alpha.title);
});

test('loads a relative og:image and serves it from the session cache on reopen', async ({ ext }) => {
  await ext.openWindow(['alpha', 'beta', 'gamma']);
  let page = await ext.open();
  await expect(page.locator('img.thumbnail.loaded[src$="/img/alpha.svg"]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await ext.expectClosed();
  const cached = await ext.sw.evaluate(() => chrome.storage.session.get('previewCache').then(({ previewCache }) =>
    Object.values(previewCache || {}).some((e) => e.img?.endsWith('/img/alpha.svg'))));
  expect(cached).toBe(true);
  page = await ext.open();
  await expect(page.locator('img.thumbnail[src$="/img/alpha.svg"]')).toHaveCount(1);
});

// Sleeping tabs are covered by the unit tests (applyFilters, isSleeping):
// chrome.tabs.discard brings down Playwright's Chromium 153 right after it
// succeeds, so the end-to-end suite never discards a tab.
test('a query searches other windows and dims the toggles', async ({ ext }) => {
  await ext.openWindow(['doc1', 'notes1']);
  await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  expect(await tileTitles(page)).not.toContain(PAGES.doc1.title);
  await page.keyboard.type('q4 plan');
  await expect(page.locator('.tile .title')).toHaveText([PAGES.doc1.title]);
  await expect(page.locator('.toolbar')).toHaveClass(/searching/);
});

test('all windows never lists the overview; erasing the query drops the selection', async ({ ext }) => {
  await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  await page.keyboard.type('page');
  await expect.poll(() => selectedTitle(page)).not.toBeNull();
  await page.locator('#search').fill('');
  await expect.poll(() => selectedTitle(page)).toBeNull();
  await page.locator('#toggle-current-window').click();
  await expect(page.locator('#search')).toBeFocused();
  const overviewTabId = await ext.sw.evaluate(() =>
    chrome.tabs.query({ url: chrome.runtime.getURL('overview.html') + '*' }).then((t) => t[0].id));
  await expect(page.locator(`.tile[data-tab-id="${overviewTabId}"]`)).toHaveCount(0);
});

test('× and middle-click close tabs', async ({ ext }) => {
  const { tabIds } = await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  await page.locator(`.tile[data-tab-id="${tabIds.alpha}"]`).hover();
  await page.locator(`.tile[data-tab-id="${tabIds.alpha}"] .tile-close`).click();
  await expect(page.locator('.tile')).toHaveCount(2);
  await page.locator(`.tile[data-tab-id="${tabIds.beta}"]`).click({ button: 'middle' });
  await expect(page.locator('.tile')).toHaveCount(1);
  const open = await ext.sw.evaluate((ids) => chrome.tabs.query({}).then((t) => ids.filter((id) => t.some((x) => x.id === id))), [tabIds.alpha, tabIds.beta]);
  expect(open).toEqual([]);
});

test('Esc clears the query first, then closes without switching', async ({ ext }) => {
  const { windowId } = await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  await page.keyboard.type('alp');
  await page.keyboard.press('Escape');
  await expect(page.locator('#search')).toHaveValue('');
  expect(ext.overviewPages()).toHaveLength(1);
  await page.keyboard.press('Escape');
  await ext.expectClosed();
  expect(await ext.activeTitle(windowId)).toBe(gamma.title);
});
