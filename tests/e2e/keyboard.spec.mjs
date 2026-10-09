import { test, expect, PAGES } from './fixtures.mjs';

test('typing never writes to storage; changing a toggle does', async ({ ext }) => {
  await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  await page.evaluate(() => {
    window.__writes = [];
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') window.__writes.push(...Object.keys(changes));
    });
  });
  await page.keyboard.type('page alpha');
  await expect(page.locator('.tile')).toHaveCount(1);
  expect(await page.evaluate(() => window.__writes)).toEqual([]);
  await page.locator('#toggle-current-window').click();
  await expect.poll(() => page.evaluate(() => window.__writes)).toContain('showAllWindows');
});

test('an Enter that commits an input method candidate does not switch tabs', async ({ ext }) => {
  const { windowId } = await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  await page.keyboard.type('alp');
  await expect(page.locator('.tile.selected')).toHaveCount(1);
  await page.locator('#search').dispatchEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true, bubbles: true });
  await page.waitForTimeout(300);
  expect(ext.overviewPages()).toHaveLength(1);
  expect(await ext.activeTitle(windowId)).toBe(PAGES.gamma.title);
});

test('Enter on a focused toolbar button presses the button, not the selected tile', async ({ ext }) => {
  const { windowId } = await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  await page.keyboard.type('alp');
  await expect(page.locator('.tile.selected')).toHaveCount(1);
  await page.locator('#reset-window').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  expect(ext.overviewPages()).toHaveLength(1);
  expect(await ext.activeTitle(windowId)).toBe(PAGES.gamma.title);
});

test('Space toggles a focused checkbox; letters still go to the search box', async ({ ext }) => {
  await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  const toggle = page.locator('#toggle-hide-discarded');
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toBeChecked();
  await expect(page.locator('#search')).toHaveValue('');
  await toggle.focus();
  await page.keyboard.press('a');
  await expect(page.locator('#search')).toHaveValue('a');
  await expect(page.locator('#search')).toBeFocused();
});

test('× on a tab closed elsewhere drops its tile and gives focus back to the search box', async ({ ext }) => {
  const { tabIds } = await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  await ext.sw.evaluate((id) => chrome.tabs.remove(id), tabIds.alpha);
  await page.locator(`.tile[data-tab-id="${tabIds.alpha}"] .tile-close`).click({ force: true });
  await expect(page.locator(`.tile[data-tab-id="${tabIds.alpha}"]`)).toHaveCount(0);
  await expect(page.locator('#search')).toBeFocused();
});

test('accessibility: listbox semantics, aria-expanded, and lang matching the text', async ({ ext }) => {
  await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  await expect(page.locator('#grid')).toHaveAttribute('role', 'listbox');
  await expect(page.locator('.tile').first()).toHaveAttribute('role', 'option');
  await page.keyboard.press('ArrowRight');
  const selectedId = await page.locator('.tile.selected').getAttribute('id');
  await expect(page.locator('#search')).toHaveAttribute('aria-activedescendant', selectedId);
  await page.keyboard.type('zzzz');
  await expect(page.locator('#search')).toHaveAttribute('aria-expanded', 'false');
  const { lang, placeholder } = await page.evaluate(() => ({ lang: document.documentElement.lang, placeholder: document.getElementById('search').placeholder }));
  expect(['en', 'it', 'zh-CN']).toContain(lang);
  expect(lang === 'zh-CN').toBe(/[一-鿿]/.test(placeholder));
});
