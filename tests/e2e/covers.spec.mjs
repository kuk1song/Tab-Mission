import { test, expect } from './fixtures.mjs';

// Covers (src/covers.js): a picture of a page, taken by the service worker
// while the page was in front, and shown on its card.
const coverOf = (ext, tabId) =>
  ext.sw.evaluate((key) => chrome.storage.session.get(key).then((r) => r[key] ?? null), `cover:${tabId}`);

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
  await expect(alpha).toHaveAttribute('src', /\/img\/alpha\.svg$/);
  await expect(alpha).not.toHaveClass(/\bcover\b/);
});

test('a tab that moves to another page gets a new picture, and an old one is never shown', async ({ ext }) => {
  const { tabIds } = await ext.openWindow(['beta', 'gamma']);
  await expect.poll(() => coverOf(ext, tabIds.gamma).then((c) => c?.url), { timeout: 10_000 }).toBe(ext.url('gamma'));
  const next = ext.url('gamma', '?v=2');
  await ext.sw.evaluate(({ id, url }) => chrome.tabs.update(id, { url }), { id: tabIds.gamma, url: next });
  await expect.poll(() => coverOf(ext, tabIds.gamma).then((c) => c?.url), { timeout: 10_000 }).toBe(next);

  // A picture kept for an earlier page of beta stays off its card.
  await ext.sw.evaluate((key) => chrome.storage.session.set({
    [key]: { url: 'http://localhost/earlier.html', img: 'data:image/webp;base64,UklGRg==' },
  }), `cover:${tabIds.beta}`);
  const page = await ext.open();
  await expect(page.locator(`.tile[data-tab-id="${tabIds.gamma}"] img.thumbnail.cover.loaded`)).toHaveCount(1);
  await expect(page.locator(`.tile[data-tab-id="${tabIds.beta}"] img.thumbnail.cover`)).toHaveCount(0);
});

test('the shortcut pictures the page you are leaving', async ({ ext, context }) => {
  const { tabIds } = await ext.openWindow(['beta', 'gamma']);
  const indexAt = () => ext.sw.evaluate((id) =>
    chrome.storage.session.get('coverIndex').then((r) => r.coverIndex?.[id]?.at ?? 0), String(tabIds.gamma));
  // Polled closely, so the press below comes well before that follow-up.
  await expect.poll(indexAt, { timeout: 10_000, intervals: [50] }).toBeGreaterThan(0);
  const before = await indexAt();
  // Past Chrome's capture limit, so the press can take its picture at once.
  await new Promise((r) => setTimeout(r, 700));
  const gamma = context.pages().find((p) => p.url() === ext.url('gamma'));
  const opened = context.waitForEvent('page', (p) => p.url().includes('/overview.html'));
  await ext.pressDefaultShortcut(gamma);
  await opened;
  // Within a second: the next follow-up picture is due 3 s after the first.
  await expect.poll(indexAt, { timeout: 1000 }).toBeGreaterThan(before);
});
