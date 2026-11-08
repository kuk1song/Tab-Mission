import { test, expect, PAGES, selectedTitle, pointAt, useShortcuts } from './fixtures.mjs';

// The move Tab Mission teaches: keep holding ⌘ (Ctrl and Shift elsewhere),
// point at a card, tap E; or point, then press the whole shortcut again.
// While the shortcut's modifiers are held, the selected card shows the key
// that completes it (dom.js showKeyWhileHeld).
const mac = process.platform === 'darwin';
const HELD = mac ? ['Meta'] : ['Control', 'Shift'];
// The same keys as CDP's modifiers bit field: Alt 1, Ctrl 2, Meta 4, Shift 8.
const HELD_BITS = mac ? 4 : 2 | 8;
const keycaps = (page) => page.locator('#grid .tile-key:visible');

test("holding the shortcut's modifiers, the selected card shows the key that completes it", async ({ ext }) => {
  await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  await expect(keycaps(page)).toHaveCount(0);
  for (const key of HELD) await page.keyboard.down(key);
  await expect(keycaps(page)).toHaveCount(1);
  await expect(page.locator('.tile.selected .tile-key')).toBeVisible();
  await expect(page.locator('.tile.selected .tile-key')).toHaveText('E');
  await expect(page.locator('.tile.selected .tile-key')).toHaveAttribute('aria-hidden', 'true');
  // Pointed at, another card takes the selection and the key.
  const card = page.locator('.tile').nth(2);
  await pointAt(page, card);
  await expect(card.locator('.tile-key')).toBeVisible();
  await expect(keycaps(page)).toHaveCount(1);
  // One modifier more, and E would not press the shortcut.
  await page.keyboard.down('Alt');
  await expect(keycaps(page)).toHaveCount(0);
  await page.keyboard.up('Alt');
  await expect(keycaps(page)).toHaveCount(1);
  // Nor with one modifier fewer.
  await page.keyboard.up(HELD[0]);
  await expect(keycaps(page)).toHaveCount(0);
  for (const key of HELD.slice(1)) await page.keyboard.up(key);
});

// Pressed for ⌘E in the browser, ⌘ is already down as the window opens, so
// the window sees no key go down: the pointer says that it is held.
test('the key shows for modifiers already down as the window opened, from the pointer', async ({ ext }) => {
  await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  const cdp = await page.context().newCDPSession(page);
  const box = await page.locator('.tile').nth(2).boundingBox();
  const move = (dx, modifiers) => cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: box.x + box.width / 2 + dx, y: box.y + box.height / 2, modifiers,
  });
  await move(0, HELD_BITS);
  // A pointer that has not yet moved 8 px leaves the selection alone: the
  // key shows on the previous tab's card, where E would go.
  expect(await selectedTitle(page)).toBe(PAGES.beta.title);
  await expect(page.locator('.tile.selected .tile-key')).toBeVisible();
  await move(2, 0);
  await expect(keycaps(page)).toHaveCount(0);
  await cdp.detach();
});

test('the key on the card is the last key of the shortcut the user set', async ({ ext, context }) => {
  await useShortcuts(context, { 'open-overview': 'Alt+Shift+K' });
  await ext.openWindow(['alpha', 'beta']);
  const page = await ext.open();
  await page.keyboard.down('Alt');
  await page.keyboard.down('Shift');
  await expect(page.locator('.tile.selected .tile-key')).toHaveText('K');
  await expect(keycaps(page)).toHaveCount(1);
  await page.keyboard.up('Shift');
  await page.keyboard.up('Alt');
  await expect(keycaps(page)).toHaveCount(0);
});

// A held modifier is not a key of its own (events.js): the card under the
// pointer stays selected, and Windows repeats a held key's keydown, Shift
// and Ctrl too, which must not stop the pointer from moving the selection.
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
