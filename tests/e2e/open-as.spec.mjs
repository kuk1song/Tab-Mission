import { test, expect, PAGES } from './fixtures.mjs';

// "Open as" (settings page, a trial, with the cards spread out;
// src/host.js): the overview as a layer over the page in front, the tab
// strip in view, instead of a window of its own over the whole browser.
const VISITED = ['alpha', 'doc1', 'tube1', 'beta', 'tube2', 'gamma'];
const PREVIOUS = PAGES.tube2.title;
const CURRENT = PAGES.gamma.title;

const SIZE = { width: 800, height: 600 };
async function choose(ext, settings) {
  await ext.sw.evaluate(async ({ settings, size }) => {
    await chrome.storage.local.set({ overviewBounds: size, spread: true, ...settings });
    const browser = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    await chrome.windows.update(browser.id, { left: 0, top: 0, ...size });
  }, { settings, size: SIZE });
}
const host = (ext) => ext.sw.evaluate(() => chrome.storage.session.get({ overviewHost: null }).then((stored) => stored.overviewHost));
const tabsOf = (ext, windowId) => ext.sw.evaluate((windowId) => chrome.tabs.query({ windowId }).then((tabs) => tabs.map((tab) => ({ id: tab.id, index: tab.index, active: tab.active, title: tab.title, url: tab.url }))), windowId);

test.describe('on the page in front', () => {
  const pageOf = (context, id) => context.pages().find((page) => new URL(page.url()).pathname === `/${id}.html`);
  const frameOn = (page) => page.frames().find((frame) => frame.url().includes('/overlay.html'));
  // Press the shortcut and return the overview's frame once it has rendered.
  async function openOn(ext, page) {
    await ext.press();
    await expect.poll(() => Boolean(frameOn(page))).toBe(true);
    const frame = frameOn(page);
    await frame.locator('#grid .tile, #grid .empty').first().waitFor();
    await frame.locator('#grid:not(.entering)').waitFor();
    return frame;
  }
  // The layer is off the page (it is the page's last element while on), and its frame gone.
  const gone = (page) => expect.poll(async () => !frameOn(page) && await page.evaluate(() => document.documentElement.lastElementChild === document.body)).toBe(true);

  test('covers the page, in no window or tab of its own, with every tab as a card and the keyboard in its search box; Esc takes it off and gives the keyboard back', async ({ ext, context }) => {
    const { windowId, tabIds } = await ext.openWindow(VISITED);
    await choose(ext, { openAs: 'page' });
    const page = pageOf(context, 'gamma');
    // The page has the keyboard in a field of its own, and listens for keys.
    await page.evaluate(() => {
      const field = Object.assign(document.createElement('input'), { id: 'own-field' });
      document.body.append(field);
      field.focus();
      window.keysSeen = [];
      window.addEventListener('keydown', (e) => window.keysSeen.push(e.key), true);
    });
    const windows = await ext.sw.evaluate(() => chrome.windows.getAll().then((all) => all.length));
    const frame = await openOn(ext, page);
    expect(ext.overviewPages()).toEqual([]);
    expect(await ext.sw.evaluate(() => chrome.windows.getAll().then((all) => all.length))).toBe(windows);
    expect((await tabsOf(ext, windowId)).length).toBe(VISITED.length);
    expect(await host(ext)).toMatchObject({ kind: 'page', tabId: tabIds.gamma, claimed: true });

    // One layer over the whole view, on top; the page reads nothing of it.
    const layer = await page.evaluate(() => {
      const top = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      const r = top.getBoundingClientRect();
      return { last: top === document.documentElement.lastElementChild, root: top.shadowRoot, box: [r.left, r.top, r.width, r.height], view: [0, 0, innerWidth, innerHeight], frames: document.querySelectorAll('iframe').length };
    });
    expect(layer).toMatchObject({ last: true, root: null, frames: 0 });
    expect(layer.box).toEqual(layer.view);

    await expect(frame.locator('#grid .tile')).toHaveCount(VISITED.length);
    await expect(frame.locator(`#tile-${tabIds.gamma}`)).toBeVisible();
    expect(await frame.locator('#grid .tile.selected .title').textContent()).toBe(PREVIOUS);
    await expect(frame.locator('#search')).toBeFocused();
    await page.keyboard.type('docs');
    await expect(frame.locator('#search')).toHaveValue('docs');
    expect(await page.evaluate(() => window.keysSeen)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(frame.locator('#search')).toHaveValue('');

    await page.keyboard.press('Escape');
    await gone(page);
    await expect.poll(() => host(ext)).toBeNull();
    expect(await ext.activeTitle(windowId)).toBe(CURRENT);
    expect(await page.evaluate(() => document.activeElement.id)).toBe('own-field');
    expect(await page.evaluate(() => window.keysSeen)).toEqual([]);
  });

  test('Enter switches to the selected tab, the shortcut pressed again too, and the toolbar button takes it off', async ({ ext, context }) => {
    const { windowId } = await ext.openWindow(VISITED);
    await choose(ext, { openAs: 'page' });
    const gamma = pageOf(context, 'gamma');
    await openOn(ext, gamma);
    await gamma.keyboard.press('Enter');
    await expect.poll(() => ext.activeTitle(windowId)).toBe(PREVIOUS);
    await gone(gamma);

    // Now on tube2, with gamma the previous tab.
    const tube = pageOf(context, 'tube2');
    const frame = await openOn(ext, tube);
    expect(await frame.locator('#grid .tile.selected .title').textContent()).toBe(CURRENT);
    await ext.press();
    await expect.poll(() => ext.activeTitle(windowId)).toBe(CURRENT);
    await gone(tube);

    await openOn(ext, gamma);
    await ext.clickToolbarButton();
    await gone(gamma);
    await expect.poll(() => host(ext)).toBeNull();
    expect(await ext.activeTitle(windowId)).toBe(CURRENT);
  });

  test('another tab chosen in the tab strip takes it off; a page that went elsewhere gets a new one on the next press', async ({ ext, context }) => {
    const { windowId, tabIds } = await ext.openWindow(VISITED);
    await choose(ext, { openAs: 'page' });
    const gamma = pageOf(context, 'gamma');
    await openOn(ext, gamma);
    await ext.sw.evaluate((id) => chrome.tabs.update(id, { active: true }), tabIds.beta);
    await gone(gamma);
    await expect.poll(() => host(ext)).toBeNull();
    expect(await ext.activeTitle(windowId)).toBe(PAGES.beta.title);

    const beta = pageOf(context, 'beta');
    await openOn(ext, beta);
    await beta.reload();
    expect(frameOn(beta)).toBeUndefined();
    // Not asked again for long: it would listen by now.
    await ext.sw.evaluate(async () => {
      const { overviewHost } = await chrome.storage.session.get('overviewHost');
      await chrome.storage.session.set({ overviewHost: { ...overviewHost, at: 0 } });
    });
    const frame = await openOn(ext, beta);
    await expect(frame.locator('#grid .tile')).toHaveCount(VISITED.length);
  });

  test('on a browser page, which takes no layer, a window opens over the page only: the tab strip stays in view', async ({ ext }) => {
    const { windowId } = await ext.openWindow(VISITED);
    await ext.openTab(windowId, 'chrome://version/', { active: true });
    await choose(ext, { openAs: 'page' });
    const page = await ext.open();
    expect(new URL(page.url()).search).not.toContain('host');
    expect(await host(ext)).toBeNull();
    const { self, browser, tab } = await page.evaluate(async (windowId) => ({
      self: await chrome.windows.getCurrent(),
      browser: await chrome.windows.get(windowId),
      tab: (await chrome.tabs.query({ windowId, active: true }))[0],
    }), windowId);
    expect(self.type).toBe('popup');
    // The page begins below the browser's tab strip and toolbar, and so does the window.
    const pageTop = browser.top + browser.height - tab.height - (browser.width - tab.width) / 2;
    expect(pageTop).toBeGreaterThan(browser.top + 20);
    expect({ left: self.left, top: self.top, width: self.width, bottom: self.top + self.height })
      .toEqual({ left: browser.left, top: pageTop, width: browser.width, bottom: browser.top + browser.height });
    await expect(page.locator('#grid .tile')).toHaveCount(VISITED.length + 1);
    await ext.pressToClose(page, 'Escape');
  });

  test('a page that frames the overview on its own gets an error page for the address that never changes, an empty frame for the address of one that is open, and cannot take the open one off', async ({ ext, context }) => {
    await ext.openWindow(VISITED);
    await choose(ext, { openAs: 'page' });
    const page = pageOf(context, 'gamma');
    const frame = await openOn(ext, page);
    const used = frame.url();
    const id = new URL(ext.sw.url()).host;
    // The address the frame was given changes with every browser session; the page never sees it.
    const given = await ext.sw.evaluate(() => chrome.runtime.getURL('overlay.html'));
    expect(new URL(given).host).not.toBe(id);
    expect(await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => name.includes('-extension:')))).toEqual([]);
    const addresses = {
      fixed: `chrome-extension://${id}/overlay.html?host=page&layout=spread`,
      overview: `chrome-extension://${id}/overview.html?layout=spread`,
      learned: `${given}?${new URL(used).searchParams}`,
      bare: given,
    };
    await page.evaluate((addresses) => {
      for (const [name, src] of Object.entries(addresses)) document.body.append(Object.assign(document.createElement('iframe'), { src, name }));
    }, addresses);
    const theirs = (name) => page.frames().find((f) => f.name() === name);
    for (const name of Object.keys(addresses)) await expect.poll(() => theirs(name)?.url() ?? 'about:blank').not.toBe('about:blank');
    // Under the addresses that never change, the page gets Chrome's error page, as for any page of an extension it may not frame.
    expect(theirs('fixed').url()).toBe('chrome-error://chromewebdata/');
    expect(theirs('overview').url()).toBe('chrome-error://chromewebdata/');
    // Under the changing address, had it learned it: the page loads and shows nothing, with the token of the open one (used) or without one.
    for (const name of ['learned', 'bare']) {
      await theirs(name).waitForLoadState();
      await expect.poll(() => theirs(name).evaluate(() => ({ path: location.pathname, hidden: document.documentElement.hidden, tiles: document.querySelectorAll('.tile').length })))
        .toEqual({ path: '/overlay.html', hidden: true, tiles: 0 });
    }
    // The open one is still there and works.
    expect(await host(ext)).toMatchObject({ kind: 'page', claimed: true });
    await expect(frame.locator('#grid .tile')).toHaveCount(VISITED.length);
    await frame.locator('#search').focus();
    await page.keyboard.press('Escape');
    await expect.poll(() => frame.isDetached()).toBe(true);
    await expect.poll(() => host(ext)).toBeNull();
  });

  test('the overview\'s frame loaded again (Chrome\'s "Reload frame") is not let in twice: the empty layer is taken off, and the next press puts a new one on', async ({ ext, context }) => {
    await ext.openWindow(VISITED);
    await choose(ext, { openAs: 'page' });
    const page = pageOf(context, 'gamma');
    const frame = await openOn(ext, page);
    await frame.evaluate(() => location.reload()).catch(() => {});
    await gone(page);
    await expect.poll(() => host(ext)).toBeNull();
    const again = await openOn(ext, page);
    await expect(again.locator('#grid .tile')).toHaveCount(VISITED.length);
  });

  // The command itself (the tests above press as the welcome page's button
  // does, fixtures.mjs): it takes a picture of the page first, and the
  // overview is never in a picture.
  test('opened with the real shortcut: the press asks for a picture of the page; none is asked for while the overview is on it, and the one due is taken once it is off', async ({ ext, context, swConsole }) => {
    const { windowId, tabIds } = await ext.openWindow(VISITED);
    await choose(ext, { openAs: 'page' });
    const page = pageOf(context, 'gamma');
    const pictured = () => ext.sw.evaluate((id) => chrome.storage.local.get('coverIndex').then((stored) => stored.coverIndex?.[id]?.at ?? 0), tabIds.gamma);
    // What the worker asked Chrome for, and what came of it (fixtures.mjs, recordCaptures).
    const asked = () => swConsole.filter((line) => line.includes(' asked')).length;
    const answered = () => swConsole.filter((line) => / came back| failed/.test(line)).length;
    const askedBefore = asked();

    await ext.pressDefaultShortcut(page);
    await expect.poll(() => Boolean(frameOn(page))).toBe(true);
    const frame = frameOn(page);
    await frame.locator('#grid:not(.entering)').waitFor();
    expect(await host(ext)).toMatchObject({ kind: 'page', tabId: tabIds.gamma, claimed: true });
    // The press asked for a picture, before the layer was put on.
    await expect.poll(asked).toBeGreaterThan(askedBefore);
    await expect.poll(answered).toBe(asked());
    const [askedOn, kept] = [asked(), await pictured()];

    // The page changes its address under the overview: a picture would be due
    // half a second later (covers.js SETTLE_MS). Chrome is not even asked.
    await page.evaluate(() => history.pushState(null, '', '?moved'));
    await expect.poll(() => ext.sw.evaluate((id) => chrome.tabs.get(id).then((tab) => tab.url), tabIds.gamma)).toContain('?moved');
    await page.waitForTimeout(1200);
    expect(asked()).toBe(askedOn);
    expect(await pictured()).toBe(kept);
    // The card of this page shows the picture stored, if there is one, not the overview.
    const stored = await ext.sw.evaluate((id) => chrome.storage.local.get(`cover:${id}`).then((items) => items[`cover:${id}`]?.img ?? null), tabIds.gamma);
    const shown = frame.locator(`.tile[data-tab-id="${tabIds.gamma}"] img.thumbnail.cover`);
    if (stored) expect(await shown.getAttribute('src')).toBe(stored);
    else await expect(shown).toHaveCount(0);

    // Off again, the picture that was due is taken by the follow-up.
    await page.keyboard.press('Escape');
    await gone(page);
    expect(await ext.activeTitle(windowId)).toBe(CURRENT);
    await expect.poll(asked, { timeout: 20_000 }).toBeGreaterThan(askedOn);
    await expect.poll(pictured, { timeout: 20_000 }).toBeGreaterThan(kept);
  });
});
