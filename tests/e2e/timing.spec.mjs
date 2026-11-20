// Opening times for review, not a speed limit. CI uploads screens/ for each
// OS: <platform>-timing-<way>.json says, for each way of opening with the
// cards spread out, how long after the real shortcut the overview's page
// began to load, first painted, and let its entrance go. The backdrop is a
// new user's (the blurred page; the file says what the overview showed: a
// machine that asks for less transparency keeps the plain one).
// CI machines mostly draw without a graphics card (the file names the
// renderer): compare a system with its own earlier runs, not with a user's
// machine.
import { mkdirSync, writeFileSync } from 'node:fs';
import { test, expect } from './fixtures.mjs';

const OUT = 'screens';
const RUNS = 7;
// Visited in this order, so each has its picture; the last is in front.
const TABS = ['alpha', 'tube1', 'code1', 'notes1', 'doc1', 'tube2', 'code2', 'notes2', 'beta', 'tube3', 'beta?n=1', 'gamma'];

const summary = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { median: sorted[Math.floor(sorted.length / 2)], min: sorted[0], max: sorted.at(-1) };
};

for (const openAs of ['window', 'page']) {
  test(`records how long opening takes, as "${openAs}"`, async ({ ext, context }) => {
    test.setTimeout(120_000);
    const { tabIds } = await ext.openWindow(TABS);
    await ext.sw.evaluate(async (openAs) => {
      await chrome.storage.local.remove('backdrop');
      await chrome.storage.local.set({ spread: true, openAs });
    }, openAs);
    for (const id of Object.values(tabIds)) {
      await ext.sw.evaluate((id) => chrome.tabs.update(id, { active: true }), id);
      await expect.poll(() => ext.sw.evaluate((key) => chrome.storage.local.get(key).then((stored) => key in stored), `cover:${id}`), { timeout: 15_000 }).toBe(true);
    }
    const front = context.pages().find((page) => new URL(page.url()).pathname === '/gamma.html');
    const frameOn = () => front.frames().find((frame) => frame.url().includes('/overlay.html'));

    const rows = [];
    let backdrop = null;
    for (let run = 0; run < RUNS; run++) {
      // Pictures are taken two a second at most (src/covers.js): each press
      // comes after the last one's turn has passed.
      await front.waitForTimeout(600);
      const opened = openAs === 'window' ? context.waitForEvent('page', (page) => page.url().includes('/overview.html')) : null;
      const pressed = await ext.pressDefaultShortcut(front);
      let target = await opened;
      if (!target) {
        await expect.poll(() => Boolean(frameOn())).toBe(true);
        target = frameOn();
      }
      await target.waitForFunction(() => performance.getEntriesByName('entrance').length > 0);
      const times = await target.evaluate(() => ({
        began: performance.timeOrigin,
        painted: performance.getEntriesByName('first-paint')[0]?.startTime ?? null,
        entrance: performance.getEntriesByName('entrance')[0].startTime,
      }));
      expect(Number.isFinite(times.began) && times.entrance >= 0).toBe(true);
      rows.push({
        load: Math.round(times.began - pressed),
        painted: times.painted === null ? null : Math.round(times.began + times.painted - pressed),
        entrance: Math.round(times.began + times.entrance - pressed),
      });
      await target.locator('#grid:not(.entering)').waitFor();
      backdrop = await target.evaluate(() => document.documentElement.dataset.backdrop ?? 'plain');
      if (openAs === 'window') {
        await target.close();
        await ext.expectClosed();
      } else {
        await target.evaluate(() => chrome.runtime.sendMessage({ action: 'closeOverlay' }).catch(() => {})).catch(() => {});
        await expect.poll(() => Boolean(frameOn())).toBe(false);
      }
    }
    expect(rows).toHaveLength(RUNS);

    const renderer = await ext.welcome.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl');
      const info = gl?.getExtension('WEBGL_debug_renderer_info');
      return gl ? String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : 'none';
    });
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/${process.platform}-timing-${openAs}.json`, JSON.stringify({
      what: 'milliseconds from the shortcut going down to: the overview page beginning to load, its first paint, its entrance let go',
      openAs, backdrop, tabs: TABS.length, runs: RUNS, renderer,
      load: summary(rows.map((row) => row.load)),
      painted: summary(rows.map((row) => row.painted).filter((value) => value !== null)),
      entrance: summary(rows.map((row) => row.entrance)),
      rows,
    }, null, 2));
  });
}
