import { test, expect } from './fixtures.mjs';

// Experiment only (not for main): how often a page picture never comes back,
// under the launch settings named by STRESS_HEADED and STRESS_ARGS. Each run
// opens a window of four pages, visits each (Tab Mission pictures it), waits
// for the follow-ups, and counts what the worker's console says about each
// capture (fixtures.mjs records "asked", "came back" and "failed").
test.use({
  headless: !process.env.STRESS_HEADED,
  launchArgs: JSON.parse(process.env.STRESS_ARGS || '[]'),
});

// No tests unless STRESS_RUNS is set, so the regular runs are unchanged.
const RUNS = Number(process.env.STRESS_RUNS || 0);

// Which rendering path this setting takes (chrome://gpu), once per job.
if (RUNS) test('gpu status', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('chrome://gpu');
  await page.waitForFunction(() => document.querySelector('info-view')?.shadowRoot?.textContent.includes('Graphics Feature Status'));
  const text = await page.evaluate(() => document.querySelector('info-view').shadowRoot.textContent.replace(/\s+/g, ' '));
  const status = text.match(/Graphics Feature Status(.*?)(Version Information|Driver Bug Workarounds)/)?.[1].trim();
  const backend = text.match(/Skia Backend\s*\S+/)?.[0] ?? text.match(/GraphiteDawn\w*|GaneshGL|GaneshVulkan/)?.[0];
  console.log(`GPU ${JSON.stringify({ status, backend, angle: text.match(/GL_RENDERER\s*[^\n]{0,120}/)?.[0] })}`);
});
for (let run = 0; run < RUNS; run++) {
  test(`capture stress ${run}`, async ({ ext, swConsole, context }) => {
    const { tabIds } = await ext.openWindow(['alpha', 'beta', 'gamma', 'red']);
    // STRESS_ANIM: a 2 px dot spinning in a corner of each page, so the
    // page keeps drawing new frames (a static page draws none).
    if (process.env.STRESS_ANIM) {
      for (const p of context.pages().filter((x) => x.url().startsWith('http'))) {
        await p.addStyleTag({ content: '@keyframes tm-spin{to{transform:rotate(360deg)}}body::after{content:"";position:fixed;right:3px;bottom:3px;width:2px;height:2px;background:#888;animation:tm-spin 1s linear infinite}' });
      }
    }
    // Each tab in front long enough to be pictured (a quick run of switches
    // takes one picture), then the last one's first follow-up.
    await ext.sw.evaluate(async (ids) => {
      for (const id of ids) {
        await chrome.tabs.update(id, { active: true });
        await new Promise((r) => setTimeout(r, 1200));
      }
    }, Object.values(tabIds));
    await new Promise((r) => setTimeout(r, 3500));
    const pictured = await ext.sw.evaluate((ids) => Promise.all(ids.map((id) =>
      chrome.storage.local.get(`cover:${id}`).then((r) => Boolean(r[`cover:${id}`])))), Object.values(tabIds));
    const count = (re) => swConsole.filter((l) => re.test(l)).length;
    // How long each answered capture took: asked and came back, in order.
    const ms = (l) => { const [h, m, sec] = l.match(/(\d\d):(\d\d):(\d\d\.\d+)/).slice(1).map(Number); return ((h * 60 + m) * 60 + sec) * 1000; };
    const asked = [];
    const took = [];
    for (const l of swConsole) {
      if (/ asked$/.test(l)) asked.push(ms(l));
      else if (/came back/.test(l) && asked.length) took.push(Math.round(ms(l) - asked.shift()));
    }
    const result = {
      asked: count(/capture of window \d+ asked/),
      back: count(/came back/),
      failed: count(/capture of window \d+ failed/),
      noAnswer: count(/no answer within/),
      pictured: pictured.filter(Boolean).length,
      tabs: pictured.length,
      took,
    };
    console.log(`STRESS ${JSON.stringify(result)}`);
    test.info().annotations.push({ type: 'stress', description: JSON.stringify(result) });
    expect(result.asked).toBeGreaterThan(0);
  });
}
