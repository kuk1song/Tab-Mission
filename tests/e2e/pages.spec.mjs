import { test, expect } from './fixtures.mjs';

// Chrome only auto-assigns a suggested key that none of its own shortcuts
// use: Ctrl+E is Chrome's "search" key on Windows, Linux and ChromeOS, so the
// default there is Ctrl+Shift+E. Runs on every OS in CI.
test('the default shortcut is assigned on this OS and shown on the welcome page', async ({ ext }) => {
  const shortcut = await ext.sw.evaluate(() => chrome.commands.getAll().then((c) => c.find((x) => x.name === 'open-overview')?.shortcut || ''));
  expect(shortcut).toBe(process.platform === 'darwin' ? '⌘E' : 'Ctrl+Shift+E');
  await expect(ext.welcome.locator('#lead kbd')).toBeVisible();
  await expect(ext.welcome.locator('#no-shortcut')).toBeHidden();
  await expect(ext.welcome.locator('#tip-site kbd')).toHaveText('Tab');
});

test('commands: localized descriptions; the site command has no default key', async ({ ext }) => {
  const commands = await ext.sw.evaluate(() => chrome.commands.getAll());
  const byName = Object.fromEntries(commands.map((c) => [c.name, c]));
  expect(byName['open-overview'].description).not.toContain('__MSG');
  expect(byName['open-overview-site'].description).not.toContain('__MSG');
  expect(byName['open-overview-site'].shortcut).toBe('');
});

const DEFAULT_KEYS = process.platform === 'darwin' ? ['⌘', 'E'] : ['Ctrl', 'Shift', 'E'];

async function openOptions(ext, context, setup) {
  const page = await context.newPage();
  if (setup) await page.addInitScript(setup);
  await page.goto(`chrome-extension://${new URL(ext.sw.url()).host}/options.html`);
  await expect(page.locator('#shortcuts .row')).toHaveCount(1);
  return { page, row: page.locator('#shortcuts .row') };
}

// The main shortcut only: the optional site shortcut has no default and
// stays on Chrome's shortcuts page.
test('options page: the shortcut with its keys, a switch that saves at once, the version and links', async ({ ext, context }) => {
  const { page, row } = await openOptions(ext, context);
  await expect(row.locator('#command-open-overview')).toBeVisible();
  await expect(row.locator('kbd.combo > kbd')).toHaveText(DEFAULT_KEYS);
  await expect(row.locator('button')).toHaveClass('external');

  const toggle = page.locator('#preselect-previous');
  await expect(toggle).toHaveAttribute('role', 'switch');
  await expect(toggle).toBeChecked();
  await page.locator('label[for="preselect-previous"]').click();
  await expect(toggle).not.toBeChecked();
  await expect(page.locator('#saved')).not.toBeEmpty();
  const saved = await ext.sw.evaluate(() => chrome.storage.local.get('preselectPrevious'));
  expect(saved.preselectPrevious).toBe(false);

  const version = await ext.sw.evaluate(() => chrome.runtime.getManifest().version);
  await expect(page.locator('#version')).toContainText(version);
  await expect(page.locator('.about a')).toHaveCount(3);
  await expect(page.locator('#link-privacy')).toHaveAttribute('href', 'https://github.com/kuk1song/Tab-Mission/blob/main/PRIVACY.md');
  await expect(page.locator('#link-review')).toHaveAttribute('href', 'https://chromewebstore.google.com/detail/hhnkkpdkfhjlmlanebphmmhgkhinijca/reviews');
  await expect(page.locator('#link-feedback')).toHaveAttribute('href', 'https://github.com/kuk1song/Tab-Mission/issues');
});

// As when another extension already owned the key at install.
test('options page: without a shortcut, the row says so and Add stands out', async ({ ext, context }) => {
  const { row } = await openOptions(ext, context, () => {
    const getAll = chrome.commands.getAll.bind(chrome.commands);
    chrome.commands.getAll = async () => (await getAll()).map((c) => ({ ...c, shortcut: '' }));
  });
  await expect(row.locator('kbd')).toHaveCount(0);
  await expect(row.locator('.unset')).toBeVisible();
  await expect(row.locator('button')).toHaveClass('external primary');
});

test("options page: the shortcut button opens Chrome's shortcuts page", async ({ ext, context }) => {
  const { row } = await openOptions(ext, context);
  const opened = context.waitForEvent('page', (p) => p.url().startsWith('chrome://extensions/shortcuts'));
  await row.locator('button').click();
  await (await opened).close();
});

// Contrast of each text against what is painted behind it (the page color
// with any translucent surfaces on top; the dark gradient's lightest stop is
// close to the page color), in both appearances and at phone width.
async function contrasts(page, selectors) {
  return page.evaluate((selectors) => {
    const rgba = (s) => (s.match(/[\d.]+/g) || []).map(Number);
    const over = (top, bottom) => {
      const a = top[3] ?? 1;
      return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a));
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
      const layers = [];
      for (let node = el; node; node = node.parentElement) layers.push(rgba(getComputedStyle(node).backgroundColor));
      let behind = [255, 255, 255];
      for (const layer of layers.reverse()) if (layer.length) behind = over(layer, behind);
      const [fg, bg] = [luminance(over(rgba(getComputedStyle(el).color), behind)), luminance(behind)];
      result[selector] = Math.round(((Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05)) * 10) / 10;
    }
    return result;
  }, selectors);
}

test('options and welcome pages follow the system appearance, stay readable and never scroll sideways', async ({ ext, context }) => {
  const { page } = await openOptions(ext, context);
  const pages = [
    [page, ['h1', '.title', '.desc', '.foot', 'h2', '#version', '#link-privacy']],
    [ext.welcome, ['h1', '.lead', '.tips li', '.note', 'h2']],
  ];
  for (const [p, selectors] of pages) {
    const backgrounds = {};
    for (const colorScheme of ['light', 'dark']) {
      await p.emulateMedia({ colorScheme });
      backgrounds[colorScheme] = await p.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
      const ratios = await contrasts(p, selectors);
      for (const [selector, ratio] of Object.entries(ratios)) {
        expect(ratio, `${selector} in ${colorScheme} on ${p.url()}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(backgrounds.light).not.toBe(backgrounds.dark);
    await p.setViewportSize({ width: 320, height: 640 });
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
});

test('the gear in the overview opens the options page', async ({ ext, context }) => {
  await ext.openWindow(['alpha', 'beta']);
  const page = await ext.open();
  const opened = context.waitForEvent('page', (p) => p.url().endsWith('/options.html'));
  await page.locator('#open-settings').click();
  const options = await opened;
  await ext.expectClosed();
  await options.close();
});
