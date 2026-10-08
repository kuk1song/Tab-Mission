// Playwright fixtures: the unpacked extension in Playwright's Chromium, fake
// websites served locally, and helpers that drive the overview the way a user
// does. The shortcut is sent through background.js (the openOverview message),
// the same path as chrome.commands, which Playwright cannot press.
import { test as base, expect, chromium } from '@playwright/test';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const EXTENSION = fileURLToPath(new URL('../../extension', import.meta.url));

// Every host resolves to the local server (--host-resolver-rules), which
// renders /<id>.html from this table. Hosts use the reserved .test TLD: real
// domains such as github.com are on Chromium's HSTS preload list and would be
// forced to https.
export const PAGES = {
  alpha: { title: 'Page alpha docs', og: '/img/alpha.svg' },
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

function startSite() {
  const server = http.createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    if (path.startsWith('/img/')) {
      res.writeHead(200, { 'content-type': 'image/svg+xml' });
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="100%" height="100%" fill="#4a6"/></svg>');
      return;
    }
    const id = path.replace(/^\//, '').replace(/\.html$/, '');
    const page = PAGES[id] ?? { title: `Tab ${id}` };
    const og = page.og ? `<meta property="og:image" content="${page.og}">` : '';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><title>${page.title}</title>${og}</head><body><h1>${page.title}</h1></body></html>`);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
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

  context: async ({ launchArgs, showScrollbars }, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      // No viewport emulation: windows keep the size the extension gives
      // them (it saves and restores the overview's bounds).
      viewport: null,
      ignoreDefaultArgs: showScrollbars ? ['--hide-scrollbars'] : [],
      args: [
        `--disable-extensions-except=${EXTENSION}`,
        `--load-extension=${EXTENSION}`,
        '--host-resolver-rules=MAP * 127.0.0.1',
        ...launchArgs,
      ],
    });
    await use(context);
    await context.close();
  },

  sw: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent('serviceworker');
    await use(worker);
  },

  ext: async ({ context, sw, site }, use) => {
    // The welcome page opens on install; it doubles as the extension page
    // that sends "shortcut presses" to background.js.
    await expect.poll(() => context.pages().some((p) => p.url().endsWith('/welcome.html'))).toBe(true);
    const welcome = context.pages().find((p) => p.url().endsWith('/welcome.html'));
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
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...event });
        await cdp.detach();
      },

      // The default overview shortcut of this OS: Command+E on Mac,
      // Ctrl+Shift+E elsewhere (manifest suggested_key).
      async pressDefaultShortcut(page) {
        const mac = process.platform === 'darwin';
        await ext.pressKeys(page, { key: 'e', code: 'KeyE', keyCode: 69, macKeyCode: 14, modifiers: mac ? 4 : 2 | 8 });
      },

      // The shortcut (scope 'site' for the site command).
      async press(scope) {
        await welcome.evaluate((scope) => chrome.runtime.sendMessage({ action: 'openOverview', scope }).catch(() => {}), scope);
      },

      overviewPages() {
        return context.pages().filter((p) => p.url().includes('/overview.html'));
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

export function selectedTitle(page) {
  return page.evaluate(() => document.querySelector('.tile.selected .title')?.textContent ?? null);
}
