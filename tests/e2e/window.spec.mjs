import { test, expect, PAGES, selectedTitle } from './fixtures.mjs';

test('by default nothing is selected and the shortcut pressed twice closes', async ({ ext }) => {
  const { windowId } = await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  expect(await selectedTitle(page)).toBeNull();
  await ext.press();
  await ext.expectClosed();
  expect(await ext.activeTitle(windowId)).toBe(PAGES.gamma.title);
});

test('hover a tile and press the shortcut to switch to it', async ({ ext }) => {
  const { windowId } = await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  await page.locator('.tile').nth(2).hover();
  expect(await selectedTitle(page)).toBe(PAGES.alpha.title);
  await ext.press();
  await ext.expectClosed();
  expect(await ext.activeTitle(windowId)).toBe(PAGES.alpha.title);
});

test('with "pre-select the previous tab" on, pressing the shortcut twice goes back', async ({ ext }) => {
  await ext.sw.evaluate(() => chrome.storage.local.set({ preselectPrevious: true }));
  const { windowId } = await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  expect(await selectedTitle(page)).toBe(PAGES.beta.title);
  await ext.press();
  await ext.expectClosed();
  expect(await ext.activeTitle(windowId)).toBe(PAGES.beta.title);
});

test('two presses in a row open exactly one overview', async ({ ext }) => {
  await ext.openWindow(['alpha', 'beta']);
  await ext.welcome.evaluate(() => {
    chrome.runtime.sendMessage({ action: 'openOverview' }).catch(() => {});
    chrome.runtime.sendMessage({ action: 'openOverview' }).catch(() => {});
  });
  await expect.poll(() => ext.overviewPages().length).toBe(1);
  await expect.poll(() => ext.popupCount(), { timeout: 2_000 }).toBe(1);
});

test('a window id left from an earlier browser session never closes a user window', async ({ ext }) => {
  const { windowId } = await ext.openWindow(['alpha', 'beta']);
  // As if Chrome had reused the id of an overview from a previous session.
  await ext.sw.evaluate((id) => Promise.all([
    chrome.storage.session.set({ overviewWindowId: id }),
    chrome.storage.local.set({ overviewWindowId: id }),
  ]), windowId);
  await ext.open();
  const alive = await ext.sw.evaluate((id) => chrome.windows.get(id).then(() => true, () => false), windowId);
  expect(alive).toBe(true);
  await ext.press();
  await ext.expectClosed();
});

test('the overview remembers its size and position', async ({ ext }) => {
  await ext.openWindow(['alpha', 'beta']);
  const page = await ext.open();
  // Bounds inside the display's work area, which the restore clamps to.
  const target = await ext.sw.evaluate(async () => {
    const [{ workArea: a }] = await chrome.system.display.getInfo();
    return { width: Math.round(a.width * 0.7), height: Math.round(a.height * 0.7), left: a.left + 10, top: a.top + 10 };
  });
  const popup = () => ext.sw.evaluate(() => chrome.windows.getAll({ windowTypes: ['popup'] }).then((w) => w[0]));
  await ext.sw.evaluate(({ id, b }) => chrome.windows.update(id, b), { id: (await popup()).id, b: target });
  await expect.poll(() => ext.sw.evaluate(() => chrome.storage.local.get('overviewBounds').then((r) => r.overviewBounds?.width))).toBe(target.width);
  await ext.pressToClose(page, 'Escape');
  await ext.open();
  const { width, height } = await popup();
  expect({ width, height }).toEqual({ width: target.width, height: target.height });
});

// Chrome stops an idle service worker after about 30 seconds; the next press
// must find the open overview again (its id is kept in session storage).
test('after the service worker restarts, the shortcut still acts on the open overview', async ({ ext, context }) => {
  await ext.openWindow(['alpha', 'beta']);
  const page = await ext.open();
  const cdp = await context.newCDPSession(page);
  const { targetInfos } = await cdp.send('Target.getTargets');
  const worker = targetInfos.find((t) => t.type === 'service_worker' && t.url.endsWith('/background.js'));
  await cdp.send('Target.closeTarget', { targetId: worker.targetId });
  await expect.poll(async () => (await cdp.send('Target.getTargets')).targetInfos
    .some((t) => t.targetId === worker.targetId)).toBe(false);
  await ext.press();
  await ext.expectClosed();
  const popups = await ext.welcome.evaluate(() => chrome.windows.getAll({ windowTypes: ['popup'] }).then((w) => w.length));
  expect(popups).toBe(0);
});

// The keyboard path itself: Chrome matches the key against the extension's
// command and fires chrome.commands.onCommand. (Not covered: the operating
// system delivering the key to Chrome, which needs a real focused window.)
test('the real default shortcut opens the overview, and pressed again closes it', async ({ ext, context }) => {
  await ext.openWindow(['alpha', 'beta']);
  await ext.sw.evaluate(() => {
    self.__commands = [];
    chrome.commands.onCommand.addListener((command) => self.__commands.push(command));
  });
  const page = context.pages().find((p) => p.url().includes('/beta.html'));

  // An unassigned combination does nothing.
  await ext.pressKeys(page, { key: 'y', code: 'KeyY', keyCode: 89, macKeyCode: 16, modifiers: 2 | 8 });
  await page.waitForTimeout(500);
  expect(await ext.sw.evaluate(() => self.__commands)).toEqual([]);
  expect(ext.overviewPages()).toHaveLength(0);

  const opened = context.waitForEvent('page', (p) => p.url().includes('/overview.html'));
  await ext.pressDefaultShortcut(page);
  const overview = await opened;
  expect(await ext.sw.evaluate(() => self.__commands)).toEqual(['open-overview']);
  await overview.locator('#grid .tile').first().waitFor();

  // Pressed in the overview with nothing selected, it closes.
  await ext.pressDefaultShortcut(overview);
  await ext.expectClosed();
  expect(await ext.sw.evaluate(() => self.__commands)).toEqual(['open-overview', 'open-overview']);
});
