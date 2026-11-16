import { test, expect, PAGES, selectedTitle, pointAt } from './fixtures.mjs';

// "Spread the cards out" and "Backdrop" (settings page, both off by
// default; src/spread.js, src/backdrop.js): the tabs used more recently
// larger, a label under each picture, every card in view while they fit;
// behind them a wallpaper or a blurred picture of the page you were on.
const VISITED = ['alpha', 'doc1', 'tube1', 'beta', 'tube2', 'gamma'];
// By last use: the previous tab first, the current one beside it.
const ORDER = ['tube2', 'gamma', 'beta', 'tube1', 'doc1', 'alpha'];
const EIGHT = [...VISITED, 'code1', 'notes1'];
// Sixteen cards: more than that window holds in view.
const SIXTEEN = [...EIGHT, ...EIGHT.map((id) => `${id}?again`)];

// A window that fits the Windows runner's 1024 px screen. Six cards spread
// out are all in view in it; sixteen are not (spread.test covers the sizes).
// Spread out, the overview takes the place of the browser window, so that
// window gets the size too.
const SIZE = { width: 800, height: 600 };
async function openWith(ext, settings) {
  await ext.sw.evaluate(async ({ settings, size }) => {
    await chrome.storage.local.set({ overviewBounds: size, ...settings });
    const browser = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    await chrome.windows.update(browser.id, { left: 0, top: 0, ...size });
  }, { settings, size: SIZE });
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
  await expect(page.locator('#grid')).not.toHaveClass(/\bscrolls\b/);
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

test('spread out: the window takes the place of the browser window, its size is not remembered, and the toolbar is a search box in the middle', async ({ ext }) => {
  await ext.openWindow(VISITED);
  const page = await openWith(ext, { spread: true });
  const bounds = ({ left, top, width, height }) => ({ left, top, width, height });
  const browser = bounds(await ext.sw.evaluate(() => chrome.windows.getLastFocused({ windowTypes: ['normal'] })));
  expect(bounds(await page.evaluate(() => chrome.windows.getCurrent()))).toEqual(browser);
  expect(new URL(page.url()).searchParams.get('layout')).toBe('spread');

  // The search box in the middle, the shortcut's badge inside it, no reset button.
  const box = (selector) => page.locator(selector).evaluate((el) => el.getBoundingClientRect().toJSON());
  const [field, root] = [await box('.search-field'), await box('#root')];
  expect(Math.abs((field.left + field.right) / 2 - (root.left + root.right) / 2)).toBeLessThanOrEqual(1);
  expect(field.width).toBeLessThanOrEqual(root.width - 40);
  await expect(page.locator('.search-field #shortcut-hint kbd')).toBeVisible();
  await expect(page.locator('#reset-window')).toBeHidden();
  await expect(page.locator('#open-settings')).toBeVisible();
  await expect(page.locator('#toggle-all-windows')).toBeVisible();
  await expect(page.locator('#search')).toBeFocused();

  // The entrance: the page you were on shrinks into its card from the whole
  // area, the others come out of the middle; when it is over, every card is
  // in its place, untransformed.
  const current = page.locator('#grid .tile.from-page');
  await expect(current).toHaveCount(1);
  await expect(current.locator('.title')).toHaveText(await page.locator('#grid .tile .title').nth(1).textContent());
  expect(Number(await current.evaluate((el) => el.style.getPropertyValue('--zoom')))).toBeGreaterThan(1.5);
  expect(await page.locator('#grid .tile').evaluateAll((tiles) => tiles.map((tile) => getComputedStyle(tile).transform))).toEqual(VISITED.map(() => 'none'));

  // A size given to it is not the one to come back to: the saved one stays.
  await page.evaluate(() => chrome.windows.getCurrent().then((w) => chrome.windows.update(w.id, { width: 640, height: 480 })));
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(640);
  await ext.pressToClose(page, 'Escape');
  expect((await ext.sw.evaluate(() => chrome.storage.local.get('overviewBounds'))).overviewBounds).toEqual(SIZE);
});

test('spread out, cards all the same size (the setting): one size for every card, in straight rows in the middle', async ({ ext }) => {
  await ext.openWindow(EIGHT);
  const page = await openWith(ext, { spread: true, cardSizes: 'equal' });
  const shown = await cards(page);
  expect(shown).toHaveLength(EIGHT.length);
  for (const card of shown) expect(card.picture.width).toBeCloseTo(shown[0].picture.width, 1);
  // Rows: cards at one height, as much room left of each row as right of it.
  const grid = await page.locator('#grid').evaluate((el) => el.getBoundingClientRect().toJSON());
  const rows = new Map();
  for (const card of shown) rows.set(Math.round(card.picture.top), [...(rows.get(Math.round(card.picture.top)) ?? []), card]);
  expect(rows.size).toBeGreaterThan(1);
  for (const row of rows.values()) {
    expect(Math.abs((row[0].picture.left - grid.left) - (grid.right - row.at(-1).picture.right))).toBeLessThanOrEqual(1);
  }
  // In view with their labels, none on another.
  for (const [i, card] of shown.entries()) {
    expect(card.label.bottom).toBeLessThanOrEqual(grid.bottom + 0.5);
    for (const other of shown.slice(i + 1)) {
      expect(overlap(card.picture, other.picture) || overlap(card.label, other.picture) || overlap(card.picture, other.label)).toBe(false);
    }
  }
  // The entrance still ends with every card in its place.
  expect(await page.locator('#grid .tile').evaluateAll((tiles) => tiles.map((tile) => getComputedStyle(tile).transform))).toEqual(EIGHT.map(() => 'none'));
});

test('spread out, the two switches are icons: round buttons with their words for screen readers and as tooltips, a ring when on', async ({ ext }) => {
  await ext.openWindow(VISITED);
  const page = await openWith(ext, { spread: true });
  const words = await page.evaluate(() => ['showAllWindowsLabel', 'showSleepingLabel'].map((key) => chrome.i18n.getMessage(key)));
  expect(await page.locator('.ctrl').evaluateAll((labels) => labels.map((label) => label.title))).toEqual(words);
  const look = () => page.locator('.ctrl').evaluateAll((labels) => labels.map((label) => {
    const r = label.getBoundingClientRect();
    const text = label.querySelector('span').getBoundingClientRect();
    const icon = label.querySelector('.ctrl-icon').getBoundingClientRect();
    return { width: r.width, height: r.height, text: Math.max(text.width, text.height), icon: icon.width, ring: getComputedStyle(label).borderTopColor };
  }));
  const before = await look();
  for (const button of before) expect(button).toMatchObject({ width: 30, height: 30, text: 1, icon: 16 });
  // The settings button is the same size, in the same row.
  const boxes = await page.locator('.ctrl, #open-settings').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
  expect(boxes.map((box) => [box.width, box.height])).toEqual([[30, 30], [30, 30], [30, 30]]);
  expect(new Set(boxes.map((box) => Math.round(box.top))).size).toBe(1);
  // Named by their words, they work with a click and with the keyboard.
  const allWindows = page.getByRole('checkbox', { name: words[0] });
  const sleeping = page.getByRole('checkbox', { name: words[1] });
  await expect(allWindows).not.toBeChecked();
  await page.locator('.ctrl:has(#toggle-all-windows)').click();
  await expect(allWindows).toBeChecked();
  await expect.poll(() => ext.sw.evaluate(() => chrome.storage.local.get('showAllWindows'))).toEqual({ showAllWindows: true });
  await sleeping.focus();
  await page.keyboard.press('Space');
  await expect(sleeping).toBeChecked();
  // On, each has a ring it did not have.
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('.ctrl')].some((el) => el.getAnimations().length))).toBe(false);
  const after = await look();
  for (const [i, button] of after.entries()) {
    expect(before[i].ring).toBe('rgba(0, 0, 0, 0)');
    expect(button.ring).not.toBe(before[i].ring);
  }
});

test('the grid keeps its toolbar and its window whatever the spread-out settings say', async ({ ext }) => {
  await ext.openWindow(VISITED);
  const page = await openWith(ext, { spread: false, cardSizes: 'equal', openAs: 'page' });
  expect(new URL(page.url()).searchParams.get('layout')).toBeNull();
  expect(new URL(page.url()).searchParams.get('host')).toBeNull();
  expect(await page.evaluate(() => chrome.windows.getCurrent().then((win) => win.type))).toBe('popup');
  expect(await page.evaluate(() => ({ ...document.documentElement.dataset }))).toEqual({});
  for (const shown of ['#toggle-all-windows', '#toggle-sleeping', '#open-settings', '#reset-window']) await expect(page.locator(shown)).toBeVisible();
  // Its switches show their words, and no icon or tooltip.
  await expect(page.locator('.ctrl span')).toHaveText(await page.evaluate(() => ['showAllWindowsLabel', 'showSleepingLabel'].map((key) => chrome.i18n.getMessage(key))));
  expect(await page.locator('.ctrl span').evaluateAll((texts) => texts.every((text) => text.getBoundingClientRect().width > 20))).toBe(true);
  await expect(page.locator('.ctrl-icon').first()).toBeHidden();
  expect(await page.locator('.ctrl').evaluateAll((labels) => labels.map((label) => label.title))).toEqual(['', '']);
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

test('spread out: more tabs than fit in view stay spread out and scroll; the arrows bring a card and its label into view', async ({ ext }) => {
  await ext.openWindow(SIXTEEN);
  const page = await openWith(ext, { spread: true });
  await expect(page.locator('#grid .tile')).toHaveCount(16);
  await expect(page.locator('#grid')).toHaveClass(/\bspread\b/);
  await expect(page.locator('#grid')).toHaveClass(/\bscrolls\b/);
  expect(await page.evaluate(() => document.documentElement.dataset.layout)).toBe('spread');
  // Every card has its picture and its label, none on another; they only reach further down than the grid.
  const shown = await cards(page);
  const all = shown.flatMap((card) => [card.picture, card.label]);
  expect(all.every(Boolean)).toBe(true);
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) expect(overlap(all[i], all[j]), `boxes ${i} and ${j}`).toBe(false);
  }
  const grid = () => page.locator('#grid').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, sideways: el.scrollWidth > el.clientWidth };
  });
  const before = await grid();
  expect(before.sideways).toBe(false);
  expect(before.scrollHeight).toBeGreaterThan(before.clientHeight);
  for (const box of all) {
    expect(box.left).toBeGreaterThanOrEqual(before.left);
    expect(box.right).toBeLessThanOrEqual(before.right);
  }
  const lowest = Math.max(...all.map((box) => box.bottom));
  expect(lowest).toBeGreaterThan(before.bottom);
  // The grid is as long as the cards reach, and no longer than a small margin more.
  expect(before.scrollHeight - (lowest - before.top)).toBeGreaterThanOrEqual(0);
  expect(before.scrollHeight - (lowest - before.top)).toBeLessThan(40);

  // The last card, by the arrows: scrolled into view with its label.
  for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowRight');
  await expect(page.locator('#grid .tile.selected')).toHaveAttribute('data-index', '15');
  await expect.poll(async () => (await grid()).scrollTop).toBeGreaterThan(0);
  await expect.poll(async () => {
    const view = await grid();
    const label = await page.locator('#grid .tile.selected .meta').evaluate((el) => el.getBoundingClientRect().bottom);
    return label <= view.bottom;
  }).toBe(true);

  // A search that leaves a few: all in view again, nothing to scroll.
  await page.keyboard.type('Tube');
  await expect(page.locator('#grid .tile')).toHaveCount(4);
  await expect(page.locator('#grid')).not.toHaveClass(/\bscrolls\b/);
  expect((await grid()).scrollHeight).toBe((await grid()).clientHeight);
  await page.keyboard.press('Escape');
  await expect(page.locator('#grid .tile')).toHaveCount(16);
  await expect(page.locator('#grid')).toHaveClass(/\bscrolls\b/);
});

test('spread out, then turned off: the same window shows the grid as before', async ({ ext }) => {
  await ext.openWindow(EIGHT);
  let page = await openWith(ext, { spread: true });
  await expect(page.locator('#grid')).toHaveClass(/\bspread\b/);
  await ext.pressToClose(page, 'Escape');
  page = await openWith(ext, { spread: false });
  await expect(page.locator('#grid')).not.toHaveClass(/spread/);
  expect(await page.evaluate(() => document.documentElement.dataset.layout)).toBeUndefined();
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('grid')).display)).toBe('grid');
  await expect(page.locator('#grid .tile .url').first()).toBeVisible();
  expect(await page.locator('#grid .tile').first().evaluate((tile) => getComputedStyle(tile).position)).toBe('relative');
});

test('spread out: resizing the window places the cards for its new size', async ({ ext }) => {
  await ext.openWindow(VISITED);
  const page = await openWith(ext, { spread: true });
  const before = await cards(page);
  const resize = (width, height) => page.evaluate(({ width, height }) => chrome.windows.getCurrent().then((w) => chrome.windows.update(w.id, { width, height })), { width, height });
  // Larger: larger cards, still all in view.
  await resize(900, 660);
  await expect.poll(async () => (await cards(page))[0].picture.width).toBeGreaterThan(before[0].picture.width + 1);
  await expect(page.locator('#grid')).not.toHaveClass(/\bscrolls\b/);
  const grid = await page.locator('#grid').evaluate((el) => el.getBoundingClientRect().toJSON());
  for (const card of await cards(page)) {
    expect(card.picture.right).toBeLessThanOrEqual(grid.right);
    expect(card.label.bottom).toBeLessThanOrEqual(grid.bottom);
  }
  // Too low for six cards: they keep their smallest size, and the grid scrolls.
  await resize(700, 420);
  await expect(page.locator('#grid')).toHaveClass(/\bscrolls\b/);
  await expect.poll(() => page.locator('#grid').evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  const narrow = await page.locator('#grid').evaluate((el) => el.getBoundingClientRect().toJSON());
  for (const card of await cards(page)) expect(card.picture.right).toBeLessThanOrEqual(narrow.right);
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
    const spread = await worstContrast(page, { title: '.tile:not(.selected) .title', selected: '.tile.selected .title', toggle: '.ctrl-icon', hint: '#shortcut-hint kbd', placeholder: '#search' });
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

  // From a browser page, which is never pictured: the page you were on before it.
  await ext.openTab(windowId, 'chrome://version/', { active: true });
  page = await openWith(ext, { backdrop: 'page', appearance: 'dark' });
  await expect(page.locator('#backdrop')).toHaveAttribute('data-picture', '');
  expect(await page.evaluate(() => document.documentElement.dataset.backdrop)).toBe('page');
  await ext.pressToClose(page, 'Escape');

  // In a window with no pictured page at all: the plain background.
  await ext.sw.evaluate(async () => {
    const win = await chrome.windows.create({ url: 'chrome://version/', width: 900, height: 700 });
    for (;;) {
      const last = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
      const [tab] = await chrome.tabs.query({ windowId: win.id });
      if (last.id === win.id && tab.url === 'chrome://version/') break;
      await new Promise((r) => setTimeout(r, 50));
    }
  });
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
  expect(await page.evaluate(() => ({ ...document.documentElement.dataset }))).toEqual({ appearance: 'light', backdrop: 'wallpaper', layout: 'spread', spread: '' });
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('light');
});
