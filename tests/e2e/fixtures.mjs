// Playwright fixtures: the unpacked extension in Playwright's Chromium, fake
// websites served locally, and helpers that drive the overview the way a user
// does. Most presses are sent through background.js (the openOverview
// message of the welcome page's button, the same path as chrome.commands,
// except that a window it opens counts as opened with a click);
// pressDefaultShortcut presses the real key through Chrome's own key handling,
// and clickToolbarButton fires the toolbar button's own event.
import { test as base, expect, chromium } from '@playwright/test';
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXTENSION = fileURLToPath(new URL('../../extension', import.meta.url));

// Every host resolves to the local server (--host-resolver-rules), which
// renders /<id>.html from this table. Hosts use the reserved .test TLD: real
// domains such as github.com are on Chromium's HSTS preload list and would be
// forced to https.
export const PAGES = {
  alpha: { title: 'Page alpha docs', og: '/img/alpha.svg' },
  logo: { title: 'Page logo docs', og: '/img/logo-square.svg' },
  photo: { title: 'Page photo docs', og: '/img/photo-portrait.svg' },
  red: { title: 'Page red docs, with a title long enough to need two lines on a card and more', icon: '/img/icon-red.svg' },
  // Sets a cookie, and names an image whose request the server records.
  cookie: { title: 'Page cookie docs', og: '/img/cookie-wide.svg', setsCookie: true },
  icon: { title: 'Page icon docs', touch: '/img/touch-square.svg' },
  // Painted at once, but its load is held up by an image for 10 s.
  slow: { title: 'Page slow docs', slow: true },
  beta: { title: 'Page beta docs' },
  gamma: { title: 'Page gamma docs' },
  tube1: { title: 'Lo-fi jazz for focused work - Tube' },
  tube2: { title: 'CS50 Lecture 5: Unit Tests - Tube' },
  tube3: { title: 'How Chrome handles 100 tabs - Tube' },
  code1: { title: 'Pull requests - Code' },
  code2: { title: 'kuk1song/Tab-Mission - Code' },
  notes1: { title: 'Creator Center - Notes' },
  notes2: { title: 'Weekend trip - Notes' },
  doc1: { title: 'Q4 product plan - Docs' },
};

const HOSTS = {
  alpha: 'localhost', beta: 'localhost', gamma: 'localhost',
  tube1: 'www.tube.test', tube2: 'www.tube.test', tube3: 'www.tube.test',
  code1: 'code.test', code2: 'code.test',
  notes1: 'www.notes.test', notes2: 'www.notes.test',
  doc1: 'docs.office.test',
};

// The headers of the requests for /img/cookie-wide.svg, newest last (GET /seen).
const seen = [];

function startSite() {
  const server = http.createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    if (path === '/seen') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(seen));
      return;
    }
    if (path === '/img/cookie-wide.svg') seen.push({ cookie: req.headers.cookie ?? null, referer: req.headers.referer ?? null });
    if (path.startsWith('/slow/')) {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'image/svg+xml' });
        res.end('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
      }, 10_000);
      return;
    }
    if (path.startsWith('/img/')) {
      // A social preview's shape, a logo's or a portrait photo's.
      const [w, h] = path.includes('square') ? [180, 180] : path.includes('portrait') ? [600, 800] : path.includes('icon') ? [32, 32] : [1200, 630];
      const fill = path.includes('red') ? '#e0202a' : '#4a6';
      res.writeHead(200, { 'content-type': 'image/svg+xml' });
      res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${fill}"/></svg>`);
      return;
    }
    const id = path.replace(/^\//, '').replace(/\.html$/, '');
    const page = PAGES[id] ?? { title: `Tab ${id}` };
    const og = (page.og ? `<meta property="og:image" content="${page.og}">` : '')
      + (page.touch ? `<link rel="apple-touch-icon" href="${page.touch}">` : '');
    const slow = page.slow ? '<img src="/slow/1.svg">' : '';
    const icon = page.icon ? `<link rel="icon" href="${page.icon}">` : '';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...(page.setsCookie ? { 'set-cookie': 'session=1; Path=/; SameSite=Lax' } : {}) });
    res.end(`<!doctype html><html><head><title>${page.title}</title>${og}${icon}</head><body><h1>${page.title}</h1>${slow}</body></html>`);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// One command to the browser's own DevTools endpoint (not a page's), found
// through the DevToolsActivePort file that --remote-debugging-port=0 writes
// into the profile.
async function browserCommand(profile, method, params) {
  const [port, wsPath] = readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').trim().split('\n');
  const ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  try {
    const reply = await new Promise((resolve) => {
      ws.onmessage = (e) => {
        const message = JSON.parse(e.data);
        if (message.id === 1) resolve(message);
      };
      ws.send(JSON.stringify({ id: 1, method, params }));
    });
    if (reply.error) throw new Error(`${method}: ${reply.error.message}`);
    return reply.result;
  } finally {
    ws.close();
  }
}

// Playwright's Chromium with the unpacked extension, on this profile.
function launch(profile, { launchArgs = [], showScrollbars = false } = {}) {
  return chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    // Headless Chromium on Windows closes itself on the first
    // chrome.system.display.getInfo() call (seen on windows-latest, where
    // the headed browser returns the real display), so Windows runs
    // headed. The extension calls it before opening the overview.
    headless: process.platform !== 'win32',
    // No viewport emulation: windows keep the size the extension gives
    // them (it saves and restores the overview's bounds).
    viewport: null,
    ignoreDefaultArgs: showScrollbars ? ['--hide-scrollbars'] : [],
    args: [
      `--disable-extensions-except=${EXTENSION}`,
      `--load-extension=${EXTENSION}`,
      '--host-resolver-rules=MAP * 127.0.0.1',
      // The DevTools endpoint and its Extensions domain, for
      // clickToolbarButton.
      '--remote-debugging-port=0',
      '--enable-unsafe-extension-debugging',
      ...launchArgs,
    ],
    // A start that hangs (seen once on macos-latest) is killed and the
    // test retried. Left to the 30 s test timeout, the hung browser also
    // stalls the worker's teardown, which fails the whole run even when
    // the retry passes.
    timeout: 20_000,
  });
}

export const test = base.extend({
  // Extra Chromium switches (e.g. a simulated screen) and whether to draw
  // scrollbars (Playwright hides them in headless mode by default).
  launchArgs: [[], { option: true }],
  showScrollbars: [false, { option: true }],

  // One local web server per worker.
  site: [async ({}, use) => {
    const server = await startSite();
    await use({ port: server.address().port });
    server.close();
  }, { scope: 'worker' }],

  // The browser profile, a fresh folder per test (read by browserCommand).
  profile: async ({}, use) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tab-mission-e2e-'));
    await use(dir);
    // Windows may still hold a file of the closed browser for a moment.
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  },

  context: async ({ profile, launchArgs, showScrollbars }, use) => {
    const context = await launch(profile, { launchArgs, showScrollbars });
    await use(context);
    await context.close();
  },

  sw: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent('serviceworker');
    await use(worker);
  },

  ext: async ({ context, sw, site, profile, launchArgs }, use) => {
    // The welcome page opens on install; it doubles as the extension page
    // that sends "shortcut presses" to background.js.
    await expect.poll(() => context.pages().some((p) => p.url().endsWith('/welcome.html')), { timeout: 15_000 }).toBe(true);
    const welcome = context.pages().find((p) => p.url().endsWith('/welcome.html'));
    // A new install gives the Tab Mission window its tips (background.js).
    // tips.spec gives them back where it tests them; elsewhere they would
    // cover cards that tests point at.
    await expect.poll(() => sw.evaluate(() => chrome.storage.local.get('tipsLeft').then((r) => r.tipsLeft))).toEqual({ open: 3, back: 3 });
    await sw.evaluate(() => chrome.storage.local.remove('tipsLeft'));
    const url = (id, query = '') => `http://${HOSTS[id] ?? 'localhost'}:${site.port}/${id}.html${query}`;

    const ext = {
      sw,
      welcome,
      url,

      // Open a normal window with these pages (ids from PAGES, or
      // "<id>?<query>" for a distinct URL), visited in order, so the last one
      // is the current tab and the one before it the previous tab. The window
      // opened last is the user's current window. Returns the window id and a
      // map of id to tab id.
      async openWindow(ids) {
        const urls = ids.map((id) => {
          const [base, query] = id.split('?');
          return url(base, query ? `?${query}` : '');
        });
        return sw.evaluate(async ({ urls, ids }) => {
          // (focused: false crashes headless Chromium 153; the window opened
          // last simply becomes the focused one.)
          const win = await chrome.windows.create({ url: urls[0], width: 1200, height: 800 });
          const tabIds = { [ids[0]]: win.tabs[0].id };
          for (let i = 1; i < urls.length; i++) {
            const tab = await chrome.tabs.create({ windowId: win.id, url: urls[i], active: false });
            tabIds[ids[i]] = tab.id;
          }
          const loaded = async (id) => {
            for (let i = 0; i < 100; i++) {
              const t = await chrome.tabs.get(id);
              if (t.status === 'complete' && t.title && !t.title.startsWith('http')) return;
              await new Promise((r) => setTimeout(r, 50));
            }
          };
          for (const id of Object.values(tabIds)) await loaded(id);
          // Visit in order with distinct lastAccessed times.
          for (const id of Object.values(tabIds)) {
            await chrome.tabs.update(id, { active: true });
            await new Promise((r) => setTimeout(r, 30));
          }
          await chrome.windows.update(win.id, { focused: true });
          return { windowId: win.id, tabIds };
        }, { urls, ids });
      },

      // A real key press that Chrome's own shortcut handling sees, unlike
      // page.keyboard (Playwright's events skip the browser: "Playwright can
      // only automate web content, but not the browser UI"). A trusted CDP
      // client that sets nativeVirtualKeyCode gets its key events pre-handled
      // by the browser, where extension commands live (Chromium
      // content/browser/devtools/protocol/input_handler.cc). Mac needs the
      // real Mac key code, since Chrome builds an NSEvent from it.
      // modifiers: Alt 1, Ctrl 2, Meta 4, Shift 8.
      async pressKeys(page, { key, code, keyCode, macKeyCode, modifiers }) {
        const cdp = await page.context().newCDPSession(page);
        const event = {
          key, code, modifiers,
          windowsVirtualKeyCode: keyCode,
          nativeVirtualKeyCode: process.platform === 'darwin' ? macKeyCode : keyCode,
        };
        await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...event });
        // The key can close the page it was pressed in (the shortcut in the
        // overview switches tabs), which ends the session too, so the rest is
        // best effort; callers check what the key did.
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...event }).catch(() => {});
        await cdp.detach().catch(() => {});
      },

      // The default overview shortcut of this OS: Command+E on Mac,
      // Ctrl+Shift+E elsewhere (manifest suggested_key).
      async pressDefaultShortcut(page) {
        const mac = process.platform === 'darwin';
        await ext.pressKeys(page, { key: 'e', code: 'KeyE', keyCode: 69, macKeyCode: 14, modifiers: mac ? 4 : 2 | 8 });
      },

      // A click on Tab Mission's toolbar button. The button is browser UI,
      // out of Playwright's reach; Chrome's DevTools protocol fires its
      // chrome.action.onClicked (Extensions.triggerAction) on the active tab
      // of the window the user is in. Unlike a real click it leaves focus
      // where it is (background.js treats a click just after Tab Mission lost
      // focus like one while it has focus; unit tests cover that).
      async clickToolbarButton() {
        const url = await sw.evaluate(async () => {
          const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
          return (await chrome.tabs.query({ active: true, windowId: win.id }))[0].url;
        });
        const { targetInfos } = await browserCommand(profile, 'Target.getTargets', { filter: [{ type: 'tab' }] });
        const target = targetInfos.find((t) => t.url === url);
        await browserCommand(profile, 'Extensions.triggerAction', { id: new URL(sw.url()).host, targetId: target.targetId });
      },

      // The shortcut (scope 'site' for the site command), sent as the
      // welcome page's button sends it.
      async press(scope) {
        await welcome.evaluate((scope) => chrome.runtime.sendMessage({ action: 'openOverview', scope }).catch(() => {}), scope);
      },

      overviewPages() {
        return context.pages().filter((p) => p.url().includes('/overview.html'));
      },

      // Quit the browser and start it again on the same profile with the
      // last session's tabs, as Chrome's "Continue where you left off" does.
      // Returns the new browser and its service worker; the caller closes it.
      async restart() {
        await context.close();
        const again = await launch(profile, { launchArgs: [...launchArgs, '--restore-last-session'] });
        let [worker] = again.serviceWorkers();
        worker ??= await again.waitForEvent('serviceworker');
        return { context: again, sw: worker };
      },

      // Press the shortcut and return the overview page once it has rendered.
      async open(scope) {
        const opened = context.waitForEvent('page', (p) => p.url().includes('/overview.html'));
        await ext.press(scope);
        const page = await opened;
        await page.locator('#grid .tile, #grid .empty').first().waitFor();
        return page;
      },

      async expectClosed() {
        await expect.poll(() => ext.overviewPages().length).toBe(0);
      },

      // A key that closes the overview (Enter on a tile, the last Esc). The
      // page may close between key down and key up, so a "closed" error from
      // the key up is expected; the overview must be gone afterwards.
      async pressToClose(page, key) {
        await page.keyboard.press(key).catch((error) => {
          if (!/closed/i.test(error.message)) throw error;
        });
        await ext.expectClosed();
      },

      activeTitle(windowId) {
        return sw.evaluate((windowId) => chrome.tabs.query({ active: true, windowId }).then((t) => t[0]?.title), windowId);
      },

      popupCount() {
        return sw.evaluate(() => chrome.windows.getAll({ windowTypes: ['popup'] }).then((w) => w.length));
      },
    };
    await use(ext);
  },
});

export { expect };

// Titles of the tiles in grid order.
export function tileTitles(page) {
  return page.locator('.tile .title').allTextContents();
}

// Point at a tile the way a hand does: several mousemove events inside it,
// so the overview's pointer takeover (8 px) sees a real movement.
export async function pointAt(page, target) {
  const box = await target.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x - 40, y);
  await page.mouse.move(x, y, { steps: 4 });
}

export function selectedTitle(page) {
  return page.evaluate(() => document.querySelector('.tile.selected .title')?.textContent ?? null);
}
