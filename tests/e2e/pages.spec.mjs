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

test('options page: the switch saves and confirms, and every shortcut is listed', async ({ ext, context }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${new URL(ext.sw.url()).host}/options.html`);
  await expect(page.locator('#shortcuts > div')).toHaveCount(2);
  await page.locator('#preselect-previous').check();
  await expect(page.locator('#saved')).toBeVisible();
  const saved = await ext.sw.evaluate(() => chrome.storage.local.get('preselectPrevious'));
  expect(saved.preselectPrevious).toBe(true);
});

test('the gear in the overview opens the options page', async ({ ext, context }) => {
  await ext.openWindow(['alpha', 'beta']);
  const page = await ext.open();
  const options = context.waitForEvent('page', (p) => p.url().endsWith('/options.html'));
  await page.locator('#open-settings').click();
  await options;
  await ext.expectClosed();
});

// TEMPORARY A/B: remove with the experiments.
test('options page: the experiment switches save their choice', async ({ ext, context }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${new URL(ext.sw.url()).host}/options.html`);
  await expect(page.locator('#exp-window')).toHaveValue('display');
  await expect(page.locator('#exp-grid')).toHaveValue('standard');
  await page.locator('#exp-window').selectOption('browser');
  await page.locator('#exp-grid').selectOption('dense');
  await expect.poll(() => ext.sw.evaluate(() => chrome.storage.local.get(['experimentWindowSizing', 'experimentGrid'])))
    .toEqual({ experimentWindowSizing: 'browser', experimentGrid: 'dense' });
});
