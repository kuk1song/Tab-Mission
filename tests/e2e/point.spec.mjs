import { test, expect, PAGES, selectedTitle, pointAt } from './fixtures.mjs';

// The move Tab Mission teaches: keep holding ⌘ (Ctrl and Shift elsewhere),
// point at a card, tap E; or point, then press the whole shortcut again.
// Also: type, then press the shortcut again.

// A modifier alone is not a key of its own (events.js): the card under the
// pointer stays selected, and a repeated keydown of a held modifier (Windows
// repeats Shift's) must not stop the pointer from moving the selection.
test('a held modifier leaves the selection with the pointer', async ({ ext }) => {
  await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  await pointAt(page, page.locator('.tile').nth(2));
  expect(await selectedTitle(page)).toBe(PAGES.alpha.title);
  await page.keyboard.down('Shift');
  await page.keyboard.down('Shift'); // repeated, as Windows sends it
  expect(await selectedTitle(page)).toBe(PAGES.alpha.title);
  // One move onto another card, which a pointer handed back to the keyboard
  // would only take as its starting point.
  const box = await page.locator('.tile').first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  expect(await selectedTitle(page)).toBe(PAGES.beta.title);
  await page.keyboard.up('Shift');
});

const stored = (ext, key) => ext.sw.evaluate((key) => chrome.storage.local.get(key).then((r) => r[key]), key);

test('the shortcut pressed on a card the pointer picked ticks the step to point, and in one write with the step back', async ({ ext }) => {
  const { windowId } = await ext.openWindow(['alpha', 'beta', 'gamma']);
  await ext.sw.evaluate(() => {
    self.__writes = [];
    chrome.storage.onChanged.addListener((changes) => self.__writes.push(Object.keys(changes).filter((k) => k.startsWith('tryIt')).sort()));
  });
  const page = await ext.open();
  await pointAt(page, page.locator('.tile').nth(2));
  // Pointed, then the whole shortcut: its modifier comes down in the window
  // first.
  await page.keyboard.down(process.platform === 'darwin' ? 'Meta' : 'Control');
  await ext.press();
  await ext.expectClosed();
  expect(await ext.activeTitle(windowId)).toBe(PAGES.alpha.title);
  await expect.poll(() => stored(ext, 'tryItPoint')).toBe(true);
  expect((await ext.sw.evaluate(() => self.__writes)).filter((k) => k.length)).toEqual([['tryItBack', 'tryItPoint']]);
});

// The site view picks its own selection, which the pointer did not choose.
test('after the site view picks the selection, the shortcut does not count as pointing', async ({ ext }) => {
  const { windowId } = await ext.openWindow(['alpha', 'tube1', 'tube2']);
  const page = await ext.open();
  await pointAt(page, page.locator('.tile', { hasText: PAGES.alpha.title }));
  await page.locator('#scope-hint').click();
  await expect(page.locator('#scope-token')).toBeVisible();
  expect(await selectedTitle(page)).toBe(PAGES.tube1.title);
  await ext.press();
  await ext.expectClosed();
  expect(await ext.activeTitle(windowId)).toBe(PAGES.tube1.title);
  await expect.poll(() => stored(ext, 'tryItBack')).toBe(true);
  expect(await stored(ext, 'tryItPoint')).toBeUndefined();
});

test('point at a card and press the real shortcut: it goes to that tab and ticks the step', { tag: '@real-shortcut' }, async ({ ext }) => {
  const { windowId } = await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  await pointAt(page, page.locator('.tile').nth(2));
  expect(await selectedTitle(page)).toBe(PAGES.alpha.title);
  await ext.pressDefaultShortcut(page);
  await ext.expectClosed();
  expect(await ext.activeTitle(windowId)).toBe(PAGES.alpha.title);
  await expect.poll(() => stored(ext, 'tryItPoint')).toBe(true);
});

test('type, then press the real shortcut again: it goes to the best match', { tag: '@real-shortcut' }, async ({ ext }) => {
  const { windowId } = await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  await page.keyboard.type('alpha');
  await expect(page.locator('.tile.selected .title')).toHaveText(PAGES.alpha.title);
  await ext.pressDefaultShortcut(page);
  await ext.expectClosed();
  expect(await ext.activeTitle(windowId)).toBe(PAGES.alpha.title);
  // Chosen by typing, not by pointing: the step to point is not done.
  await expect.poll(() => stored(ext, 'tryItBack')).toBe(true);
  expect(await stored(ext, 'tryItPoint')).toBeUndefined();
});
