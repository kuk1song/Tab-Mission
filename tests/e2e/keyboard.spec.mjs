import { test, expect, PAGES, pointAt, tileTitles, selectedTitle } from './fixtures.mjs';

test('typing never writes to storage; changing a toggle does', async ({ ext }) => {
  await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  await page.evaluate(() => {
    window.__writes = [];
    chrome.storage.onChanged.addListener((changes, area) => {
      // Page pictures (covers.js) may be stored at any moment; they are not
      // what typing could write.
      const picture = (key) => key === 'coverIndex' || /^cover:\d+$/.test(key);
      if (area === 'local') window.__writes.push(...Object.keys(changes).filter((key) => !picture(key)));
    });
  });
  await page.keyboard.type('page alpha');
  await expect(page.locator('.tile')).toHaveCount(1);
  await page.locator('#toggle-all-windows').click();
  await expect.poll(() => page.evaluate(() => window.__writes)).toContain('showAllWindows');
  // A write the typing set off would have come before the toggle's.
  expect((await page.evaluate(() => window.__writes)).filter((key) => key !== 'showAllWindows' && key !== 'showSleeping')).toEqual([]);
});

test('an Enter that commits an input method candidate does not switch tabs', async ({ ext }) => {
  const { windowId } = await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  await page.keyboard.type('alp');
  await expect(page.locator('.tile.selected')).toHaveCount(1);
  await page.locator('#search').dispatchEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true, bubbles: true });
  // A switch would start closing in the key's own handler (activateTab).
  await expect(page.locator('#root')).not.toHaveClass(/closing/);
  expect(ext.overviewPages()).toHaveLength(1);
  expect(await ext.activeTitle(windowId)).toBe(PAGES.gamma.title);
});

test('Enter on a focused toolbar button presses the button, not the selected tile', async ({ ext }) => {
  const { windowId } = await ext.openWindow(['alpha', 'beta', 'gamma']);
  // A saved size, which the reset button forgets first (background.js).
  await ext.sw.evaluate(() => chrome.storage.local.set({ overviewBounds: { width: 1000, height: 700 } }));
  const page = await ext.open();
  await page.keyboard.type('alp');
  await expect(page.locator('.tile.selected')).toHaveCount(1);
  await page.locator('#reset-window').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#root')).not.toHaveClass(/closing/);
  await expect.poll(() => ext.sw.evaluate(() => chrome.storage.local.get('overviewBounds').then((r) => r.overviewBounds))).toBe(null);
  expect(ext.overviewPages()).toHaveLength(1);
  expect(await ext.activeTitle(windowId)).toBe(PAGES.gamma.title);
});

test('Space toggles a focused checkbox; letters still go to the search box', async ({ ext }) => {
  await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  const toggle = page.locator('#toggle-sleeping');
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toBeChecked();
  await expect(page.locator('#search')).toHaveValue('');
  await toggle.focus();
  await page.keyboard.press('a');
  await expect(page.locator('#search')).toHaveValue('a');
  await expect(page.locator('#search')).toBeFocused();
});

test('× on a tab closed elsewhere drops its tile and gives focus back to the search box', async ({ ext }) => {
  const { tabIds } = await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  await ext.sw.evaluate((id) => chrome.tabs.remove(id), tabIds.alpha);
  // The × of the card under the pointer (only a selected card's × is there).
  await pointAt(page, page.locator(`.tile[data-tab-id="${tabIds.alpha}"]`));
  await page.locator(`.tile[data-tab-id="${tabIds.alpha}"] .tile-close`).click();
  await expect(page.locator(`.tile[data-tab-id="${tabIds.alpha}"]`)).toHaveCount(0);
  await expect(page.locator('#search')).toBeFocused();
});

// What the window asks Chrome to close (chrome.tabs.remove, called in the
// key's own handler), and each Delete and Backspace it saw: whether it was a
// repeat, and whether Tab Mission kept it from the search box. Watched after
// Tab Mission's own listener, so it sees what that did.
async function watchCloses(page) {
  await page.evaluate(() => {
    window.removed_ = [];
    const remove = chrome.tabs.remove.bind(chrome.tabs);
    chrome.tabs.remove = (id) => {
      window.removed_.push(id);
      return remove(id);
    };
    window.keys_ = [];
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') window.keys_.push({ key: e.key, repeat: e.repeat, prevented: e.defaultPrevented });
    });
  });
}
const watched = (page) => page.evaluate(() => ({ removed: window.removed_, keys: window.keys_ }));
const openTabIds = (ext) => ext.sw.evaluate(() => chrome.tabs.query({}).then((tabs) => tabs.map((t) => t.id)));

// Shift+Delete removes a highlighted suggestion in Chrome's address bar.
test('Shift+Delete closes the selected card, and the selection goes where a click on × leaves it', async ({ ext }) => {
  const { tube1, tube2, code1, gamma, beta, alpha } = PAGES;
  const { tabIds } = await ext.openWindow(['alpha', 'beta', 'gamma', 'code1', 'tube1', 'tube2']);
  const page = await ext.open();
  await watchCloses(page);
  expect(await tileTitles(page)).toEqual([tube1.title, tube2.title, code1.title, gamma.title, beta.title, alpha.title]);
  const message = (key, substitutions) => page.evaluate(([k, s]) => chrome.i18n.getMessage(k, s), [key, substitutions]);

  // The pre-selected previous tab: the tab you were on before it takes its
  // place, pre-selected in turn.
  await page.keyboard.press('Shift+Delete');
  await expect(page.locator(`.tile[data-tab-id="${tabIds.tube1}"]`)).toHaveCount(0);
  expect(await tileTitles(page)).toEqual([code1.title, tube2.title, gamma.title, beta.title, alpha.title]);
  expect(await selectedTitle(page)).toBe(code1.title);
  await expect(page.locator('#search')).toBeFocused();
  await expect(page.locator('#status')).toHaveText(await message('tabClosed', [tube1.title]));
  expect(await openTabIds(ext)).not.toContain(tabIds.tube1);

  // A card picked with the arrows: the card that takes its place.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  expect(await selectedTitle(page)).toBe(gamma.title);
  await page.keyboard.press('Shift+Delete');
  await expect(page.locator(`.tile[data-tab-id="${tabIds.gamma}"]`)).toHaveCount(0);
  expect(await selectedTitle(page)).toBe(beta.title);
  await expect(page.locator('#status')).toHaveText(await message('tabClosed', [gamma.title]));

  // The same as × clicked on a card in that place.
  await pointAt(page, page.locator(`.tile[data-tab-id="${tabIds.beta}"]`));
  await page.locator(`.tile[data-tab-id="${tabIds.beta}"] .tile-close`).click();
  await expect(page.locator(`.tile[data-tab-id="${tabIds.beta}"]`)).toHaveCount(0);
  expect(await selectedTitle(page)).toBe(alpha.title);
  await expect(page.locator('#status')).toHaveText(await message('tabClosed', [beta.title]));

  expect((await watched(page)).removed).toEqual([tabIds.tube1, tabIds.gamma, tabIds.beta]);
  expect(await openTabIds(ext)).toEqual(expect.arrayContaining([tabIds.code1, tabIds.tube2, tabIds.alpha]));
});

// Windows cuts text selected in a text box with Shift+Delete.
test('Shift+Delete leaves text selected in the search box to the box; with the caret in it, it closes', async ({ ext }) => {
  const { tabIds } = await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  await watchCloses(page);
  const search = page.locator('#search');
  await page.keyboard.type('page');
  await expect.poll(() => selectedTitle(page)).toBe(PAGES.beta.title);
  await search.evaluate((el) => el.select());
  await page.keyboard.press('Shift+Delete');
  expect(await watched(page)).toEqual({ removed: [], keys: [{ key: 'Delete', repeat: false, prevented: false }] });
  await expect(page.locator('.tile')).toHaveCount(3);

  await search.fill('page');
  await expect.poll(() => selectedTitle(page)).toBe(PAGES.beta.title);
  await search.evaluate((el) => el.setSelectionRange(1, 1)); // a character after the caret
  await page.keyboard.press('Shift+Delete');
  await expect(page.locator(`.tile[data-tab-id="${tabIds.beta}"]`)).toHaveCount(0);
  await expect(search).toHaveValue('page'); // no character went with it
  expect(await selectedTitle(page)).toBe(PAGES.alpha.title); // the best match now
  expect((await watched(page)).removed).toEqual([tabIds.beta]);
});

// Shift+Backspace, which a Mac laptop types without fn, closes only while
// the box is empty, so it never takes the place of deleting a character.
test('Shift+Backspace deletes a character while the box has text, and closes the selected card once it is empty', async ({ ext }) => {
  const { tabIds } = await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  await watchCloses(page);
  const search = page.locator('#search');
  await page.keyboard.type('page');
  await page.keyboard.press('Shift+Backspace');
  await expect(search).toHaveValue('pag');
  await expect(page.locator('.tile')).toHaveCount(3);
  expect((await watched(page)).removed).toEqual([]);

  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await expect(search).toHaveValue('');
  await expect.poll(() => selectedTitle(page)).toBe(PAGES.beta.title);
  await page.keyboard.press('Shift+Backspace');
  await expect(page.locator(`.tile[data-tab-id="${tabIds.beta}"]`)).toHaveCount(0);
  expect(await selectedTitle(page)).toBe(PAGES.alpha.title);
  await expect(search).toBeFocused();
  expect((await watched(page)).removed).toEqual([tabIds.beta]);
});

test('Shift+Delete held down closes one card, not the next one too', async ({ ext }) => {
  const { tabIds } = await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  await watchCloses(page);
  await page.keyboard.down('Shift');
  await page.keyboard.down('Delete');
  await expect(page.locator(`.tile[data-tab-id="${tabIds.beta}"]`)).toHaveCount(0);
  expect(await selectedTitle(page)).toBe(PAGES.alpha.title);
  // The key's repeats, now that another card is selected.
  await page.keyboard.down('Delete');
  await page.keyboard.down('Delete');
  await page.keyboard.up('Delete');
  await page.keyboard.up('Shift');
  const { removed, keys } = await watched(page);
  expect(keys).toEqual([
    { key: 'Delete', repeat: false, prevented: true },
    { key: 'Delete', repeat: true, prevented: true },
    { key: 'Delete', repeat: true, prevented: true },
  ]);
  expect(removed).toEqual([tabIds.beta]);
  await expect(page.locator('.tile')).toHaveCount(2);
  expect(await selectedTitle(page)).toBe(PAGES.alpha.title);
});

// In the site view with the box empty, Backspace leaves the view; with
// Shift it closes the selected card, held down or not.
test('in the site view, Shift+Backspace closes the selected card and Backspace still leaves the view', async ({ ext }) => {
  // Current tab tube2, previous tube1, both on www.tube.test, as tube3.
  const { tabIds } = await ext.openWindow(['notes1', 'tube3', 'code1', 'tube1', 'tube2']);
  const page = await ext.open();
  await watchCloses(page);
  const token = page.locator('#scope-token');
  await page.keyboard.press('Tab');
  await expect(token).toBeVisible();
  expect(await tileTitles(page)).toEqual([PAGES.tube1.title, PAGES.tube2.title, PAGES.tube3.title]);
  await page.keyboard.down('Shift');
  await page.keyboard.down('Backspace');
  await expect(page.locator(`.tile[data-tab-id="${tabIds.tube1}"]`)).toHaveCount(0);
  await page.keyboard.down('Backspace'); // a repeat
  await page.keyboard.up('Backspace');
  await page.keyboard.up('Shift');
  await expect(token).toBeVisible();
  expect(await tileTitles(page)).toEqual([PAGES.tube3.title, PAGES.tube2.title]);
  expect(await selectedTitle(page)).toBe(PAGES.tube3.title);
  expect((await watched(page)).removed).toEqual([tabIds.tube1]);

  await page.keyboard.press('Backspace');
  await expect(token).toBeHidden();
  expect((await watched(page)).removed).toEqual([tabIds.tube1]);
  await expect(page.locator('.tile')).toHaveCount(4);
});

test('accessibility: listbox semantics, aria-expanded, and lang matching the text', async ({ ext }) => {
  await ext.openWindow(['alpha', 'beta', 'gamma']);
  const page = await ext.open();
  await expect(page.locator('#grid')).toHaveAttribute('role', 'listbox');
  await expect(page.locator('.tile').first()).toHaveAttribute('role', 'option');
  await page.keyboard.press('ArrowRight');
  const selectedId = await page.locator('.tile.selected').getAttribute('id');
  await expect(page.locator('#search')).toHaveAttribute('aria-activedescendant', selectedId);
  await page.keyboard.type('zzzz');
  await expect(page.locator('#search')).toHaveAttribute('aria-expanded', 'false');
  // No match is said through the live region that was in the page from the
  // start (one added already filled is not reliably read).
  const status = page.locator('#status');
  await expect(status).toHaveAttribute('role', 'status');
  await expect(status).toHaveText(await page.locator('.empty').textContent());
  await page.keyboard.press('Escape');
  await expect(page.locator('.tile').first()).toBeVisible();
  await expect(status).toHaveText('');
  const { lang, placeholder } = await page.evaluate(() => ({ lang: document.documentElement.lang, placeholder: document.getElementById('search').placeholder }));
  expect(['en', 'it', 'zh-CN']).toContain(lang);
  expect(lang === 'zh-CN').toBe(/[一-鿿]/.test(placeholder));
});
