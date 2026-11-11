import { test, expect, PAGES, tileTitles, selectedTitle, pointAt, contrasts } from './fixtures.mjs';

const { alpha, beta, gamma } = PAGES;

test('opens with the search focused and the previous tab first and selected', async ({ ext }) => {
  await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  await expect(page.locator('#search')).toBeFocused();
  expect(await tileTitles(page)).toEqual([beta.title, gamma.title, alpha.title]);
  expect(await selectedTitle(page)).toBe(beta.title);
});

// Screen readers get a name for the search box (the placeholder only says
// what it searches) and hear what the toolbar badge's keys are.
test('the search box and the shortcut badge have names for screen readers', async ({ ext }) => {
  await ext.openWindow(['alpha', 'beta']);
  const page = await ext.open();
  // In the browser's own language, as the user hears it.
  const message = (key) => page.evaluate((k) => chrome.i18n.getMessage(k), key);
  await expect(page.locator('#search')).toHaveAccessibleName(await message('searchLabel'));
  const keys = process.platform === 'darwin' ? '⌘E' : 'Ctrl + Shift + E';
  await expect(page.locator('#shortcut-hint kbd')).toHaveText(keys);
  await expect(page.locator('#shortcut-hint')).toHaveText(`${await message('shortcutHintLabel')} ${keys}`);
  await expect(page.locator('#shortcut-hint .visually-hidden')).toHaveCSS('position', 'absolute');
});

test('→ moves the selection; typing pre-selects the best match; Enter switches', async ({ ext }) => {
  const { windowId } = await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  await page.keyboard.press('ArrowRight');
  expect(await selectedTitle(page)).toBe(gamma.title);
  await page.keyboard.type('alp');
  await expect(page.locator('#search')).toHaveValue('alp');
  await expect.poll(() => selectedTitle(page)).toBe(alpha.title);
  await ext.pressToClose(page, 'Enter');
  expect(await ext.activeTitle(windowId)).toBe(alpha.title);
});

test('loads a relative og:image and serves it from the session cache on reopen', async ({ ext }) => {
  // alpha is in front only for a moment (not first, as the window's first
  // tab is in front while the pages load), so it gets no picture of its own
  // (covers.js) and its card shows the page's image.
  const { tabIds } = await ext.openWindow(['beta', 'alpha', 'gamma']);
  let page = await ext.open();
  await expect(page.locator('img.thumbnail.loaded[data-from$="/img/alpha.svg"]')).toHaveCount(1);
  await ext.pressToClose(page, 'Escape');
  const cached = await ext.sw.evaluate(() => chrome.storage.session.get('previewCache').then(({ previewCache }) =>
    Object.values(previewCache || {}).some((e) => e.img?.endsWith('/img/alpha.svg'))));
  expect(cached).toBe(true);
  // The page no longer names its image, so only the cache can show it.
  await ext.sw.evaluate((tabId) => chrome.scripting.executeScript({
    target: { tabId },
    func: () => document.querySelectorAll('meta[property^="og:"], meta[name^="twitter:"], link[rel="image_src"]').forEach((el) => el.remove()),
  }), tabIds.alpha);
  page = await ext.open();
  await expect(page.locator('img.thumbnail.loaded[data-from$="/img/alpha.svg"]')).toHaveCount(1);
});

// Sleeping tabs are covered by the unit tests (applyFilters, isSleeping):
// chrome.tabs.discard brings down Playwright's Chromium 153 right after it
// succeeds, so the end-to-end suite never discards a tab.
test('a query searches other windows and dims the toggles, which stay readable', async ({ ext }) => {
  await ext.openWindow(['doc1', 'notes1']);
  await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  expect(await tileTitles(page)).not.toContain(PAGES.doc1.title);
  // One toggle on and one off, so both looks are checked.
  await page.locator('#toggle-sleeping').check();
  await page.keyboard.type('q4 plan');
  await expect(page.locator('.tile .title')).toHaveText([PAGES.doc1.title]);
  await expect(page.locator('.toolbar')).toHaveClass(/searching/);
  // The ticked box grey, not the accent: the toggles do not apply to a
  // query. (Both colors resolved, as a custom property reads as written.)
  const colors = await page.evaluate(() => {
    const resolved = (token) => {
      const probe = document.createElement('div');
      probe.style.background = `var(${token})`;
      document.body.append(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    };
    return { box: getComputedStyle(document.getElementById('toggle-sleeping')).backgroundColor, muted: resolved('--muted'), accent: resolved('--accent') };
  });
  expect(colors.box).toBe(colors.muted);
  expect(colors.box).not.toBe(colors.accent);
  // Still controls that work, so their text keeps 4.5:1 (WCAG 1.4.3).
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    // Their colors slide to grey, and to the new appearance's.
    await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('.ctrl, .ctrl *')].some((el) => el.getAnimations().length))).toBe(false);
    const ratios = await contrasts(page, ['.ctrl:has(#toggle-all-windows) span', '.ctrl:has(#toggle-sleeping) span']);
    for (const [selector, ratio] of Object.entries(ratios)) {
      expect(ratio, `${selector} in ${colorScheme}`).toBeGreaterThanOrEqual(4.5);
    }
  }
  // Windows high contrast sets every color: the system's color for inactive
  // text tells the toggles apart from the search text.
  await page.emulateMedia({ colorScheme: 'light', forcedColors: 'active' });
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('.ctrl, .ctrl *')].some((el) => el.getAnimations().length))).toBe(false);
  const forced = await page.evaluate(() => [getComputedStyle(document.querySelector('.ctrl')).color, getComputedStyle(document.getElementById('search')).color]);
  expect(forced[0]).not.toBe(forced[1]);
});

// No hover text where a control's own words say it all (Apple's guidelines:
// avoid repeating a control's name in its tooltip). Icon-only buttons keep
// theirs: it is their name.
test('the checkboxes and the site button have no hover text; icon-only buttons do', async ({ ext }) => {
  await ext.openWindow(['tube1', 'tube2']);
  const page = await ext.open();
  await expect(page.locator('#scope-hint')).toBeVisible();
  const titles = await page.evaluate(() => [...document.querySelectorAll('.toolbar-toggles label, #scope-hint')].map((el) => el.title));
  expect(titles).toEqual(['', '', '']);
  for (const id of ['#open-settings', '#reset-window']) await expect(page.locator(id)).toHaveAttribute('title', /\S/);
});

test('all windows never lists the overview; erasing the query returns to the previous tab', async ({ ext }) => {
  await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  await page.keyboard.type('alp');
  await expect.poll(() => selectedTitle(page)).toBe(alpha.title);
  await page.locator('#search').fill('');
  await expect.poll(() => selectedTitle(page)).toBe(beta.title);
  await page.locator('#toggle-all-windows').click();
  await expect(page.locator('#search')).toBeFocused();
  // The other windows are listed (the welcome page's), the overview's not.
  const [welcomeTabId, overviewTabId] = await ext.sw.evaluate(() => Promise.all(['welcome.html', 'overview.html*'].map((page) =>
    chrome.tabs.query({ url: chrome.runtime.getURL(page) }).then((t) => t[0].id))));
  await expect(page.locator(`.tile[data-tab-id="${welcomeTabId}"]`)).toHaveCount(1);
  await expect(page.locator(`.tile[data-tab-id="${overviewTabId}"]`)).toHaveCount(0);
});

test('× and middle-click close tabs', async ({ ext }) => {
  const { tabIds } = await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  await pointAt(page, page.locator(`.tile[data-tab-id="${tabIds.alpha}"]`));
  await page.locator(`.tile[data-tab-id="${tabIds.alpha}"] .tile-close`).click();
  await expect(page.locator('.tile')).toHaveCount(2);
  await page.locator(`.tile[data-tab-id="${tabIds.beta}"]`).click({ button: 'middle' });
  await expect(page.locator('.tile')).toHaveCount(1);
  const open = await ext.sw.evaluate((ids) => chrome.tabs.query({}).then((t) => ids.filter((id) => t.some((x) => x.id === id))), [tabIds.alpha, tabIds.beta]);
  expect(open).toEqual([]);
});

// The × shows only on the selected card, and only there can it be clicked
// (as in Chrome's Tab Search). The window opens under a resting pointer, so a
// click on the corner of a card the pointer has not selected yet switches to
// that tab instead of closing it unseen.
test('a click where an unselected card hides its × switches to the tab, never closes it', async ({ ext }) => {
  const { windowId, tabIds } = await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  const card = page.locator(`.tile[data-tab-id="${tabIds.alpha}"]`);
  await expect(card).not.toHaveClass(/selected/);
  await page.locator('#grid:not(.entering)').waitFor(); // the card rests where the click goes
  const box = await card.locator('.tile-close').boundingBox();
  // One move and the click: too little movement for the pointer to take over.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => {});
  await ext.expectClosed();
  expect(await ext.activeTitle(windowId)).toBe(alpha.title);
});

test('Esc clears the query first, then closes without switching', async ({ ext }) => {
  const { windowId } = await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  await page.keyboard.type('alp');
  await page.keyboard.press('Escape');
  await expect(page.locator('#search')).toHaveValue('');
  // Closing starts in the key's own handler (closeOverview marks #root).
  await expect(page.locator('#root')).not.toHaveClass(/closing/);
  expect(ext.overviewPages()).toHaveLength(1);
  await ext.pressToClose(page, 'Escape');
  expect(await ext.activeTitle(windowId)).toBe(gamma.title);
});

test('the toolbar button opens Tab Mission; clicked again, it fades out as for the shortcut, without switching', async ({ ext, context }) => {
  const { windowId } = await ext.openWindow(['alpha', 'beta', 'gamma']);
  const opened = context.waitForEvent('page', (p) => p.url().includes('/overview.html'));
  await ext.clickToolbarButton();
  const page = await opened;
  await page.locator('#grid .tile').first().waitFor();
  // The window closes 150 ms after the fade starts: too short to poll for
  // on a busy machine (it was missed on macOS CI). The page notes it the
  // moment it starts, in storage that outlives the page.
  await page.evaluate(() => {
    const root = document.getElementById('root');
    new MutationObserver(() => {
      if (root.classList.contains('closing')) chrome.storage.session.set({ fadeSeen: true });
    }).observe(root, { attributes: true, attributeFilter: ['class'] });
  });
  await ext.clickToolbarButton();
  await ext.expectClosed();
  await expect.poll(() => ext.sw.evaluate(() => chrome.storage.session.get('fadeSeen').then((r) => r.fadeSeen))).toBe(true);
  expect(await ext.activeTitle(windowId)).toBe(gamma.title);
});

test('a page\'s image is requested without the site\'s cookies or a referrer', async ({ ext }) => {
  // The cookie page (not first, so it gets no picture of its own) sets a
  // cookie for its site; its image comes from the same site.
  await ext.openWindow(['beta', 'cookie', 'gamma']);
  const page = await ext.open();
  await expect(page.locator('img.thumbnail.loaded[data-from$="/img/cookie-wide.svg"]')).toHaveCount(1);
  const seen = await page.evaluate((url) => fetch(url).then((r) => r.json()), ext.url('seen').replace('/seen.html', '/seen'));
  // Every request for it (the page itself does not load it).
  expect(seen.length).toBeGreaterThan(0);
  for (const request of seen) expect(request).toEqual({ cookie: null, referer: null });
});

// A page cannot make Tab Mission send requests into the user's computer or
// network: an image it names on a local host is not fetched unless the page
// is on that host (alpha, on localhost, names its own image in the tests
// above).
test('a page\'s image on a local address is not fetched for a page on another host', async ({ ext }) => {
  // code1 and code2 (on code.test) are passed over, so they get no picture.
  const { tabIds } = await ext.openWindow(['beta', 'code1', 'code2', 'gamma']);
  const { port } = new URL(ext.url('beta'));
  const local = `http://localhost:${port}/img/lan-wide.svg`;
  // The same image under a public name, which this browser also resolves to
  // the test server: the check reads the address as written, not where it
  // leads.
  const named = `http://img.test:${port}/img/lan-wide.svg`;
  for (const [tabId, src] of [[tabIds.code1, local], [tabIds.code2, named]]) {
    await ext.sw.evaluate(({ tabId, src }) => chrome.scripting.executeScript({
      target: { tabId },
      func: (content) => {
        const meta = document.createElement('meta');
        meta.setAttribute('property', 'og:image');
        meta.content = content;
        document.head.append(meta);
      },
      args: [src],
    }), { tabId, src });
  }
  const page = await ext.open();
  const img = (tabId) => page.locator(`.tile[data-tab-id="${tabId}"] img.thumbnail`);
  await expect(img(tabIds.code2)).toHaveAttribute('data-from', named);
  await expect(img(tabIds.code2)).toHaveClass(/\bloaded\b/);
  await expect(img(tabIds.code1)).toHaveAttribute('data-from', local);
  // Remembered as a miss: its card keeps the icon card.
  await expect.poll(() => ext.sw.evaluate((id) => chrome.storage.session.get('previewCache')
    .then((r) => r.previewCache?.[id]?.img), String(tabIds.code1))).toBe(null);
  await expect(img(tabIds.code1)).toBeHidden();
  await expect(img(tabIds.code1)).not.toHaveClass(/\bloaded\b/);
});

test('clicking × again where it was closes the next tab too, as on Chrome\'s tab strip', async ({ ext }) => {
  const { tabIds } = await ext.openWindow(['alpha', 'beta', 'gamma', 'tube1']);
  const page = await ext.open();
  await page.locator('#grid:not(.entering)').waitFor(); // the cards rest where the clicks go
  const card = page.locator('.tile').nth(1);
  await pointAt(page, card); // selects it, so its × shows
  await expect(card).toHaveClass(/selected/);
  const box = await card.locator('.tile-close').boundingBox();
  // Two quick clicks in one place, the second once the next card has moved
  // under the pointer (the browser counts it as a double click).
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ clickCount: 1 });
  await page.mouse.up({ clickCount: 1 });
  await expect(page.locator('.tile')).toHaveCount(3);
  await expect(page.locator('.tile.selected .tile-close')).toBeVisible();
  await page.mouse.down({ clickCount: 2 });
  await page.mouse.up({ clickCount: 2 });
  await expect(page.locator('.tile')).toHaveCount(2);
  const open = await ext.sw.evaluate((ids) => chrome.tabs.query({}).then((t) => ids.filter((id) => t.some((x) => x.id === id)).length), Object.values(tabIds));
  expect(open).toBe(2);
});
