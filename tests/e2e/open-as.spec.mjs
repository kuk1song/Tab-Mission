import { test, expect, PAGES } from './fixtures.mjs';

// "What it covers" (settings page, under Art mode; src/host.js): the
// overview as a layer over the page in front, the tab strip in view (the
// default), or a window of its own over the whole browser.
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
    // What the overview's frame writes to the console as errors: nothing.
    const errors = [];
    page.on('console', (message) => {
      if (message.type() === 'error' && message.location().url.startsWith('chrome-extension://')) errors.push(message.text());
    });
    // The page has the keyboard in a field of its own, and listens for keys.
    await page.evaluate(() => {
      const field = Object.assign(document.createElement('input'), { id: 'own-field' });
      document.body.append(field);
      field.focus();
      window.keysSeen = [];
      window.addEventListener('keydown', (e) => window.keysSeen.push(e.key), true);
      // How the layer looks at the moment it is put on.
      new MutationObserver((records, observer) => {
        const layer = records.flatMap((record) => [...record.addedNodes]).find((node) => node.nodeType === 1);
        if (!layer) return;
        observer.disconnect();
        window.layerPutOn = [layer.style.getPropertyValue('opacity'), layer.style.getPropertyValue('pointer-events')];
      }).observe(document.documentElement, { childList: true });
    });
    const windows = await ext.sw.evaluate(() => chrome.windows.getAll().then((all) => all.length));
    const frame = await openOn(ext, page);
    expect(ext.overviewPages()).toEqual([]);
    // Put on unseen (too faint to change a pixel: the next test), letting
    // clicks through, the layer shows by now, and takes the pointer.
    expect(await page.evaluate(() => window.layerPutOn)).toEqual(['0.001', 'none']);
    expect(await page.evaluate(() => {
      const layer = document.documentElement.lastElementChild.style;
      return [layer.getPropertyValue('opacity'), layer.getPropertyValue('pointer-events')];
    })).toEqual(['1', 'auto']);
    expect((await host(ext)).shown).toBeGreaterThan(0);
    await expect(frame.locator('html')).not.toHaveAttribute('data-wait');
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
    expect(errors).toEqual([]);
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

  test('a layer as faint as the unseen one changes no pixel of the page\'s picture, black or white; one that can be seen does', async ({ ext, context }) => {
    const { windowId, tabIds } = await ext.openWindow(['alpha', 'gamma']);
    await choose(ext, {});
    await pageOf(context, 'gamma').bringToFront();
    // In the worker: Chrome's picture of the page (as covers.js takes it)
    // with no layer, then with a layer over all of it, drawn before the
    // picture is taken. Counted: the pixels that differ from the first
    // picture, but for the corner where every test page keeps drawing
    // (fixtures.mjs).
    const differing = await ext.sw.evaluate(async ({ windowId, tabId }) => {
      const picture = async () => {
        for (let tries = 0; ; tries++) {
          try {
            const bitmap = await createImageBitmap(await (await fetch(await chrome.tabs.captureVisibleTab(windowId, { format: 'png' }))).blob());
            const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d', { willReadFrequently: true });
            context.drawImage(bitmap, 0, 0);
            return context.getImageData(0, 0, bitmap.width, bitmap.height);
          } catch (error) {
            // Chrome allows two pictures a second, and the worker takes its own.
            if (tries === 30) throw error;
            await new Promise((resolve) => setTimeout(resolve, 300));
          }
        }
      };
      const layer = (color, opacity) => chrome.scripting.executeScript({
        target: { tabId },
        args: [color, opacity],
        func: (color, opacity) => {
          document.getElementById('faint')?.remove();
          const el = Object.assign(document.createElement('div'), { id: 'faint' });
          el.style.cssText = `position:fixed;inset:0;z-index:2147483647;pointer-events:none;opacity:${opacity};background:${color}`;
          if (color) document.documentElement.append(el);
          return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        },
      });
      const differ = (a, b) => {
        if (a.width !== b.width || a.height !== b.height) return -1;
        let count = 0;
        for (let y = 0; y < a.height; y++) {
          for (let x = 0; x < a.width; x++) {
            if (x >= a.width - 24 && y >= a.height - 24) continue;
            const i = (y * a.width + x) * 4;
            if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) count++;
          }
        }
        return count;
      };
      await layer('', 0);
      const plain = await picture();
      const counts = {};
      for (const [name, color, opacity] of [['black', '#000', 0.001], ['white', '#fff', 0.001], ['seen', '#000', 0.5]]) {
        await layer(color, opacity);
        counts[name] = differ(plain, await picture());
      }
      await layer('', 0);
      return counts;
    }, { windowId, tabId: tabIds.gamma });
    expect(differing.black).toBe(0);
    expect(differing.white).toBe(0);
    expect(differing.seen).toBeGreaterThan(1000);
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
    // The page's own picture first (half a second after it came in front),
    // and its turn over: a press within 550 ms of another picture waits its
    // turn, and that picture is not taken once the overview shows (covers.js,
    // CAPTURE_GAP_MS). The next one the page takes by itself is 2.5 s away.
    await expect.poll(pictured, { timeout: 10_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(600);
    const askedBefore = asked();

    await ext.pressDefaultShortcut(page);
    await expect.poll(() => Boolean(frameOn(page))).toBe(true);
    const frame = frameOn(page);
    // Its cards first: until main.js has them, the grid is not marked as
    // entering either, and the frame has not been let in yet.
    await frame.locator('#grid .tile').first().waitFor();
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
