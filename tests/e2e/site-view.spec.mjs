import { test, expect, PAGES, tileTitles, selectedTitle, pointAt } from './fixtures.mjs';

// Current tab tube2, previous tube1, both on www.tube.test.
const WINDOW = ['notes1', 'doc1', 'code1', 'code2', 'notes2', 'tube1', 'tube2'];

test('Tab enters the site view: previous tab first, current second, token in the field', async ({ ext }) => {
  await ext.openWindow(WINDOW);
  const page = await ext.open();
  await expect(page.locator('#scope-hint')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.locator('#scope-token')).toBeVisible();
  await expect(page.locator('#scope-label')).toHaveText('tube.test');
  expect(await tileTitles(page)).toEqual([PAGES.tube1.title, PAGES.tube2.title]);
});

test('the shortcut inside the site view switches to the selected tab', async ({ ext }) => {
  const { windowId } = await ext.openWindow(WINDOW);
  const page = await ext.open();
  await page.keyboard.press('Tab');
  expect(await selectedTitle(page)).toBe(PAGES.tube1.title);
  await page.keyboard.press('ArrowRight');
  expect(await selectedTitle(page)).toBe(PAGES.tube2.title);
  await ext.press();
  await ext.expectClosed();
  expect(await ext.activeTitle(windowId)).toBe(PAGES.tube2.title);
});

test('pointing at a tile in the site view and pressing the shortcut switches to it', async ({ ext }) => {
  const { windowId } = await ext.openWindow(WINDOW);
  const page = await ext.open();
  await page.keyboard.press('Tab');
  await pointAt(page, page.locator('.tile').nth(1));
  await ext.press();
  await ext.expectClosed();
  expect(await ext.activeTitle(windowId)).toBe(PAGES.tube2.title);
});

test('the site shortcut narrows an open overview in place; pressed again it goes to the site\'s previous tab', async ({ ext }) => {
  const { windowId } = await ext.openWindow(WINDOW);
  const page = await ext.open();
  await ext.press('site');
  await expect(page.locator('#scope-token')).toBeVisible();
  expect(ext.overviewPages()).toHaveLength(1);
  await ext.press('site');
  await ext.expectClosed();
  expect(await ext.activeTitle(windowId)).toBe(PAGES.tube1.title);
});

test('the site shortcut opens straight into the site view', async ({ ext }) => {
  await ext.openWindow(WINDOW);
  const page = await ext.open('site');
  await expect(page.locator('#scope-token')).toBeVisible();
  expect(await tileTitles(page)).toHaveLength(2);
});

test('leaving: Backspace at the start keeps the text, Shift+Tab, the ×, then Esc steps back', async ({ ext }) => {
  await ext.openWindow(WINDOW);
  const page = await ext.open();
  const token = page.locator('#scope-token');

  await page.keyboard.press('Tab');
  await page.keyboard.type('cs');
  await page.locator('#search').evaluate((el) => el.setSelectionRange(0, 0));
  await page.keyboard.press('Backspace');
  await expect(token).toBeHidden();
  await expect(page.locator('#search')).toHaveValue('cs');

  await page.locator('#search').fill('');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(token).toBeHidden();

  await page.keyboard.press('Tab');
  await page.locator('#scope-clear').click();
  await expect(token).toBeHidden();

  await page.keyboard.press('Tab');
  await page.keyboard.type('cs');
  await page.keyboard.press('Escape');
  await expect(page.locator('#search')).toHaveValue('');
  await expect(token).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(token).toBeHidden();
  await ext.pressToClose(page, 'Escape');
});

test('no match in the site view offers to search all tabs, keeping the query', async ({ ext }) => {
  await ext.openWindow(WINDOW);
  const page = await ext.open();
  await page.keyboard.press('Tab');
  await page.keyboard.type('pull');
  await expect(page.locator('.empty-widen')).toBeVisible();
  await page.locator('.empty-widen').click();
  await expect(page.locator('#scope-token')).toBeHidden();
  await expect(page.locator('#search')).toHaveValue('pull');
  expect(await tileTitles(page)).toEqual([PAGES.code1.title]);
});

test('the site view follows the window toggle, and so does the hint count', async ({ ext }) => {
  await ext.openWindow(['tube3', 'notes1']);
  await ext.openWindow(WINDOW);
  const page = await ext.open();
  const hint = page.locator('#scope-hint-label');
  await expect(hint).toContainText('2');
  await page.locator('#toggle-current-window').click();
  await expect(hint).toContainText('3');
  await page.keyboard.press('Tab');
  expect(await tileTitles(page)).toHaveLength(3);
  await page.locator('#toggle-current-window').click();
  expect(await tileTitles(page)).toHaveLength(2);
});
