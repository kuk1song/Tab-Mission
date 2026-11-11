// Playwright fixtures: the unpacked extension in Playwright's Chromium, fake
// websites served locally, and helpers that drive the overview the way a user
// does. Most presses are sent through background.js (the openOverview
// message of the welcome page's button, the same path as chrome.commands,
// except that a window it opens counts as opened with a click, and that it
// takes no picture of the page in front and does not tick the welcome page's
// first step);
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
  // Painted at once, but its load is held up by an image the site sends
  // only when the test says so (GET /release).
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
  // A site that answers only when the test says so (GET /release): a tab
  // sent to /held/<id>.html stays on its way, with no address yet, only the
  // one it is going to (Tab.pendingUrl), until then.
  const held = [];
  const server = http.createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    if (path === '/seen') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(seen));
      return;
    }
    if (path === '/release') {
      for (const send of held.splice(0)) send();
      res.end();
      return;
    }
    if (path.startsWith('/held/')) {
      // The tab may be gone by then (an earlier test's).
      held.push(() => res.destroyed || sendPage(res, path.slice('/held'.length)));
      return;
    }
    if (path === '/img/cookie-wide.svg') seen.push({ cookie: req.headers.cookie ?? null, referer: req.headers.referer ?? null });
    if (path.startsWith('/slow/')) {
      held.push(() => res.destroyed || res.writeHead(200, { 'content-type': 'image/svg+xml' })
        .end('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'));
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
    sendPage(res, path);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Every page draws a new frame now and then: a 2 px dot in a corner
// changes shade every 0.4 s. On macOS runners Chrome answers a page picture
// (captureVisibleTab) only once the page draws again, so a still page could
// keep it waiting for seconds or for good (6 of 411 pictures never came
// back; 0 of 419 on drawing pages, PR #54). Linux and Windows runners, and a
// Mac's own display, answer at once. Not an animation: one at 60 frames a
// second in every tab slowed the many-tab tests past their time limit.
const DRAWING = '<i id="tm-dot" style="position:fixed;right:3px;bottom:3px;width:2px;height:2px;background:#888"></i>'
  + '<script>{let n=0;const d=document.getElementById("tm-dot");setInterval(()=>{d.style.background=++n%2?"#898989":"#888"},400)}</script>';

// /<id>.html from PAGES.
function sendPage(res, path) {
  const id = path.replace(/^\//, '').replace(/\.html$/, '');
  const page = PAGES[id] ?? { title: `Tab ${id}` };
  const og = (page.og ? `<meta property="og:image" content="${page.og}">` : '')
    + (page.touch ? `<link rel="apple-touch-icon" href="${page.touch}">` : '');
  const slow = page.slow ? '<img src="/slow/1.svg">' : '';
  const icon = page.icon ? `<link rel="icon" href="${page.icon}">` : '';
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...(page.setsCookie ? { 'set-cookie': 'session=1; Path=/; SameSite=Lax' } : {}) });
  res.end(`<!doctype html><html><head><title>${page.title}</title>${og}${icon}</head><body><h1>${page.title}</h1>${slow}${DRAWING}</body></html>`);
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

// Playwright's Chromium with the unpacked extension, on this profile;
// headless unless the test's project says otherwise (playwright.config.mjs).
function launch(profile, { launchArgs = [], showScrollbars = false, headless = true } = {}) {
  return chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    // Headless Chromium on Windows closes itself on the first
    // chrome.system.display.getInfo() call (seen on windows-latest, where
    // the headed browser returns the real display), so Windows runs
    // headed. The extension calls it before opening the overview.
    headless: headless && process.platform !== 'win32',
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
    // A start that hangs (seen once on macos-latest) is given up after
    // 20 s, not at the 30 s test timeout, where the hung browser also
    // stalled the worker's teardown. CI then retries the test once, and one
    // that passes only on its retry still fails the run (failOnFlakyTests).
    timeout: 20_000,
  });
}

// Each page picture the worker asks Chrome for (covers.js), written to its
// console: when it was asked, and when it came back (how big) or failed.
// A failed test carries the console (swConsole), so it shows whether a
// capture was asked for at all, never came back, or came back. The call is
// passed through unchanged.
function recordCaptures(worker) {
  return worker.evaluate(() => {
    const capture = chrome.tabs.captureVisibleTab.bind(chrome.tabs);
    const time = () => new Date().toISOString().slice(11, 23);
    chrome.tabs.captureVisibleTab = async (windowId, options) => {
      console.debug(`${time()} capture of window ${windowId} asked`);
      try {
        const data = await capture(windowId, options);
        console.debug(`${time()} capture of window ${windowId} came back, ${data.length} characters`);
        return data;
      } catch (error) {
        console.debug(`${time()} capture of window ${windowId} failed: ${error.message}`);
        throw error;
      }
    };
  });
}

// Measurement branch only (test/measure-install-timing), not for merge: how
// long the install takes in each test, in milliseconds from the start of the
// browser's launch (context) to each step. Printed as one line per test,
// once the browser is closed, also for a test that failed or timed out
// (steps not reached are null):
//   INSTALL-TIMING {"os":"win32","test":"keyboard.spec.mjs:35 ...",...}
// scripts/install-timing-summary.mjs reads these lines from a saved CI log.
// Fixture side: launchMs (the browser started), swMs (Playwright has its
// worker, which can be before the worker's script runs; swEarly: it had it
// already when the browser started), welcomeMs (the welcome page found),
// tipsMs (tipsLeft read back), tipsWaitMs (tipsMs after welcomeMs: the wait
// that has 5 s on main). Worker side, from marks in background.js and
// tryit.js: swOriginMs (the worker's time origin), swScriptMs (background.js
// starts to run), installedMs (onInstalled fires; the tipsLeft write goes
// out at once), tipsWrittenMs (that write resolves), welcomeCreatedMs
// (tabs.create of the welcome page resolves); setMs is tipsWrittenMs after
// installedMs. Welcome page side: welcomeOriginMs (its navigation starts),
// welcomeLoadedMs (its load event ends), welcomeShownMs (its content shows,
// after its own reads of storage; mark in welcome.js). tipsPolls is how
// many reads the wait made, tipsEvalMaxMs the slowest read's round trip
// from here, tipsGetMaxMs the slowest chrome.storage.local.get inside the
// worker.
function since(t0, epoch) {
  return t0 === null || epoch === null || epoch === undefined ? null : epoch - t0;
}

// The worker's and the welcome page's marks, read on their own clocks
// (performance.timeOrigin) and moved onto Date.now(), the clock t0 is on.
async function installMarks(sw, welcome) {
  const worker = await sw.evaluate(() => {
    const skew = Date.now() - (performance.timeOrigin + performance.now());
    const at = (t) => Math.round(performance.timeOrigin + t + skew);
    const marks = { origin: at(0) };
    for (const mark of performance.getEntriesByType('mark')) {
      if (mark.name.startsWith('tm:')) marks[mark.name.slice(3)] = at(mark.startTime);
    }
    return marks;
  }).catch(() => ({}));
  return { worker, page: await welcomeMarks(welcome) };
}

function welcomeMarks(welcome) {
  if (!welcome) return {};
  return welcome.evaluate(() => {
    const skew = Date.now() - (performance.timeOrigin + performance.now());
    const at = (t) => Math.round(performance.timeOrigin + t + skew);
    const nav = performance.getEntriesByType('navigation')[0];
    const shown = performance.getEntriesByName('tm:welcome-shown')[0];
    return { origin: at(0), loaded: nav?.loadEventEnd ? at(nav.loadEventEnd) : null, shown: shown ? at(shown.startTime) : null };
  }).catch(() => ({}));
}

export const test = base.extend({
  // Extra Chromium switches (e.g. a simulated screen) and whether to draw
  // scrollbars (Playwright hides them in headless mode by default).
  launchArgs: [[], { option: true }],
  showScrollbars: [false, { option: true }],

  // Measurement only, not for merge (see installMarks above): filled in by
  // context, sw and ext, printed after the browser has closed.
  // eslint-disable-next-line no-empty-pattern -- Playwright reads a fixture's needs from its first parameter, which must be an object pattern.
  installTiming: async ({}, use, testInfo) => {
    const timing = { t0: null, at: {}, marks: { worker: {}, page: {} }, polls: { count: 0, evalMax: null, getMax: null } };
    await use(timing);
    const { t0, at, marks: { worker, page }, polls } = timing;
    const line = {
      os: process.platform,
      project: testInfo.project.name,
      test: `${path.basename(testInfo.file)}:${testInfo.line} ${testInfo.titlePath.slice(1).join(' > ')}`,
      retry: testInfo.retry,
      status: testInfo.status,
      launchMs: since(t0, at.launch),
      swMs: since(t0, at.sw),
      swEarly: at.swEarly ?? null,
      welcomeMs: since(t0, at.welcome),
      tipsMs: since(t0, at.tips),
      tipsWaitMs: since(at.welcome ?? null, at.tips),
      swOriginMs: since(t0, worker.origin),
      swScriptMs: since(t0, worker.script),
      installedMs: since(t0, worker.installed),
      tipsWrittenMs: since(t0, worker['tips-written']),
      setMs: since(worker.installed ?? null, worker['tips-written']),
      welcomeCreatedMs: since(t0, worker['welcome-created']),
      welcomeOriginMs: since(t0, page.origin),
      welcomeLoadedMs: since(t0, page.loaded),
      welcomeShownMs: since(t0, page.shown),
      tipsPolls: polls.count,
      tipsEvalMaxMs: polls.evalMax,
      tipsGetMaxMs: polls.getMax,
    };
    console.log(`INSTALL-TIMING ${JSON.stringify(line)}`);
  },

  // One local web server per worker.
  // eslint-disable-next-line no-empty-pattern -- Playwright reads a fixture's needs from its first parameter, which must be an object pattern.
  site: [async ({}, use) => {
    const server = await startSite();
    await use({ port: server.address().port });
    server.close();
  }, { scope: 'worker' }],

  // The browser profile, a fresh folder per test (read by browserCommand).
  // eslint-disable-next-line no-empty-pattern -- Playwright reads a fixture's needs from its first parameter, which must be an object pattern.
  profile: async ({}, use) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tab-mission-e2e-'));
    await use(dir);
    // Windows may still hold a file of the closed browser for a moment.
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  },

  context: async ({ profile, launchArgs, showScrollbars, headless, installTiming }, use) => {
    installTiming.t0 = Date.now(); // measurement only, not for merge
    const context = await launch(profile, { launchArgs, showScrollbars, headless });
    installTiming.at.launch = Date.now(); // measurement only, not for merge
    await use(context);
    await context.close();
  },

  // What the service workers write to their console (a page picture Chrome
  // refuses is logged there), attached to a test that fails.
  // eslint-disable-next-line no-empty-pattern -- Playwright reads a fixture's needs from its first parameter, which must be an object pattern.
  swConsole: async ({}, use, testInfo) => {
    const lines = [];
    await use(lines);
    if (testInfo.status !== testInfo.expectedStatus && lines.length) {
      await testInfo.attach('service worker console', { body: lines.join('\n'), contentType: 'text/plain' });
    }
  },

  // The extension's worker, once Chrome has started it. That start is the
  // browser's, not the test's, so it has its own time, outside the test's
  // 30 s: on windows-latest it once came 23 s after the browser (CI run
  // 40283127745), and the test's time ran out before the test began.
  sw: [async ({ context, swConsole, installTiming }, use) => {
    let [worker] = context.serviceWorkers();
    installTiming.at.swEarly = Boolean(worker); // measurement only, not for merge
    worker ??= await context.waitForEvent('serviceworker');
    installTiming.at.sw = Date.now(); // measurement only, not for merge
    worker.on('console', (message) => swConsole.push(`${message.type()}: ${message.text()}`));
    await recordCaptures(worker);
    await use(worker);
  }, { timeout: 60_000 }],

  ext: async ({ context, sw, swConsole, site, profile, launchArgs, headless, installTiming }, use) => {
    // Measurement only, not for merge: the try reads the marks of the
    // install (installMarks) also when a wait below fails.
    const { polls } = installTiming;
    let welcome;
    try {
      // The welcome page opens on install; it doubles as the extension page
      // that sends "shortcut presses" to background.js.
      await expect.poll(() => context.pages().some((p) => p.url().endsWith('/welcome.html')), { timeout: 15_000 }).toBe(true);
      installTiming.at.welcome = Date.now(); // measurement only, not for merge
      welcome = context.pages().find((p) => p.url().endsWith('/welcome.html'));
      // A new install gives the Tab Mission window its tips (background.js).
      // tips.spec gives them back where it tests them; elsewhere they would
      // cover cards that tests point at.
      // Measurement branch only, not for merge: the same read at the same
      // intervals as on main, timed, and waited for up to 20 s instead of
      // the default 5 s, so a slow install is measured instead of failing
      // the test here.
      await expect.poll(async () => {
        polls.count++;
        const start = Date.now();
        const { tipsLeft, getMs } = await sw.evaluate(async () => {
          const start = performance.now();
          const { tipsLeft } = await chrome.storage.local.get('tipsLeft');
          return { tipsLeft, getMs: Math.round(performance.now() - start) };
        });
        polls.evalMax = Math.max(polls.evalMax ?? 0, Date.now() - start);
        polls.getMax = Math.max(polls.getMax ?? 0, getMs);
        return tipsLeft;
      }, { timeout: 20_000 }).toEqual({ open: 3, back: 3, point: 3 });
      installTiming.at.tips = Date.now(); // measurement only, not for merge
    } finally {
      installTiming.marks = await installMarks(sw, welcome);
    }
    await sw.evaluate(() => chrome.storage.local.remove('tipsLeft'));
    // Grouping by site is on for users by default and applies to any number
    // of tabs, so each recent tab would have a second tile. Most tests are
    // about the plain grid; group-by-site.spec, a test in cards.spec and the
    // tests of many tabs (layout, smooth, visual) turn it back on.
    await sw.evaluate(() => chrome.storage.local.set({ groupBySite: false }));
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
          // Each page is waited for until it loads, as long as the test may
          // run: a page that never loads fails the test at its timeout. One
          // still loading after 5 s is named in the worker's console, which a
          // failed test carries (on Windows CI, two of 24 new tabs once had
          // not started loading after 5 s).
          const loaded = async (id) => {
            for (let i = 1; ; i++) {
              const t = await chrome.tabs.get(id);
              if (t.status === 'complete' && t.title && !t.title.startsWith('http')) return;
              if (i === 100) console.warn(`tab ${id} not loaded after 5 s: ${t.status}, ${JSON.stringify(t.url || t.pendingUrl)}, ${JSON.stringify(t.title)}`);
              await new Promise((r) => setTimeout(r, 50));
            }
          };
          for (const id of Object.values(tabIds)) await loaded(id);
          // Visit in order, each after the one before by the clock Chrome
          // notes visits with (lastAccessed, in milliseconds), and noted
          // before the next.
          let previous = 0;
          for (const id of Object.values(tabIds)) {
            while (Date.now() <= previous) await new Promise((r) => setTimeout(r, 1));
            await chrome.tabs.update(id, { active: true });
            for (;;) {
              const { lastAccessed } = await chrome.tabs.get(id);
              if (lastAccessed > previous) {
                previous = lastAccessed;
                break;
              }
              await new Promise((r) => setTimeout(r, 1));
            }
          }
          // Focus can come after update resolves (on Windows focus is real):
          // wait until Chrome reports this window as the last focused one,
          // which is how Tab Mission finds the current window, as long as
          // the test may run. Still without focus after 5 s, it is named in
          // the worker's console, as a slow page is above.
          await chrome.windows.update(win.id, { focused: true });
          for (let i = 1; ; i++) {
            const last = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
            if (last.id === win.id) break;
            if (i === 100) console.warn(`window ${win.id} without focus after 5 s (last focused: ${last.id})`);
            await new Promise((r) => setTimeout(r, 50));
          }
          return { windowId: win.id, tabIds };
        }, { urls, ids });
      },

      // Open a tab at this address (a browser page, about:blank) in a window,
      // in the background unless active, and wait until Chrome reports the
      // address: a new tab has none until its page commits (Tab.url "may be an
      // empty string if the tab has not yet committed", chrome.tabs docs), and
      // Tab Mission reads the tabs once, when it opens. Returns the tab id.
      async openTab(windowId, address, { active = false } = {}) {
        const id = await sw.evaluate(({ windowId, address, active }) =>
          chrome.tabs.create({ windowId, url: address, active }).then((t) => t.id), { windowId, address, active });
        await expect.poll(() => sw.evaluate((id) => chrome.tabs.get(id).then((t) => t.url), id)).toBe(address);
        return id;
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
      // Ctrl+Shift+E elsewhere (manifest suggested_key). A user's key goes to
      // the window that has focus, and Tab Mission acts on a press as made
      // in its own window only while that window has focus (or within a
      // second of opening, background.js); headed, focus is real and can
      // come a moment after the window shows, so a press there waits for it.
      async pressDefaultShortcut(page) {
        if (page.url().includes('/overview.html')) {
          await expect.poll(() => page.evaluate(() => chrome.windows.getCurrent().then((w) => w.focused))).toBe(true);
        }
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
        const again = await launch(profile, { launchArgs: [...launchArgs, '--restore-last-session'], headless });
        let [worker] = again.serviceWorkers();
        worker ??= await again.waitForEvent('serviceworker');
        worker.on('console', (message) => swConsole.push(`restarted ${message.type()}: ${message.text()}`));
        await recordCaptures(worker);
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
    };
    await use(ext);
    // Measurement only, not for merge: a welcome page that had not shown
    // when tipsLeft was read is asked again (null if it is gone by now).
    if (installTiming.marks.page.shown == null) {
      installTiming.marks.page.shown = (await welcomeMarks(welcome)).shown ?? null;
    }
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

// Contrast of each text against what is painted behind it (the page color
// with any translucent surfaces on top), counting the opacity of each layer
// and its ancestors (a faded control's text is fainter). One decimal.
export function contrasts(page, selectors) {
  return page.evaluate((selectors) => {
    const rgba = (s) => (s.match(/[\d.]+/g) || []).map(Number);
    const over = (top, bottom, alpha) => [0, 1, 2].map((i) => top[i] * alpha + bottom[i] * (1 - alpha));
    const opacity = (node) => {
      let value = 1;
      for (let n = node; n; n = n.parentElement) value *= Number(getComputedStyle(n).opacity);
      return value;
    };
    const luminance = (c) => {
      const [r, g, b] = c.map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const result = {};
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      const chain = [];
      for (let node = el; node; node = node.parentElement) chain.push(node);
      let behind = [255, 255, 255];
      for (const node of chain.reverse()) {
        const layer = rgba(getComputedStyle(node).backgroundColor);
        if (layer.length) behind = over(layer, behind, (layer[3] ?? 1) * opacity(node));
      }
      const text = rgba(getComputedStyle(el).color);
      const [fg, bg] = [luminance(over(text, behind, (text[3] ?? 1) * opacity(el))), luminance(behind)];
      result[selector] = Math.round(((Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05)) * 10) / 10;
    }
    return result;
  }, selectors);
}

export function selectedTitle(page) {
  return page.evaluate(() => document.querySelector('.tile.selected .title')?.textContent ?? null);
}
