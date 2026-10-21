import { test, expect, PAGES, tileTitles, selectedTitle, pointAt } from './fixtures.mjs';

test('by default the previous tab is selected, and the shortcut pressed twice goes back to it', async ({ ext }) => {
  const { windowId } = await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  expect(await selectedTitle(page)).toBe(PAGES.beta.title);
  await ext.press();
  await ext.expectClosed();
  expect(await ext.activeTitle(windowId)).toBe(PAGES.beta.title);
});

test('with "pre-select the previous tab" off, nothing is selected and the shortcut pressed twice closes', async ({ ext }) => {
  await ext.sw.evaluate(() => chrome.storage.local.set({ preselectPrevious: false }));
  const { windowId } = await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  expect(await selectedTitle(page)).toBeNull();
  await ext.press();
  await ext.expectClosed();
  expect(await ext.activeTitle(windowId)).toBe(PAGES.gamma.title);
});

test('the pre-selected tile enters at its resting size, so it does not change afterwards', async ({ ext }) => {
  await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  const sizes = await page.evaluate(() => {
    const tile = document.querySelector('.tile.selected');
    tile.getAnimations().forEach((a) => a.finish());
    const entered = tile.getBoundingClientRect().width;
    document.getElementById('grid').classList.remove('entering');
    return { entered, resting: tile.getBoundingClientRect().width };
  });
  expect(sizes.entered).toBeGreaterThan(0);
  expect(sizes.entered).toBe(sizes.resting);
});

test('point at a tile and press the shortcut to switch to it', async ({ ext }) => {
  const { windowId } = await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  await pointAt(page, page.locator('.tile').nth(2));
  expect(await selectedTitle(page)).toBe(PAGES.alpha.title);
  await expect(page.locator('.tile.selected')).toHaveCount(1);
  await ext.press();
  await ext.expectClosed();
  expect(await ext.activeTitle(windowId)).toBe(PAGES.alpha.title);
});

test('a pointer resting on a tile, or twitching, leaves the pre-selection alone', async ({ ext }) => {
  const { windowId } = await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  const box = await page.locator('.tile').nth(2).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width / 2 + 3, box.y + box.height / 2 + 2);
  expect(await selectedTitle(page)).toBe(PAGES.beta.title);
  await ext.press();
  await ext.expectClosed();
  expect(await ext.activeTitle(windowId)).toBe(PAGES.beta.title);
});

test('once the pointer has moved, leaving the tiles selects nothing and the shortcut closes', async ({ ext }) => {
  const { windowId } = await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  await pointAt(page, page.locator('.tile').nth(2));
  await pointAt(page, page.locator('#search'));
  expect(await selectedTitle(page)).toBeNull();
  await ext.press();
  await ext.expectClosed();
  expect(await ext.activeTitle(windowId)).toBe(PAGES.gamma.title);
});

test('a key hands the selection back to the keyboard', async ({ ext }) => {
  await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  const tile = page.locator('.tile').nth(2);
  await pointAt(page, tile);
  await page.keyboard.press('ArrowLeft');
  expect(await selectedTitle(page)).toBe(PAGES.gamma.title);
  const box = await tile.boundingBox();
  await page.mouse.move(box.x + box.width / 2 + 3, box.y + box.height / 2);
  expect(await selectedTitle(page)).toBe(PAGES.gamma.title);
});

test('two presses in a row open exactly one overview', async ({ ext, context }) => {
  await ext.openWindow(['alpha', 'beta']);
  await ext.sw.evaluate(() => {
    self.__popups = 0;
    chrome.windows.onCreated.addListener((win) => { if (win.type === 'popup') self.__popups++; });
  });
  const opened = context.waitForEvent('page', (p) => p.url().includes('/overview.html'));
  await ext.welcome.evaluate(() => {
    chrome.runtime.sendMessage({ action: 'openOverview' }).catch(() => {});
    chrome.runtime.sendMessage({ action: 'openOverview' }).catch(() => {});
  });
  const page = await opened;
  await page.locator('#grid .tile').first().waitFor();
  // By the time it shows its tiles, a second window would have been created,
  // and a second press handed to this one would switch tabs and close it.
  expect(await ext.sw.evaluate(() => self.__popups)).toBe(1);
  await expect(page.locator('#root')).not.toHaveClass(/closing/);
  expect(ext.overviewPages()).toHaveLength(1);
});

// The shortcut pressed twice quickly: the second press can come once the
// worker has opened the window but before its page listens. It acts once
// the page is ready, instead of closing the window without switching.
test('the shortcut pressed again while the window is still loading goes back', async ({ ext, context }) => {
  const { windowId } = await ext.openWindow(['alpha', 'beta']);
  const opened = context.waitForEvent('page', (p) => p.url().includes('/overview.html'));
  await ext.press();
  await opened;
  // Opened once the worker has stored its id (a press before then is
  // dropped, see the test above).
  await expect.poll(() => ext.sw.evaluate(() => chrome.storage.session.get('overviewWindowId').then((r) => r.overviewWindowId ?? null)), { intervals: [5] }).not.toBeNull();
  await ext.press();
  await ext.expectClosed();
  expect(await ext.activeTitle(windowId)).toBe(PAGES.alpha.title);
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
  const { left, top, width, height } = await popup();
  expect({ left, top, width, height }).toEqual(target);
});

// Chrome stops an idle service worker after about 30 seconds; the next press
// must find the open overview again (its id is kept in session storage).
test('after the service worker restarts, the shortcut still acts on the open overview', async ({ ext, context }) => {
  const { windowId } = await ext.openWindow(['alpha', 'beta']);
  const page = await ext.open();
  const cdp = await context.newCDPSession(page);
  const { targetInfos } = await cdp.send('Target.getTargets');
  const worker = targetInfos.find((t) => t.type === 'service_worker' && t.url.endsWith('/background.js'));
  await cdp.send('Target.closeTarget', { targetId: worker.targetId });
  await expect.poll(async () => (await cdp.send('Target.getTargets')).targetInfos
    .some((t) => t.targetId === worker.targetId)).toBe(false);
  await ext.press();
  await ext.expectClosed();
  // The overview itself took the press: it switched to the previous tab.
  // (Had the message not reached it, background.js would only have closed
  // its window.)
  expect(await ext.activeTitle(windowId)).toBe(PAGES.alpha.title);
  const popups = await ext.welcome.evaluate(() => chrome.windows.getAll({ windowTypes: ['popup'] }).then((w) => w.length));
  expect(popups).toBe(0);
});

// Left open behind another window, the overview would act on a press made
// in that window with its old window's tabs and pull you back; instead the
// press opens a fresh overview for the window in front. Only headed Chromium
// (Windows here) has real window focus: headless, every window reports focused.
test('the shortcut pressed in another window opens that window\'s overview instead of pulling you back', async ({ ext }) => {
  test.skip(process.platform !== 'win32', 'needs real window focus (headed Chromium on Windows)');
  const first = await ext.openWindow(['alpha', 'beta']);
  const second = await ext.openWindow(['gamma', 'doc1']);
  const old = await ext.open();
  expect(await tileTitles(old)).toContain(PAGES.gamma.title);
  await old.waitForTimeout(1100); // past the quick second press
  await ext.sw.evaluate((id) => chrome.windows.update(id, { focused: true }), first.windowId);
  await expect.poll(() => ext.sw.evaluate(() => chrome.windows.getLastFocused().then((w) => w.type))).toBe('normal');
  const fresh = await ext.open();
  await expect.poll(() => old.isClosed()).toBe(true);
  expect(await tileTitles(fresh)).toContain(PAGES.alpha.title);
  expect(await tileTitles(fresh)).not.toContain(PAGES.gamma.title);
  expect(await ext.activeTitle(second.windowId)).toBe(PAGES.doc1.title);
  expect(ext.overviewPages()).toHaveLength(1);
});

// The keyboard path itself: Chrome matches the key against the extension's
// command and fires chrome.commands.onCommand. (Not covered: the operating
// system delivering the key to Chrome, which needs a real focused window.)
test('the real default shortcut opens the overview, and pressed again goes back to the previous tab', async ({ ext, context }) => {
  const { windowId } = await ext.openWindow(['alpha', 'beta']);
  await ext.sw.evaluate(() => {
    self.__commands = [];
    chrome.commands.onCommand.addListener((command) => self.__commands.push(command));
  });
  const page = context.pages().find((p) => p.url().includes('/beta.html'));

  // An unassigned combination does nothing; keys are handled in order, so
  // by the time the shortcut pressed next has opened the overview, a command
  // from the first would have come.
  await ext.pressKeys(page, { key: 'y', code: 'KeyY', keyCode: 89, macKeyCode: 16, modifiers: 2 | 8 });
  const opened = context.waitForEvent('page', (p) => p.url().includes('/overview.html'));
  await ext.pressDefaultShortcut(page);
  const overview = await opened;
  expect(await ext.sw.evaluate(() => self.__commands)).toEqual(['open-overview']);
  expect(ext.overviewPages()).toHaveLength(1);
  await overview.locator('#grid .tile').first().waitFor();

  // Pressed in the overview, it switches to the pre-selected previous tab.
  await ext.pressDefaultShortcut(overview);
  await ext.expectClosed();
  expect(await ext.sw.evaluate(() => self.__commands)).toEqual(['open-overview', 'open-overview']);
  expect(await ext.activeTitle(windowId)).toBe(PAGES.alpha.title);
});

// Chrome gives a tab opened in the background the time it was opened as its
// lastAccessed, so it would pass for the tab you were on last.
test('a tab opened in the background is not the previous tab until you have been on it', async ({ ext }) => {
  const { windowId, tabIds } = await ext.openWindow(['alpha', 'beta']);
  const gamma = await ext.openTab(windowId, ext.url('gamma')); // from beta, say with a middle click
  let page = await ext.open();
  expect(await selectedTitle(page)).toBe(PAGES.alpha.title);
  await ext.press(); // pressed again: back to alpha
  await ext.expectClosed();
  expect(await ext.activeTitle(windowId)).toBe(PAGES.alpha.title);
  // Once you have been on gamma, it is like any other tab.
  await ext.sw.evaluate((id) => chrome.tabs.update(id, { active: true }), gamma);
  await expect.poll(() => ext.activeTitle(windowId)).toBe(PAGES.gamma.title);
  await ext.sw.evaluate((id) => chrome.tabs.update(id, { active: true }), tabIds.beta);
  await expect.poll(() => ext.activeTitle(windowId)).toBe(PAGES.beta.title);
  page = await ext.open();
  expect(await selectedTitle(page)).toBe(PAGES.gamma.title);
});
