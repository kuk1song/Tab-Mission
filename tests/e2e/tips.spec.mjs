import { test, expect, pointAt } from './fixtures.mjs';

// Tips in the Tab Mission window (tips.js): at most one, pointing at what it
// explains, with no button; after a new install until learned (at most three
// times each), or always with "Show tips". Opened with the shortcut, the tip
// is on the previous tab's card; opened with a click, on the shortcut badge.
const giveTips = (ext) => ext.sw.evaluate(() => chrome.storage.local.set({ tipsLeft: { open: 3, back: 3 } }));
const tipsLeft = (ext) => ext.sw.evaluate(() => chrome.storage.local.get('tipsLeft').then((r) => r.tipsLeft));
const shortcutText = (ext) => ext.sw.evaluate(async () =>
  (await chrome.commands.getAll()).find((c) => c.name === 'open-overview').shortcut.replace(/\+/g, ' + '));
// The tip shows once the cards have settled (700 ms after opening).
const settle = (page) => page.waitForTimeout(1000);

// Open Tab Mission with the real shortcut, pressed in the window's current tab.
async function openWithShortcut(ext, context, windowId) {
  const url = await ext.sw.evaluate((id) => chrome.tabs.query({ active: true, windowId: id }).then((t) => t[0].url), windowId);
  const opened = context.waitForEvent('page', (p) => p.url().includes('/overview.html'));
  await ext.pressDefaultShortcut(context.pages().find((p) => p.url() === url));
  const overview = await opened;
  await overview.locator('#grid .tile').first().waitFor();
  return overview;
}

async function openWithToolbar(ext, context) {
  const opened = context.waitForEvent('page', (p) => p.url().includes('/overview.html'));
  await ext.clickToolbarButton();
  const overview = await opened;
  await overview.locator('#grid .tile').first().waitFor();
  return overview;
}

// Where the arrow points, and whether the tip lets the pointer through.
function tipGeometry(page) {
  return page.evaluate(() => {
    const tip = document.querySelector('.tip');
    const box = tip.getBoundingClientRect();
    const arrowX = box.left + parseFloat(tip.style.getPropertyValue('--arrow-x'));
    const under = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return { top: box.top, arrowX, passesPointer: !under?.closest('.tip') };
  });
}

test('opened with the shortcut, a tip points at the previous tab, with no button, letting the pointer through', async ({ ext, context }) => {
  const { windowId } = await ext.openWindow(['alpha', 'beta']);
  await giveTips(ext);
  const overview = await openWithShortcut(ext, context, windowId);
  const tip = overview.locator('.tip');
  await expect(tip).toBeVisible();
  await expect(tip).toHaveAttribute('data-anchor', 'card');
  await expect(tip).toHaveAttribute('role', 'status');
  await expect(tip.locator('kbd')).toHaveText(await shortcutText(ext));
  await expect(tip.locator('button')).toHaveCount(0);
  const card = await overview.locator('.tile.selected').boundingBox();
  const { top, arrowX, passesPointer } = await tipGeometry(overview);
  expect(top).toBeGreaterThan(card.y + card.height);
  expect(Math.abs(arrowX - (card.x + card.width / 2))).toBeLessThan(2);
  expect(passesPointer).toBe(true);
  await expect(overview.locator('.tip')).toHaveCount(1);
});

test('the card tip stays while the pointer moves on its card, and goes once the selection leaves it', async ({ ext, context }) => {
  const { windowId } = await ext.openWindow(['alpha', 'beta', 'gamma']);
  await giveTips(ext);
  const overview = await openWithShortcut(ext, context, windowId);
  const tip = overview.locator('.tip');
  await expect(tip).toBeVisible();
  await pointAt(overview, overview.locator('.tile.selected'));
  await settle(overview);
  await expect(tip).toBeVisible();
  // The shortcut would now go to the card under the pointer.
  await pointAt(overview, overview.locator('.tile').nth(1));
  await expect(overview.locator('.tip')).toHaveCount(0);
});

test('opened with the toolbar button, the tip points at the shortcut badge; the pointer leaves it, a key hides it', async ({ ext, context }) => {
  await ext.openWindow(['alpha', 'beta']);
  await giveTips(ext);
  const page = await openWithToolbar(ext, context);
  const tip = page.locator('.tip');
  await expect(tip).toBeVisible();
  await expect(tip).toHaveAttribute('data-anchor', 'badge');
  await expect(tip.locator('kbd')).toHaveText(await shortcutText(ext));
  const badge = await page.locator('#shortcut-hint kbd').boundingBox();
  const { top, arrowX } = await tipGeometry(page);
  expect(top).toBeGreaterThan(badge.y + badge.height);
  expect(Math.abs(arrowX - (badge.x + badge.width / 2))).toBeLessThan(2);
  // Onto a card, then out of the cards: the selection follows the pointer.
  await pointAt(page, page.locator('.tile').first());
  await page.mouse.move(4, 4, { steps: 4 });
  await expect(page.locator('.tile.selected')).toHaveCount(0);
  await expect(tip).toBeVisible();
  await page.keyboard.type('a');
  await expect(page.locator('.tip')).toHaveCount(0);
});

test("opened with the welcome page's button, the tip teaches the shortcut too", async ({ ext }) => {
  await ext.openWindow(['alpha', 'beta']);
  await giveTips(ext);
  const overview = await ext.open();
  await expect(overview.locator('.tip')).toHaveAttribute('data-anchor', 'badge');
});

test('done once, the card tip stops; "Show tips" shows it every time', async ({ ext, context }) => {
  const { windowId } = await ext.openWindow(['alpha', 'beta']);
  await giveTips(ext);
  let overview = await openWithShortcut(ext, context, windowId);
  await expect(overview.locator('.tip')).toBeVisible();
  // The step itself: the shortcut again goes back.
  await ext.pressDefaultShortcut(overview);
  await ext.expectClosed();

  overview = await openWithShortcut(ext, context, windowId);
  await settle(overview);
  await expect(overview.locator('.tip')).toHaveCount(0);
  await ext.pressToClose(overview, 'Escape');

  await ext.sw.evaluate(() => chrome.storage.local.set({ showTips: true }));
  overview = await openWithShortcut(ext, context, windowId);
  await expect(overview.locator('.tip')).toBeVisible();
});

test('on its own a tip shows at most three times; with "Show tips" on, showing it uses none', async ({ ext, context }) => {
  const { windowId } = await ext.openWindow(['alpha', 'beta']);
  await giveTips(ext);
  for (let i = 0; i < 3; i++) {
    const overview = await openWithShortcut(ext, context, windowId);
    await expect(overview.locator('.tip')).toBeVisible();
    await ext.pressToClose(overview, 'Escape');
  }
  expect(await tipsLeft(ext)).toEqual({ open: 3, back: 0 });
  let overview = await openWithShortcut(ext, context, windowId);
  await settle(overview);
  await expect(overview.locator('.tip')).toHaveCount(0);
  await ext.pressToClose(overview, 'Escape');

  await ext.sw.evaluate(() => chrome.storage.local.set({ showTips: true, tipsLeft: { open: 3, back: 3 } }));
  overview = await openWithShortcut(ext, context, windowId);
  await expect(overview.locator('.tip')).toBeVisible();
  await settle(overview);
  expect(await tipsLeft(ext)).toEqual({ open: 3, back: 3 });
});

test('no card tip when the selected card is the current tab (the only one)', async ({ ext, context }) => {
  const { windowId } = await ext.openWindow(['alpha']);
  await giveTips(ext);
  const overview = await openWithShortcut(ext, context, windowId);
  await settle(overview);
  await expect(overview.locator('.tile.selected')).toHaveCount(1);
  await expect(overview.locator('.tip')).toHaveCount(0);
});

test('no tip in a window too small to show it without covering the cards', async ({ ext, context }) => {
  const { windowId } = await ext.openWindow(['alpha', 'beta']);
  await giveTips(ext);
  await ext.sw.evaluate(() => chrome.storage.local.set({ overviewBounds: { width: 460, height: 360 } }));
  const overview = await openWithShortcut(ext, context, windowId);
  await settle(overview);
  await expect(overview.locator('.tip')).toHaveCount(0);
});
