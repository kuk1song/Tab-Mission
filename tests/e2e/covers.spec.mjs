import { test, expect } from './fixtures.mjs';

// Covers (src/covers.js): a picture of a page, taken by the service worker
// while the page was in front, kept on disk and shown on its card.
const coverOf = (ext, tabId) =>
  ext.sw.evaluate((key) => chrome.storage.local.get(key).then((r) => r[key] ?? null), `cover:${tabId}`);

test('the card of a page you looked at shows a picture of it; others keep their own image', async ({ ext }) => {
  const { tabIds } = await ext.openWindow(['beta', 'alpha', 'gamma']);
  // gamma stayed in front; alpha was passed over within moments (beta, the
  // window's first tab, was in front while the pages loaded).
  await expect.poll(() => coverOf(ext, tabIds.gamma).then((c) => c?.url), { timeout: 10_000 }).toBe(ext.url('gamma'));
  expect(await coverOf(ext, tabIds.alpha)).toBe(null);

  const page = await ext.open();
  const gamma = page.locator(`.tile[data-tab-id="${tabIds.gamma}"] img.thumbnail`);
  await expect(gamma).toHaveClass(/\bcover\b/);
  await expect(gamma).toHaveClass(/\bloaded\b/);
  expect(await gamma.getAttribute('src')).toMatch(/^data:image\/webp;base64,/);
  // The picture is the top of the page in the card's shape, not stretched.
  const size = await gamma.evaluate((img) => [img.naturalWidth, img.naturalHeight]);
  expect(size[0]).toBeGreaterThan(0);
  expect(size[1] / size[0]).toBeLessThanOrEqual(10 / 16 + 0.01);
  const alpha = page.locator(`.tile[data-tab-id="${tabIds.alpha}"] img.thumbnail`);
  await expect(alpha).toHaveAttribute('data-from', /\/img\/alpha\.svg$/);
  await expect(alpha).toHaveClass(/\bloaded\b/);
  await expect(alpha).not.toHaveClass(/\bcover\b/);
});

test('a tab that moves to another page gets a new picture, and an old one is never shown', async ({ ext }) => {
  const { tabIds } = await ext.openWindow(['beta', 'gamma']);
  await expect.poll(() => coverOf(ext, tabIds.gamma).then((c) => c?.url), { timeout: 10_000 }).toBe(ext.url('gamma'));
  const next = ext.url('gamma', '?v=2');
  await ext.sw.evaluate(({ id, url }) => chrome.tabs.update(id, { url }), { id: tabIds.gamma, url: next });
  await expect.poll(() => coverOf(ext, tabIds.gamma).then((c) => c?.url), { timeout: 10_000 }).toBe(next);

  // A picture kept for an earlier page of beta stays off its card.
  await ext.sw.evaluate((key) => chrome.storage.local.set({
    [key]: { url: 'http://localhost/earlier.html', img: 'data:image/webp;base64,UklGRg==' },
  }), `cover:${tabIds.beta}`);
  const page = await ext.open();
  await expect(page.locator(`.tile[data-tab-id="${tabIds.gamma}"] img.thumbnail.cover.loaded`)).toHaveCount(1);
  await expect(page.locator(`.tile[data-tab-id="${tabIds.beta}"] img.thumbnail.cover`)).toHaveCount(0);
});

test('the shortcut pictures the page you are leaving', async ({ ext, context }) => {
  const { tabIds } = await ext.openWindow(['beta', 'gamma']);
  const indexAt = () => ext.sw.evaluate((id) =>
    chrome.storage.local.get('coverIndex').then((r) => r.coverIndex?.[id]?.at ?? 0), String(tabIds.gamma));
  // Polled closely, so the press below comes well before that follow-up.
  await expect.poll(indexAt, { timeout: 10_000, intervals: [50] }).toBeGreaterThan(0);
  const before = await indexAt();
  // Past Chrome's capture limit, so the press can take its picture at once.
  await new Promise((r) => setTimeout(r, 700));
  const gamma = context.pages().find((p) => p.url() === ext.url('gamma'));
  const opened = context.waitForEvent('page', (p) => p.url().includes('/overview.html'));
  await ext.pressDefaultShortcut(gamma);
  await opened;
  // Within a second: the next follow-up picture is due 2.5 s after the first.
  await expect.poll(indexAt, { timeout: 1000 }).toBeGreaterThan(before);
});

test('without a picture, a card shows the page\'s own image unless it is a square logo', async ({ ext }) => {
  // beta, the window's first tab, may be pictured while the others load.
  const { tabIds } = await ext.openWindow(['beta', 'alpha', 'photo', 'logo', 'icon', 'gamma']);
  const page = await ext.open();
  const img = (id) => page.locator(`.tile[data-tab-id="${tabIds[id]}"] img.thumbnail`);
  await expect(img('alpha')).toHaveClass(/\bloaded\b/); // 1200 × 630
  await expect(img('photo')).toHaveClass(/\bloaded\b/); // 600 × 800
  // A square logo, as og:image or as a touch icon, leaves the icon card.
  await expect(img('logo')).toHaveAttribute('data-from', /logo-square\.svg$/);
  await expect(img('logo')).toBeHidden();
  await expect(img('logo')).not.toHaveClass(/\bloaded\b/);
  await expect(page.locator(`.tile[data-tab-id="${tabIds.icon}"]`)).toHaveAttribute('data-thumb', 'done');
  expect(await img('icon').getAttribute('src')).toBe(null);
});

test('pictures last through a browser restart, and those of pages no longer open go', async ({ ext }) => {
  const { tabIds } = await ext.openWindow(['beta', 'gamma']);
  // A picture of beta, then back to gamma.
  await ext.sw.evaluate((id) => chrome.tabs.update(id, { active: true }), tabIds.beta);
  await expect.poll(() => coverOf(ext, tabIds.beta).then((c) => c?.url), { timeout: 10_000 }).toBe(ext.url('beta'));
  await ext.sw.evaluate((id) => chrome.tabs.update(id, { active: true }), tabIds.gamma);
  await expect.poll(() => coverOf(ext, tabIds.gamma).then((c) => c?.url), { timeout: 10_000 }).toBe(ext.url('gamma'));
  const picture = (await coverOf(ext, tabIds.beta)).img;
  // And one of a page that will not come back.
  await ext.sw.evaluate(() => chrome.storage.local.get('coverIndex').then(({ coverIndex }) => chrome.storage.local.set({
    'cover:999999': { url: 'http://localhost/gone.html', img: 'data:image/webp;base64,UklGRg==' },
    coverIndex: { ...coverIndex, 999999: { url: 'http://localhost/gone.html', bytes: 30, at: 1 } },
  })));

  const { context, sw } = await ext.restart();
  try {
    const restored = await sw.evaluate((url) => chrome.tabs.query({ url }).then((t) => t[0]?.id), ext.url('beta'));
    expect(restored).toBeDefined();
    expect(restored).not.toBe(tabIds.beta); // the same page in a new tab
    // Opened with the shortcut in the restored window, Tab Mission shows
    // beta's picture from before the restart.
    await expect.poll(() => context.pages().some((p) => p.url() === ext.url('gamma'))).toBe(true);
    const gamma = context.pages().find((p) => p.url() === ext.url('gamma'));
    const opened = context.waitForEvent('page', (p) => p.url().includes('/overview.html'));
    await ext.pressDefaultShortcut(gamma);
    const page = await opened;
    const beta = page.locator(`.tile[data-tab-id="${restored}"] img.thumbnail.cover`);
    await expect(beta).toHaveClass(/\bloaded\b/);
    expect(await beta.getAttribute('src')).toBe(picture);
    await expect.poll(() => sw.evaluate(() => chrome.storage.local.get('coverIndex').then(({ coverIndex }) =>
      Object.values(coverIndex).map((e) => e.url).sort()))).toEqual([ext.url('beta'), ext.url('gamma')]);
  } finally {
    await context.close();
  }
});

test('a page held up by a slow image is pictured while it still loads', async ({ ext }) => {
  await ext.openWindow(['beta']);
  // Opened and switched to here, so the wait for its load stays in the test.
  const slow = await ext.sw.evaluate(async (url) => {
    const [win] = await chrome.windows.getAll({ windowTypes: ['normal'] }).then((w) => w.filter((x) => x.focused));
    return (await chrome.tabs.create({ windowId: win.id, url, active: true })).id;
  }, ext.url('slow'));
  // Within 8 s: the image holding up its load arrives at 10 s.
  await expect.poll(() => coverOf(ext, slow).then((c) => c?.url), { timeout: 8000 }).toBe(ext.url('slow'));
  expect(await ext.sw.evaluate((id) => chrome.tabs.get(id).then((t) => t.status), slow)).toBe('loading');
});
