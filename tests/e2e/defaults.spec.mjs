import { test, expect } from './fixtures.mjs';

// What a user has with nothing chosen (version 2): the cards spread out, on
// the page in front, the tab strip in view. And what the update from version
// 1 says, once. The fixture sets the grid in its own window for the other
// specs; these tests take that back.
const VISITED = ['alpha', 'doc1', 'tube1', 'beta', 'tube2', 'gamma'];
const SIZE = { width: 1000, height: 700 };

async function asInstalled(ext, more = {}) {
  await ext.sw.evaluate(async ({ more, size }) => {
    await chrome.storage.local.remove(['spread', 'openAs']);
    await chrome.storage.local.set(more);
    const browser = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    await chrome.windows.update(browser.id, { left: 0, top: 0, ...size });
  }, { more, size: SIZE });
}
const pageOf = (context, id) => context.pages().find((page) => new URL(page.url()).pathname === `/${id}.html`);
const frameOn = (page) => page.frames().find((frame) => frame.url().includes('/overlay.html'));
// The overview's frame on this page, once its cards have settled.
async function settledOn(page) {
  await expect.poll(() => Boolean(frameOn(page))).toBe(true);
  const frame = frameOn(page);
  await frame.locator('#grid .tile').first().waitFor();
  await frame.locator('#grid:not(.entering)').waitFor();
  return frame;
}
const stored = (ext, key) => ext.sw.evaluate((key) => chrome.storage.local.get(key).then((all) => all[key]), key);
const message = (frame, key) => frame.evaluate((key) => chrome.i18n.getMessage(key), key);

test('with nothing chosen, the real shortcut spreads the cards out on the page in front, in no window of its own', async ({ ext, context }) => {
  await ext.openWindow(VISITED);
  await asInstalled(ext);
  const page = pageOf(context, 'gamma');
  const windows = await ext.sw.evaluate(() => chrome.windows.getAll().then((all) => all.length));
  await ext.pressDefaultShortcut(page);
  const frame = await settledOn(page);
  await expect(frame.locator('html')).toHaveAttribute('data-spread', '');
  await expect(frame.locator('#grid')).toHaveClass(/\bspread\b/);
  await expect(frame.locator('#grid .tile')).toHaveCount(VISITED.length);
  expect(ext.overviewPages()).toEqual([]);
  expect(await ext.sw.evaluate(() => chrome.windows.getAll().then((all) => all.length))).toBe(windows);
  // The sizes come from how recently each tab was used: the first card is the largest.
  const widths = await frame.locator('#grid .tile .preview').evaluateAll((pictures) => pictures.map((picture) => picture.getBoundingClientRect().width));
  expect(widths[0]).toBeGreaterThan(Math.max(...widths.slice(2)));
});

test('the settings page shows those defaults, has no card sizes choice, and the grid is one switch away', async ({ ext, context }) => {
  await asInstalled(ext);
  const options = await context.newPage();
  await options.goto(`chrome-extension://${new URL(ext.sw.url()).host}/options.html`);
  await expect(options.locator('html')).not.toHaveClass(/loading/);
  await expect(options.locator('#spread')).toBeChecked();
  await expect(options.locator('#open-as')).toHaveValue('page');
  expect(await options.locator('#open-as option').evaluateAll((all) => all.map((option) => option.value))).toEqual(['page', 'window']);
  await expect(options.locator('#card-sizes')).toHaveCount(0);
  await expect(options.locator('label[for="open-as"]')).toHaveText(await message(options, 'optionOpenAs'));
  await options.locator('#spread').click();
  await expect.poll(() => stored(ext, 'spread')).toBe(false);
  // With it off, the next press opens the grid in a window of its own.
  await ext.openWindow(VISITED);
  const overview = await ext.open();
  await overview.locator('#grid:not(.entering)').waitFor();
  expect(new URL(overview.url()).searchParams.get('layout')).toBeNull();
  await expect(overview.locator('#grid')).not.toHaveClass(/\bspread\b/);
});

test('after the update from version 1, the overview says once that the look is new, at the settings button', async ({ ext, context }) => {
  await ext.openWindow(VISITED);
  await asInstalled(ext, { lookNotice: true });
  const page = pageOf(context, 'gamma');
  await ext.press();
  let frame = await settledOn(page);
  const tip = frame.locator('.tip');
  await expect(tip).toBeVisible();
  await expect(tip).toHaveText(await message(frame, 'lookNotice'));
  await expect(tip).toHaveAttribute('data-anchor', 'settings');
  await expect(frame.locator('#status')).toHaveText(await message(frame, 'lookNotice'));
  // It points at the settings button from below, inside the view, and lets the pointer through.
  const gear = await frame.locator('#open-settings').evaluate((el) => el.getBoundingClientRect().toJSON());
  const box = await tip.evaluate((el) => ({ ...el.getBoundingClientRect().toJSON(), arrow: el.getBoundingClientRect().left + Number.parseFloat(el.style.getPropertyValue('--arrow-x')), pointer: getComputedStyle(el).pointerEvents, view: innerWidth }));
  expect(box.top).toBeGreaterThanOrEqual(gear.bottom);
  expect(Math.abs(box.arrow - (gear.left + gear.width / 2))).toBeLessThan(17);
  expect(box.right).toBeLessThanOrEqual(box.view);
  expect(box.pointer).toBe('none');
  expect(await stored(ext, 'lookNotice')).toBeUndefined();
  // It goes as a tip does, and does not come back.
  await frame.locator('#search').press('Escape');
  await expect.poll(() => Boolean(frameOn(page))).toBe(false);
  await ext.press();
  frame = await settledOn(page);
  await expect(frame.locator('#grid .tile')).toHaveCount(VISITED.length);
  await expect(frame.locator('.tip')).toHaveCount(0);
});

test('with the grid chosen since the update, nothing is said, then or later', async ({ ext }) => {
  await ext.openWindow(VISITED);
  await asInstalled(ext, { lookNotice: true, spread: false });
  const overview = await ext.open();
  await overview.locator('#grid:not(.entering)').waitFor();
  await expect.poll(() => stored(ext, 'lookNotice')).toBeUndefined();
  await expect(overview.locator('.tip')).toHaveCount(0);
});

test('on a page zoomed to 150%, the layer still covers the page and the cards stay inside it', async ({ ext, context }) => {
  const { tabIds } = await ext.openWindow(VISITED);
  await asInstalled(ext);
  const page = pageOf(context, 'gamma');
  const before = await page.evaluate(() => ({ ratio: devicePixelRatio, width: innerWidth }));
  await ext.sw.evaluate((tabId) => chrome.tabs.setZoom(tabId, 1.5), tabIds.gamma);
  await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBeCloseTo(before.ratio * 1.5, 1);
  expect(await page.evaluate(() => innerWidth)).toBeLessThan(before.width * 0.7);
  await ext.press();
  const frame = await settledOn(page);
  const layer = await page.evaluate(() => {
    const r = document.documentElement.lastElementChild.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height, view: [innerWidth, innerHeight] };
  });
  expect([layer.left, layer.top]).toEqual([0, 0]);
  expect(Math.abs(layer.width - layer.view[0])).toBeLessThanOrEqual(1);
  expect(Math.abs(layer.height - layer.view[1])).toBeLessThanOrEqual(1);
  const inside = await frame.locator('#grid .tile .preview').evaluateAll((pictures) => pictures.map((picture) => {
    const r = picture.getBoundingClientRect();
    return r.left >= 0 && r.right <= innerWidth && r.width > 0;
  }));
  expect(inside).toEqual(VISITED.map(() => true));
});
