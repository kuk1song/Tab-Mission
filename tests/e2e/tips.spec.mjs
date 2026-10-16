import { test, expect } from './fixtures.mjs';

// Tips in the Tab Mission window (tips.js): one at a time, next to what they
// explain; after a new install until learned, or always with "Show tips".
const makeDue = (ext) => ext.sw.evaluate(() => chrome.storage.local.set({ tipsDue: true }));
const shortcutText = (ext) => ext.sw.evaluate(async () =>
  (await chrome.commands.getAll()).find((c) => c.name === 'open-overview').shortcut.replace(/\+/g, ' + '));
// The tip shows once the cards have settled (700 ms after opening).
const settle = (page) => page.waitForTimeout(1000);

test('after a new install, a tip hangs from the previous tab: the shortcut goes back there', async ({ ext }) => {
  await ext.openWindow(['alpha', 'beta']);
  await makeDue(ext);
  const overview = await ext.open();
  const tip = overview.locator('.tip-card');
  await expect(tip).toBeVisible();
  await expect(tip.locator('kbd')).toHaveText(await shortcutText(ext));
  await expect(tip).toHaveAttribute('role', 'status');
  const card = await overview.locator('.tile.selected').boundingBox();
  const box = await tip.boundingBox();
  expect(Math.abs(box.x - card.x)).toBeLessThan(2);
  expect(box.y).toBeGreaterThan(card.y + card.height);
  await expect(overview.locator('.tip')).toHaveCount(1);
});

test('done once, the tip stops; "Show tips" shows it every time', async ({ ext }) => {
  await ext.openWindow(['alpha', 'beta']);
  await makeDue(ext);
  let overview = await ext.open();
  await expect(overview.locator('.tip-card')).toBeVisible();
  // The step itself: the shortcut again goes back.
  await ext.pressDefaultShortcut(overview);
  await ext.expectClosed();

  overview = await ext.open();
  await settle(overview);
  await expect(overview.locator('.tip')).toHaveCount(0);
  await ext.pressToClose(overview, 'Escape');

  await ext.sw.evaluate(() => chrome.storage.local.set({ showTips: true }));
  overview = await ext.open();
  await expect(overview.locator('.tip-card')).toBeVisible();
});

test('a key hides the tip; "Got it" stops the tips until Getting started', async ({ ext }) => {
  await ext.openWindow(['alpha', 'beta']);
  await makeDue(ext);
  let overview = await ext.open();
  await expect(overview.locator('.tip-card')).toBeVisible();
  await overview.keyboard.type('a');
  await expect(overview.locator('.tip')).toHaveCount(0);
  await overview.keyboard.press('Escape');
  await ext.pressToClose(overview, 'Escape');

  overview = await ext.open();
  const tip = overview.locator('.tip-card');
  await expect(tip).toBeVisible();
  await tip.getByRole('button').click();
  await expect(overview.locator('.tip')).toHaveCount(0);
  await expect(overview.locator('#search')).toBeFocused();
  await expect.poll(() => ext.sw.evaluate(() => chrome.storage.local.get('tipsDue'))).toEqual({ tipsDue: false });
  await ext.pressToClose(overview, 'Escape');

  overview = await ext.open();
  await settle(overview);
  await expect(overview.locator('.tip')).toHaveCount(0);
});

test('opened with the toolbar button, the tip teaches the shortcut instead', async ({ ext, context }) => {
  await ext.openWindow(['alpha', 'beta']);
  await makeDue(ext);
  // background.js marks a toolbar-opened window with ?via=toolbar.
  const page = await context.newPage();
  await page.goto(`chrome-extension://${new URL(ext.sw.url()).host}/overview.html?via=toolbar`);
  const bar = page.locator('.tip-bar');
  await expect(bar).toBeVisible();
  await expect(bar.locator('kbd')).toHaveText(await shortcutText(ext));
  await expect(page.locator('.tip')).toHaveCount(1);
  await page.close();
});

test('no tip in a window too small to show it without covering the cards', async ({ ext }) => {
  await ext.openWindow(['alpha', 'beta']);
  await makeDue(ext);
  await ext.sw.evaluate(() => chrome.storage.local.set({ overviewBounds: { width: 460, height: 360 } }));
  const overview = await ext.open();
  await settle(overview);
  await expect(overview.locator('.tip')).toHaveCount(0);
});
