// Screenshots for review, not pixel assertions. CI uploads screens/ for each
// OS, so the overview can be checked on Windows and Linux from a Mac (also by
// a coding agent: gh run download <run> -n screens-windows-latest).
// Screens: a 1920 x 1080 laptop with a 48 px (scaled) taskbar at 100%, 125% and 150%
// display scaling, scrollbars drawn as the OS draws them.
import { mkdirSync, writeFileSync } from 'node:fs';
import { test, expect } from './fixtures.mjs';

const OUT = 'screens';
const TABS = ['alpha', 'tube1', 'code1', 'notes1', 'doc1', 'tube2', 'code2', 'notes2', 'beta', 'gamma', 'tube3',
  ...Array.from({ length: 13 }, (_, i) => `beta?n=${i}`)];

for (const scale of [1, 1.25, 1.5]) {
  test.describe(`at ${scale * 100}% scaling`, () => {
    test.use({
      launchArgs: [`--screen-info={1920x1080 workAreaBottom=${48 * scale}}`, `--force-device-scale-factor=${scale}`],
      showScrollbars: true,
    });

    test(`overview, search, site view and pages at ${scale * 100}%`, async ({ ext, context }) => {
      mkdirSync(OUT, { recursive: true });
      const name = (what) => `${OUT}/${process.platform}-${scale * 100}-${what}.png`;
      await ext.openWindow(TABS);
      const page = await ext.open();
      await page.waitForTimeout(800); // entrance animation and previews

      const info = await ext.sw.evaluate(async () => ({
        displays: (await chrome.system.display.getInfo()).map((d) => ({ bounds: d.bounds, workArea: d.workArea })),
        overview: (await chrome.windows.getAll({ windowTypes: ['popup'] })).map(({ left, top, width, height }) => ({ left, top, width, height })),
        shortcut: (await chrome.commands.getAll()).find((c) => c.name === 'open-overview')?.shortcut,
      }));
      writeFileSync(`${OUT}/${process.platform}-${scale * 100}-info.json`, JSON.stringify(info, null, 2));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

      await page.screenshot({ path: name('overview') });
      await page.keyboard.type('tube');
      await page.screenshot({ path: name('search') });
      await page.locator('#search').fill('');
      await page.keyboard.press('Tab');
      await page.screenshot({ path: name('site-view') });
      await page.keyboard.press('Escape');
      await ext.welcome.screenshot({ path: name('welcome'), fullPage: true });
      const options = await context.newPage();
      await options.goto(`chrome-extension://${new URL(ext.sw.url()).host}/options.html`);
      await options.screenshot({ path: name('options'), fullPage: true });
    });
  });
}
