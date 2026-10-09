// Diagnostic, Windows only: which kind of window creation closes Playwright's
// headless Chromium there? Logs one line per variant; no assertions.
import { chromium, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const EXTENSION = fileURLToPath(new URL('../../extension', import.meta.url));

const VARIANTS = {
  'normal, no bounds': {},
  'normal, size and position': { width: 700, height: 500, left: 48, top: 30 },
  'popup, no bounds': { type: 'popup' },
  'popup, size only': { type: 'popup', width: 700, height: 500 },
  'popup, size and position': { type: 'popup', width: 700, height: 500, left: 48, top: 30 },
  'popup, overview page, size and position': { type: 'popup', width: 700, height: 500, left: 48, top: 30, page: 'overview.html' },
};

test.describe('window creation on Windows', () => {
  test.skip(process.platform !== 'win32', 'Windows only');

  for (const [name, options] of Object.entries(VARIANTS)) {
    test(name, async () => {
      const context = await chromium.launchPersistentContext('', {
        channel: 'chromium',
        viewport: null,
        args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
      });
      let closed = false;
      context.on('close', () => { closed = true; });
      let [sw] = context.serviceWorkers();
      sw ??= await context.waitForEvent('serviceworker');
      const display = await sw.evaluate(() => chrome.system.display.getInfo().then((d) => d.map((x) => ({ bounds: x.bounds, workArea: x.workArea }))));
      let created = null;
      let error = null;
      try {
        const { page, ...create } = options;
        created = await sw.evaluate(async ({ create, page }) => {
          const win = await chrome.windows.create({ ...create, url: page ? chrome.runtime.getURL(page) : 'about:blank' });
          return { id: win.id, type: win.type, left: win.left, top: win.top, width: win.width, height: win.height };
        }, { create, page });
      } catch (e) {
        error = e.message.split('\n')[0];
      }
      await new Promise((r) => setTimeout(r, 2000));
      let alive = !closed;
      try {
        await sw.evaluate(() => 1);
      } catch {
        alive = false;
      }
      console.log('DIAG', JSON.stringify({ name, alive, created, error, display }));
      if (alive) await context.close();
    });
  }
});
