// Diagnostic, Windows only: does chrome.system.display.getInfo() close
// Playwright's Chromium there, headless and headed? And does creating a popup
// window without it work? Logs one line per case; no assertions.
import { chromium, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const EXTENSION = fileURLToPath(new URL('../../extension', import.meta.url));

const ACTIONS = {
  'display.getInfo': () => chrome.system.display.getInfo().then((d) => d.map((x) => ({ bounds: x.bounds, workArea: x.workArea }))),
  'popup window': () => chrome.windows.create({ type: 'popup', url: 'about:blank', width: 700, height: 500, left: 48, top: 30 })
    .then((w) => ({ id: w.id, type: w.type })),
};

test.describe('Chromium on Windows', () => {
  test.skip(process.platform !== 'win32', 'Windows only');

  for (const headless of [true, false]) {
    for (const [name, action] of Object.entries(ACTIONS)) {
      test(`${name}, headless=${headless}`, async () => {
        const context = await chromium.launchPersistentContext('', {
          channel: 'chromium',
          headless,
          viewport: null,
          args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
        });
        let closed = false;
        context.on('close', () => { closed = true; });
        let [sw] = context.serviceWorkers();
        sw ??= await context.waitForEvent('serviceworker');
        // Let startup settle (the welcome page opens on install).
        await new Promise((r) => setTimeout(r, 1500));
        const aliveBefore = !closed;
        let result = null;
        let error = null;
        try {
          result = await sw.evaluate(action);
        } catch (e) {
          error = e.message.split('\n')[0];
        }
        await new Promise((r) => setTimeout(r, 1500));
        console.log('DIAG', JSON.stringify({ name, headless, aliveBefore, aliveAfter: !closed, result, error }));
        if (!closed) await context.close();
      });
    }
  }
});
