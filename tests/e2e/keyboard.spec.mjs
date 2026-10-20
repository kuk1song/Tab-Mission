import { test, expect, PAGES, pointAt } from './fixtures.mjs';

test('typing never writes to storage; changing a toggle does', async ({ ext }) => {
  await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  await page.evaluate(() => {
    window.__writes = [];
    chrome.storage.onChanged.addListener((changes, area) => {
      // Page pictures (covers.js) may be stored at any moment; they are not
      // what typing could write.
      const picture = (key) => key === 'coverIndex' || /^cover:\d+$/.test(key);
      if (area === 'local') window.__writes.push(...Object.keys(changes).filter((key) => !picture(key)));
    });
  });
  await page.keyboard.type('page alpha');
  await expect(page.locator('.tile')).toHaveCount(1);
  await page.locator('#toggle-all-windows').click();
  await expect.poll(() => page.evaluate(() => window.__writes)).toContain('showAllWindows');
  // A write the typing set off would have come before the toggle's.
  expect((await page.evaluate(() => window.__writes)).filter((key) => key !== 'showAllWindows' && key !== 'showSleeping')).toEqual([]);
});

test('an Enter that commits an input method candidate does not switch tabs', async ({ ext }) => {
  const { windowId } = await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  await page.keyboard.type('alp');
  await expect(page.locator('.tile.selected')).toHaveCount(1);
  await page.locator('#search').dispatchEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true, bubbles: true });
  // A switch would start closing in the key's own handler (activateTab).
  await expect(page.locator('#root')).not.toHaveClass(/closing/);
  expect(ext.overviewPages()).toHaveLength(1);
  expect(await ext.activeTitle(windowId)).toBe(PAGES.gamma.title);
});

test('Enter on a focused toolbar button presses the button, not the selected tile', async ({ ext }) => {
  const { windowId } = await ext.openWindow(['alpha', 'beta', 'gamma']);
  // A saved size, which the reset button forgets first (background.js).
  await ext.sw.evaluate(() => chrome.storage.local.set({ overviewBounds: { width: 1000, height: 700 } }));
  const page = await ext.open();
  await page.keyboard.type('alp');
  await expect(page.locator('.tile.selected')).toHaveCount(1);
  await page.locator('#reset-window').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#root')).not.toHaveClass(/closing/);
  await expect.poll(() => ext.sw.evaluate(() => chrome.storage.local.get('overviewBounds').then((r) => r.overviewBounds))).toBe(null);
  expect(ext.overviewPages()).toHaveLength(1);
  expect(await ext.activeTitle(windowId)).toBe(PAGES.gamma.title);
});

test('Space toggles a focused checkbox; letters still go to the search box', async ({ ext }) => {
  await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  const toggle = page.locator('#toggle-sleeping');
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
  // The × of the card under the pointer (only a selected card's × is there).
  await pointAt(page, page.locator(`.tile[data-tab-id="${tabIds.alpha}"]`));
  await page.locator(`.tile[data-tab-id="${tabIds.alpha}"] .tile-close`).click();
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
