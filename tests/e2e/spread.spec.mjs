import { test, expect, PAGES, selectedTitle, pointAt } from './fixtures.mjs';

// "Spread the cards out" and "Backdrop" (settings page, both off by
// default; src/spread.js, src/backdrop.js): every card in view at once, the
// tabs used more recently larger, a label under each picture; behind them
// a wallpaper or a blurred picture of the page you were on.
const VISITED = ['alpha', 'doc1', 'tube1', 'beta', 'tube2', 'gamma'];
// By last use: the previous tab first, the current one beside it.
const ORDER = ['tube2', 'gamma', 'beta', 'tube1', 'doc1', 'alpha'];
// Two more: too many to keep their titles in that window, few enough to stay spread out.
const EIGHT = [...VISITED, 'code1', 'notes1'];

// A window that fits the Windows runner's 1024 px screen. Six cards spread
// out in it keep their titles, eight show icons, sixteen go to the grid
// (spread.test covers the sizes).
async function openWith(ext, settings) {
  await ext.sw.evaluate((settings) => chrome.storage.local.set({ overviewBounds: { width: 800, height: 600 }, ...settings }), settings);
  const page = await ext.open();
  await page.locator('#grid:not(.entering)').waitFor();
  return page;
}

// Each card's picture and, when shown, its label, in the window's coordinates.
const cards = (page) => page.locator('#grid .tile').evaluateAll((tiles) => tiles.map((tile) => {
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return r.width ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width } : null;
  };
  return { title: tile.querySelector('.title').textContent, picture: box(tile.querySelector('.preview')), label: box(tile.querySelector('.meta')) };
}));
const overlap = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;

// The lowest contrast of each kind of text against the pixels really behind
// it (WCAG F83: the part of a picture or gradient that contrasts least):
// the text's colors are read, the text hidden, the window shot.
async function worstContrast(page, selectors) {
  await page.waitForFunction(() => !document.getAnimations().some((a) => a.playState === 'running'));
  const items = await page.evaluate((selectors) => {
    const found = [];
    for (const [kind, selector] of Object.entries(selectors)) {
      for (const el of document.querySelectorAll(selector)) {
        const r = el.getBoundingClientRect();
        if (r.width < 6 || r.height < 6 || r.bottom > innerHeight || r.top < 0 || !el.checkVisibility()) continue;
        const color = el.matches('input') ? getComputedStyle(el, '::placeholder').color : getComputedStyle(el).color;
        found.push({ kind, color, x: r.x, y: r.y, w: r.width, h: r.height });
      }
    }
    return found;
  }, selectors);
  await page.addStyleTag({ content: '*, *::placeholder { color: transparent !important; caret-color: transparent !important; transition: none !important; }' });
  const shot = (await page.screenshot()).toString('base64');
  return page.evaluate(async ({ shot, items }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${shot}`;
    await image.decode();
    const scale = image.width / innerWidth;
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const linear = (v) => (v <= 10.31475 ? v / 3294.6 : ((v / 255 + 0.055) / 1.055) ** 2.4);
    const luminance = (r, g, b) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
    const worst = {};
    for (const item of items) {
      const [r, g, b] = item.color.match(/[\d.]+/g).map(Number);
      const text = luminance(r, g, b);
      // One CSS pixel in from the box's edges (a keycap's border is not behind its letter).
      const data = context.getImageData(Math.ceil((item.x + 1) * scale), Math.ceil((item.y + 1) * scale),
        Math.floor((item.w - 2) * scale), Math.floor((item.h - 2) * scale)).data;
      let least = Infinity;
      for (let i = 0; i < data.length; i += 4) {
        const behind = luminance(data[i], data[i + 1], data[i + 2]);
        least = Math.min(least, (Math.max(text, behind) + 0.05) / (Math.min(text, behind) + 0.05));
      }
      worst[item.kind] = Math.min(worst[item.kind] ?? Infinity, least);
    }
    return worst;
  }, { shot, items });
}

test('off by default: the grid, and no backdrop', async ({ ext }) => {
  await ext.openWindow(VISITED);
  const page = await openWith(ext, {});
  await expect(page.locator('#grid')).not.toHaveClass(/spread/);
  expect(await page.evaluate(() => ({ ...document.documentElement.dataset }))).toEqual({});
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('backdrop')).display)).toBe('none');
  expect(new URL(page.url()).search).toBe('?via=click');
});

test('spread out: every card in view, none on another, the previous tab first and largest, a label under each', async ({ ext }) => {
  await ext.openWindow(VISITED);
  const page = await openWith(ext, { spread: true });
  await expect(page.locator('#grid')).toHaveClass(/\bspread\b/);
  await expect(page.locator('#grid')).not.toHaveClass(/\bsmall\b/);
  expect(await page.evaluate(() => document.documentElement.dataset.layout)).toBe('spread');

  const shown = await cards(page);
  expect(shown.map((card) => card.title)).toEqual(ORDER.map((id) => PAGES[id].title));
  expect(await selectedTitle(page)).toBe(PAGES.tube2.title);
  // Nothing scrolls and nothing is cut off: pictures and labels are inside the grid.
  const grid = await page.locator('#grid').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, scrolls: el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth };
  });
  expect(grid.scrolls).toBe(false);
  const all = shown.flatMap((card) => [card.picture, card.label]);
  expect(all.every(Boolean)).toBe(true);
  for (const box of all) {
    expect(box.left).toBeGreaterThanOrEqual(grid.left);
    expect(box.right).toBeLessThanOrEqual(grid.right);
    expect(box.top).toBeGreaterThanOrEqual(grid.top);
    expect(box.bottom).toBeLessThanOrEqual(grid.bottom);
  }
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) expect(overlap(all[i], all[j]), `boxes ${i} and ${j}`).toBe(false);
  }
  // Larger the more recently used; on more than one row, and not in columns.
  const widths = shown.map((card) => card.picture.width);
  expect(widths[0]).toBeGreaterThan(widths[1]);
  expect(widths[1]).toBeGreaterThan(widths[5]);
  for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeLessThanOrEqual(widths[i - 1] + 0.5);
  expect(new Set(shown.map((card) => Math.round(card.picture.top))).size).toBeGreaterThan(1);
  expect(new Set(shown.map((card) => Math.round(card.picture.left))).size).toBe(shown.length);
  // The label: the site's icon and the title on one line, no address.
  await expect(page.locator('#grid .tile .url:visible')).toHaveCount(0);
  await expect(page.locator('#grid .tile .meta-icon img')).toHaveCount(6);
  const lines = await page.locator('#grid .tile .title').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
  expect(Math.max(...lines)).toBeLessThanOrEqual(20);
});

test('spread out: arrows go by position, Enter switches to the selected tab', async ({ ext }) => {
  const { windowId } = await ext.openWindow(VISITED);
  const page = await openWith(ext, { spread: true });
  const selected = () => page.locator('#grid .tile.selected').evaluate((tile) => {
    const r = tile.querySelector('.preview').getBoundingClientRect();
    return { index: Number(tile.dataset.index), top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  });
  const first = await selected();
  expect(first.index).toBe(0);
  await page.keyboard.press('ArrowRight');
  const right = await selected();
  expect(right.index).toBe(1);
  expect(right.left).toBeGreaterThanOrEqual(first.right);
  await page.keyboard.press('ArrowLeft');
  expect((await selected()).index).toBe(0);
  await page.keyboard.press('ArrowRight');
  // Down to the row below, to the card nearest under this one; up again to the first row.
  await page.keyboard.press('ArrowDown');
  const down = await selected();
  expect(down.top).toBeGreaterThanOrEqual(right.bottom);
  expect(down.left).toBeLessThan(right.right);
  expect(down.right).toBeGreaterThan(right.left);
  await page.keyboard.press('ArrowUp');
  const up = await selected();
  expect(up.bottom).toBeLessThanOrEqual(down.top);
  expect(Math.round(up.top - first.top)).toBeLessThan(Math.round(first.bottom - first.top));
  // Enter on a card of the row below.
  await page.keyboard.press('ArrowDown');
  const title = await selectedTitle(page);
  expect(ORDER.slice(2).map((id) => PAGES[id].title)).toContain(title);
  await ext.pressToClose(page, 'Enter');
  await expect.poll(() => ext.activeTitle(windowId)).toBe(title);
});

test('spread out: a search places its matches again; the pointer selects, × closes and the rest move up', async ({ ext }) => {
  const { tabIds } = await ext.openWindow(VISITED);
  const page = await openWith(ext, { spread: true });
  const before = await cards(page);
  await page.keyboard.type('Tube');
  await expect(page.locator('#grid .tile')).toHaveCount(2);
  const matches = await cards(page);
  expect(matches.map((card) => card.title)).toEqual([PAGES.tube2.title, PAGES.tube1.title]);
  // Placed for two cards: larger than they were among eight, side by side.
  expect(matches[0].picture.width).toBeGreaterThan(before[2].picture.width);
  expect(matches[1].picture.left).toBeGreaterThanOrEqual(matches[0].picture.right);
  await page.keyboard.press('Escape');
  await expect(page.locator('#grid .tile')).toHaveCount(6);
  expect(await cards(page)).toEqual(before);

  // The pointer on a label selects its card too.
  const tube1 = page.locator(`#grid .tile[data-tab-id="${tabIds.tube1}"]`);
  await pointAt(page, tube1.locator('.meta'));
  expect(await selectedTitle(page)).toBe(PAGES.tube1.title);
  await pointAt(page, tube1.locator('.preview'));
  await tube1.locator('.tile-close').click();
  await expect(page.locator('#grid .tile')).toHaveCount(5);
  const after = await cards(page);
  expect(after.map((card) => card.title)).not.toContain(PAGES.tube1.title);
  expect(after.every((card) => card.picture && card.label)).toBe(true);
  await expect.poll(() => ext.sw.evaluate((id) => chrome.tabs.get(id).then(() => true, () => false), tabIds.tube1)).toBe(false);
});

test('spread out: too many tabs to tell apart show the grid; a search that leaves a few spreads them out', async ({ ext }) => {
  await ext.openWindow([...EIGHT, ...EIGHT.map((id) => `${id}?again`)]);
  const page = await openWith(ext, { spread: true });
  await expect(page.locator('#grid .tile')).toHaveCount(16);
  await expect(page.locator('#grid')).not.toHaveClass(/spread/);
  expect(await page.evaluate(() => document.documentElement.dataset.layout)).toBeUndefined();
  // The grid as without the setting: the cards on its columns, an address under each title.
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('grid')).display)).toBe('grid');
  await expect(page.locator('#grid .tile .url').first()).toBeVisible();
  expect(await page.locator('#grid .tile').first().evaluate((tile) => getComputedStyle(tile).position)).toBe('relative');

  await page.keyboard.type('Tube');
  await expect(page.locator('#grid .tile')).toHaveCount(4);
  await expect(page.locator('#grid')).toHaveClass(/\bspread\b/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#grid .tile')).toHaveCount(16);
  await expect(page.locator('#grid')).not.toHaveClass(/spread/);
  expect(await page.locator('#grid .tile').first().evaluate((tile) => getComputedStyle(tile).position)).toBe('relative');
});

test('spread out: a few more tabs than keep their titles show icons, and the selected card its label', async ({ ext }) => {
  await ext.openWindow(EIGHT);
  const page = await openWith(ext, { spread: true });
  await expect(page.locator('#grid')).toHaveClass(/\bspread\b/);
  await expect(page.locator('#grid')).toHaveClass(/\bsmall\b/);
  await expect(page.locator('#grid .tile')).toHaveCount(8);
  await expect(page.locator('#grid .tile .meta:visible')).toHaveCount(1);
  await expect(page.locator('#grid .tile.selected .title')).toHaveText(PAGES.code1.title);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#grid .tile .meta:visible')).toHaveCount(1);
  await expect(page.locator('#grid .tile.selected .title')).toHaveText(PAGES.notes1.title);
  // Nothing is cut off here either.
  const grid = await page.locator('#grid').evaluate((el) => el.getBoundingClientRect().toJSON());
  for (const card of await cards(page)) {
    expect(card.picture.right).toBeLessThanOrEqual(grid.right);
    expect(card.picture.bottom).toBeLessThanOrEqual(grid.bottom);
  }
});

test('spread out: resizing the window places the cards for its new size', async ({ ext }) => {
  await ext.openWindow(VISITED);
  const page = await openWith(ext, { spread: true });
  const before = await cards(page);
  await page.evaluate(() => chrome.windows.getCurrent().then((w) => chrome.windows.update(w.id, { width: 700, height: 560 })));
  await expect.poll(async () => (await cards(page))[0].picture.width).toBeLessThan(before[0].picture.width - 1);
  const after = await cards(page);
  const grid = await page.locator('#grid').evaluate((el) => el.getBoundingClientRect().toJSON());
  for (const card of after) {
    expect(card.picture.right).toBeLessThanOrEqual(grid.right);
    expect(card.label.bottom).toBeLessThanOrEqual(grid.bottom);
  }
});

for (const appearance of ['light', 'dark']) {
  test(`wallpaper backdrop, ${appearance}: shown behind the cards, and every text keeps 4.5:1 on it`, async ({ ext }) => {
    await ext.sw.evaluate(() => chrome.storage.local.remove('groupBySite')); // panels and group names, as users have them
    await ext.openWindow(VISITED);
    let page = await openWith(ext, { backdrop: 'wallpaper', appearance });
    expect(await page.evaluate(() => document.documentElement.dataset.backdrop)).toBe('wallpaper');
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('backdrop'), '::before').backgroundImage)).toContain('radial-gradient');
    // In the grid, titles and addresses stand on the backdrop itself.
    const texts = { title: '.tile .title', address: '.tile .url', group: '.group-name', count: '.group-count', toggle: '.ctrl span', hint: '#shortcut-hint kbd', placeholder: '#search' };
    const grid = await worstContrast(page, texts);
    expect(Object.keys(grid).sort()).toEqual(Object.keys(texts).sort());
    for (const [kind, ratio] of Object.entries(grid)) expect(ratio, `grid, ${kind}`).toBeGreaterThanOrEqual(4.5);
    await ext.pressToClose(page, 'Escape');

    // Spread out, titles are on their labels and the backdrop shows more.
    page = await openWith(ext, { backdrop: 'wallpaper', appearance, spread: true });
    const tint = () => page.evaluate(() => Number(getComputedStyle(document.getElementById('backdrop'), '::after').opacity));
    await expect.poll(tint).toBeLessThanOrEqual(0.5);
    const spread = await worstContrast(page, { title: '.tile:not(.selected) .title', selected: '.tile.selected .title', toggle: '.ctrl span', hint: '#shortcut-hint kbd', placeholder: '#search' });
    expect(Object.keys(spread)).toHaveLength(5);
    for (const [kind, ratio] of Object.entries(spread)) expect(ratio, `spread out, ${kind}`).toBeGreaterThanOrEqual(4.5);
  });
}

test('page backdrop: a blurred picture of the page you were on, tinted as much as its texts need; plain without a picture', async ({ ext }) => {
  const { windowId, tabIds } = await ext.openWindow(VISITED);
  const cover = (tabId) => ext.sw.evaluate((key) => chrome.storage.local.get(key).then((r) => Boolean(r[key])), `cover:${tabId}`);
  await expect.poll(() => cover(tabIds.gamma), { timeout: 10_000 }).toBe(true);
  // Dark, over a white page: the hardest case for light text.
  let page = await openWith(ext, { backdrop: 'page', appearance: 'dark' });
  await expect(page.locator('#backdrop')).toHaveAttribute('data-picture', '');
  expect(await page.evaluate(() => document.documentElement.dataset.backdrop)).toBe('page');
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('backdrop'), '::before').backgroundImage)).toMatch(/^url\("blob:/);
  const safe = await page.evaluate(() => Number(document.documentElement.style.getPropertyValue('--backdrop-safe')));
  expect(safe).toBeGreaterThan(0.6);
  expect(safe).toBeLessThan(1);
  await expect.poll(() => page.evaluate(() => Number(getComputedStyle(document.getElementById('backdrop'), '::after').opacity))).toBe(safe);
  const worst = await worstContrast(page, { title: '.tile .title', address: '.tile .url', toggle: '.ctrl span', placeholder: '#search' });
  expect(Object.keys(worst)).toHaveLength(4);
  for (const [kind, ratio] of Object.entries(worst)) expect(ratio, kind).toBeGreaterThanOrEqual(4.5);
  await ext.pressToClose(page, 'Escape');

  // From a browser page, which is never pictured: the plain background.
  await ext.openTab(windowId, 'chrome://version/', { active: true });
  page = await openWith(ext, { backdrop: 'page', appearance: 'dark' });
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.backdrop)).toBeUndefined();
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('backdrop')).display)).toBe('none');
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('root')).backgroundColor)).toBe('rgb(22, 22, 24)');
});

test('backdrop: people who ask their system for more contrast keep the plain background', async ({ ext }) => {
  await ext.openWindow(VISITED);
  const page = await openWith(ext, { backdrop: 'wallpaper', spread: true });
  expect(await page.evaluate(() => document.documentElement.dataset.backdrop)).toBe('wallpaper');
  await page.emulateMedia({ contrast: 'more' });
  await page.reload();
  await page.locator('#grid .tile').first().waitFor();
  expect(await page.evaluate(() => document.documentElement.dataset.backdrop)).toBeUndefined();
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('backdrop')).display)).toBe('none');
  // The layout is not a matter of contrast: the cards stay spread out.
  await expect(page.locator('#grid')).toHaveClass(/\bspread\b/);
});

test('settings page: light or dark, the backdrop and the spread-out switch save at once and apply to the next window', async ({ ext, context }) => {
  await ext.openWindow(VISITED);
  const options = await context.newPage();
  await options.goto(`chrome-extension://${new URL(ext.sw.url()).host}/options.html`);
  await expect(options.locator('#appearance')).toHaveValue('system');
  await expect(options.locator('#backdrop')).toHaveValue('plain');
  await expect(options.locator('#spread')).not.toBeChecked();
  await options.locator('#appearance').selectOption('light');
  await options.locator('#backdrop').selectOption('wallpaper');
  await options.locator('label[for="spread"]').click();
  await expect(options.locator('#spread')).toBeChecked();
  await expect.poll(() => ext.sw.evaluate(() => chrome.storage.local.get(['appearance', 'backdrop', 'spread'])))
    .toEqual({ appearance: 'light', backdrop: 'wallpaper', spread: true });
  await options.close();

  const page = await openWith(ext, {});
  expect(await page.evaluate(() => ({ ...document.documentElement.dataset }))).toEqual({ appearance: 'light', backdrop: 'wallpaper', layout: 'spread' });
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('light');
});
