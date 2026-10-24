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
  test(`capture stress ${run}`, async ({ ext, swConsole }) => {
    const { tabIds } = await ext.openWindow(['alpha', 'beta', 'gamma', 'red']);
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
    const result = {
      asked: count(/capture of window \d+ asked/),
      back: count(/came back/),
      failed: count(/capture of window \d+ failed/),
      noAnswer: count(/no answer within/),
      pictured: pictured.filter(Boolean).length,
      tabs: pictured.length,
    };
    console.log(`STRESS ${JSON.stringify(result)}`);
    test.info().annotations.push({ type: 'stress', description: JSON.stringify(result) });
    expect(result.asked).toBeGreaterThan(0);
  });
}
