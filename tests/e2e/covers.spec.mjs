import { test, expect } from './fixtures.mjs';

// Covers (src/covers.js): a picture of a page, taken by the service worker
// while the page was in front, kept on disk and shown on its card.
const coverOf = (ext, tabId) =>
  ext.sw.evaluate((key) => chrome.storage.local.get(key).then((r) => r[key] ?? null), `cover:${tabId}`);
// Until a card's own image has been looked for, one may still come: the
// window writes what it found (or null) to the preview cache (thumbnail.js).
const lookedUp = (ext, tabId) => expect.poll(() => ext.sw.evaluate((id) =>
  chrome.storage.session.get('previewCache').then((r) => id in (r.previewCache ?? {})), String(tabId))).toBe(true);

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
  await lookedUp(ext, tabIds.beta); // so its cover is no longer pending
  await expect(page.locator(`.tile[data-tab-id="${tabIds.beta}"] img.thumbnail.cover`)).toHaveCount(0);
});

test('the shortcut pictures the page you are leaving', async ({ ext, context }) => {
  const { tabIds } = await ext.openWindow(['beta', 'gamma']);
  const indexAt = () => ext.sw.evaluate((id) =>
    chrome.storage.local.get('coverIndex').then((r) => r.coverIndex?.[id]?.at ?? 0), String(tabIds.gamma));
  // Polled closely, so the press below comes well before that follow-up.
  await expect.poll(indexAt, { timeout: 10_000, intervals: [50] }).toBeGreaterThan(0);
  const before = await indexAt();
  const gamma = context.pages().find((p) => p.url() === ext.url('gamma'));
  const opened = context.waitForEvent('page', (p) => p.url().includes('/overview.html'));
  await ext.pressDefaultShortcut(gamma);
  await opened;
  // A new picture, before the follow-up could take it: that one comes 2.5 s
  // after the first picture at the soonest (it is set once that picture is
  // stored). The press's capture may first wait its turn (Chrome allows two
  // a second).
  let after;
  await expect.poll(async () => (after = await indexAt()), { intervals: [50] }).toBeGreaterThan(before);
  expect(after - before).toBeLessThan(2500);
});

test('without a picture, a card shows the page\'s own image unless it is a square logo', async ({ ext }) => {
  // beta, the window's first tab, may be pictured while the others load.
  const { tabIds } = await ext.openWindow(['beta', 'alpha', 'photo', 'logo', 'icon', 'gamma']);
  const page = await ext.open();
  const img = (id) => page.locator(`.tile[data-tab-id="${tabIds[id]}"] img.thumbnail`);
  await expect(img('alpha')).toHaveClass(/\bloaded\b/); // 1200 × 630
  await expect(img('photo')).toHaveClass(/\bloaded\b/); // 600 × 800
  // A square logo named as og:image leaves the icon card; a touch icon is
  // never looked for.
  await expect(img('logo')).toHaveAttribute('data-from', /logo-square\.svg$/);
  await expect(img('logo')).toBeHidden();
  await expect(img('logo')).not.toHaveClass(/\bloaded\b/);
  await lookedUp(ext, tabIds.icon);
  expect(await img('icon').getAttribute('src')).toBe(null);
});

// A tab whose site has not answered yet has only the address it is going to
// (cards.spec); its card looks for the page's own image there, which comes
// once the site answers.
test('a card opened before its site answers shows the page\'s own image once it does', async ({ ext }) => {
  const { windowId } = await ext.openWindow(['beta']);
  const url = ext.url('alpha').replace('/alpha.html', '/held/alpha.html');
  const id = await ext.sw.evaluate(({ windowId, url }) => chrome.tabs.create({ windowId, url, active: false }).then((t) => t.id), { windowId, url });
  await expect.poll(() => ext.sw.evaluate((id) => chrome.tabs.get(id).then((t) => [t.url, t.pendingUrl]), id)).toEqual(['', url]);
  const page = await ext.open();
  const img = page.locator(`.tile[data-tab-id="${id}"] img.thumbnail`);
  await expect(img).toHaveCount(1);
  await page.evaluate((release) => fetch(release), url.replace('/held/alpha.html', '/release'));
  await expect(img).toHaveAttribute('data-from', /\/img\/alpha\.svg$/);
  await expect(img).toHaveClass(/\bloaded\b/);
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
    // The restored tabs, once their pages are back (a tab has no address
    // before its page commits).
    const tabOf = (url) => sw.evaluate((url) => chrome.tabs.query({ url }).then((t) => t[0]?.id ?? null), url);
    await expect.poll(() => tabOf(ext.url('beta'))).not.toBeNull();
    await expect.poll(() => tabOf(ext.url('gamma'))).not.toBeNull();
    const restored = { beta: await tabOf(ext.url('beta')), gamma: await tabOf(ext.url('gamma')) };
    expect(restored.beta).not.toBe(tabIds.beta); // the same page in a new tab
    // As when the browser was quit: gamma in front, in the focused window.
    // (Loaded with --load-extension, the extension is installed anew at each
    // start and its welcome page opens in front; a real restart does not.)
    await sw.evaluate(async (id) => {
      const tab = await chrome.tabs.update(id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    }, restored.gamma);
    // gamma gets its own picture in the restored window; beta has none yet.
    await expect.poll(() => coverOf({ sw }, restored.gamma).then((c) => c?.url), { timeout: 10_000 }).toBe(ext.url('gamma'));
    // Opened with the shortcut there, Tab Mission shows beta's picture from
    // before the restart, and keeps only the pictures of open pages: beta's
    // old one (its tab has none of its own) and gamma's new one.
    await expect.poll(() => context.pages().some((p) => p.url() === ext.url('gamma'))).toBe(true);
    const gamma = context.pages().find((p) => p.url() === ext.url('gamma'));
    const opened = context.waitForEvent('page', (p) => p.url().includes('/overview.html'));
    await ext.pressDefaultShortcut(gamma);
    const page = await opened;
    const beta = page.locator(`.tile[data-tab-id="${restored.beta}"] img.thumbnail.cover`);
    await expect(beta).toHaveClass(/\bloaded\b/);
    expect(await beta.getAttribute('src')).toBe(picture);
    await expect.poll(() => sw.evaluate(() => chrome.storage.local.get('coverIndex').then(({ coverIndex }) =>
      Object.entries(coverIndex).map(([id, e]) => [id, e.url]).sort()))).toEqual([
      [String(tabIds.beta), ext.url('beta')], [String(restored.gamma), ext.url('gamma')],
    ].sort());
  } finally {
    await context.close();
  }
});

test('a page held up by a slow image is pictured while it still loads', async ({ ext }) => {
  const { windowId } = await ext.openWindow(['beta']);
  // Opened and switched to here, so the wait for its load stays in the test.
  const slow = await ext.sw.evaluate(({ windowId, url }) =>
    chrome.tabs.create({ windowId, url, active: true }).then((t) => t.id), { windowId, url: ext.url('slow') });
  // The image holding up its load never comes (the site holds it until
  // GET /release), so the page is still loading when its picture is taken:
  // at the follow-up about 3 s after the switch or, should Chrome refuse
  // that one, not answer within 5 s or return a blank picture, at the next
  // one about 12 s later. On a slow Windows runner (2026-10-27) the first
  // was asked for 5.4 s after the switch and came back 2.2 s later.
  await expect.poll(() => coverOf(ext, slow).then((c) => c?.url), { timeout: 20_000 }).toBe(ext.url('slow'));
  expect(await ext.sw.evaluate((id) => chrome.tabs.get(id).then((t) => t.status), slow)).toBe('loading');
});
