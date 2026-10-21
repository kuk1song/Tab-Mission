import { test, expect, PAGES, contrasts } from './fixtures.mjs';

// Chrome only auto-assigns a suggested key that none of its own shortcuts
// use: Ctrl+E is Chrome's "search" key on Windows, Linux and ChromeOS, so the
// default there is Ctrl+Shift+E. Runs on every OS in CI.
test('the default shortcut is assigned on this OS and shown on the welcome page', async ({ ext }) => {
  const shortcut = await ext.sw.evaluate(() => chrome.commands.getAll().then((c) => c.find((x) => x.name === 'open-overview')?.shortcut || ''));
  expect(shortcut).toBe(process.platform === 'darwin' ? '⌘E' : 'Ctrl+Shift+E');
  await expect(ext.welcome.locator('#step-open kbd')).toBeVisible();
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

// What each of the first 30 frames shows: whether the page is visible, its
// text, its height and the switch's knob. The shortcut arrives 100 ms late,
// so the page has several frames to show itself unfinished.
function recordFrames() {
  const getAll = chrome.commands.getAll.bind(chrome.commands);
  chrome.commands.getAll = async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    return getAll();
  };
  window.frames_ = [];
  const record = () => {
    const main = document.querySelector('main');
    if (main) {
      const knob = document.querySelector('.switch');
      window.frames_.push({
        visible: getComputedStyle(main).visibility === 'visible',
        text: main.innerText,
        height: main.getBoundingClientRect().height,
        knob: knob && getComputedStyle(knob, '::before').transform,
      });
    }
    if (window.frames_.length < 30) requestAnimationFrame(record);
  };
  requestAnimationFrame(record);
}

// Every frame the page is visible in looks like the finished page: no English
// before the translation, no shift when the shortcut arrives, no switch
// sliding from off to its saved state.
async function shownFrames(context, url, setup) {
  const page = await context.newPage();
  await page.addInitScript(recordFrames);
  if (setup) await page.addInitScript(setup);
  await page.goto(url);
  await expect.poll(() => page.evaluate(() => window.frames_.length)).toBe(30);
  const shown = (await page.evaluate(() => window.frames_)).filter((f) => f.visible);
  await page.close();
  expect(shown.length).toBeGreaterThan(0);
  expect(shown.filter((f) => JSON.stringify(f) !== JSON.stringify(shown.at(-1)))).toEqual([]);
  return shown.at(-1);
}

test('options page: appears finished, the switch in its saved state without sliding', async ({ ext, context }) => {
  for (const stored of [true, false]) {
    await ext.sw.evaluate((value) => chrome.storage.local.set({ preselectPrevious: value }), stored);
    const finished = await shownFrames(context, `chrome-extension://${new URL(ext.sw.url()).host}/options.html`);
    expect(finished.knob).toBe(stored ? 'matrix(1, 0, 0, 1, 18, 0)' : 'none');
  }
});

// With a "Try it" step already done, read later than the shortcut arrives:
// the page still appears with that step ticked, never unticked first.
test('welcome page: appears finished, with the shortcut and the steps done so far', async ({ ext, context }) => {
  await ext.sw.evaluate(() => chrome.storage.local.set({ tryItOpen: true }));
  const finished = await shownFrames(context, ext.welcome.url(), () => {
    const get = chrome.storage.local.get.bind(chrome.storage.local);
    chrome.storage.local.get = async (keys) => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return get(keys);
    };
  });
  const shortcut = await ext.sw.evaluate(() => chrome.commands.getAll().then((c) => c.find((x) => x.name === 'open-overview').shortcut));
  expect(finished.text).toContain(shortcut.replace(/\+/g, ' + '));
  const doneLabel = await ext.welcome.evaluate(() => chrome.i18n.getMessage('welcomeStepDone'));
  expect(finished.text).toContain(doneLabel);
});

const stepsStored = (ext) => ext.sw.evaluate(() => chrome.storage.local.get(['tryItOpen', 'tryItBack']));

// Learn by doing: each step on the welcome page ticks itself once the user
// has done it, with the real shortcut pressed through Chrome.
test('welcome page: the try-it steps tick as the user does them', async ({ ext, context }) => {
  const { windowId } = await ext.openWindow(['alpha', 'beta']);
  const welcome = ext.welcome;
  const message = (key, substitutions) => welcome.evaluate(([k, s]) => chrome.i18n.getMessage(k, s), [key, substitutions]);
  const step = (name) => welcome.locator(`#step-${name}`);
  const done = welcome.locator('#try-it .step.done');

  await expect(welcome.locator('#try-it .step')).toHaveCount(2);
  await expect(done).toHaveCount(0);
  for (const name of ['open', 'back']) {
    await expect(step(name).locator('.step-state')).toHaveText(await message('welcomeStepTodo'));
  }
  await expect(welcome.locator('#all-set')).toBeHidden();
  const shortcut = await ext.sw.evaluate(() => chrome.commands.getAll().then((c) => c.find((x) => x.name === 'open-overview').shortcut));
  await expect(step('open').locator('kbd')).toHaveText(shortcut.replace(/\+/g, ' + '));
  // Typing is the first of the other tips, no longer a step.
  await expect(welcome.locator('.tips li').first()).toHaveText(await message('welcomeTipSearch'));

  // Opened without the shortcut (the page's button), closed with Esc: no step.
  let overview = await ext.open();
  await ext.pressToClose(overview, 'Escape');
  expect(await stepsStored(ext)).toEqual({});
  await expect(done).toHaveCount(0);

  // 1. The real shortcut opens Tab Mission.
  const opened = context.waitForEvent('page', (p) => p.url().includes('/overview.html'));
  await ext.pressDefaultShortcut(context.pages().find((p) => p.url().includes('/beta.html')));
  overview = await opened;
  await overview.locator('#grid .tile').first().waitFor();
  await expect(step('open')).toHaveClass(/\bdone\b/);
  await expect(step('open').locator('.step-state')).toHaveText(await message('welcomeStepDone'));
  await expect(welcome.locator('#try-status')).toHaveText(
    await message('welcomeStepAnnounce', [await step('open').locator('.step-text').textContent()]));
  await expect(done).toHaveCount(1);
  await expect(welcome.locator('#all-set')).toBeHidden();

  // 2. Pressed again in Tab Mission, it goes back to the previous tab.
  await ext.pressDefaultShortcut(overview);
  await ext.expectClosed();
  expect(await ext.activeTitle(windowId)).toBe(PAGES.alpha.title);
  await expect(step('back')).toHaveClass(/\bdone\b/);
  await expect(done).toHaveCount(2);
  await expect(welcome.locator('#all-set')).toBeVisible();
  await expect(welcome.locator('#try-status')).toContainText(await message('welcomeAllSet'));
  expect(await stepsStored(ext)).toEqual({ tryItOpen: true, tryItBack: true });
});

// With reduced motion the window closes at once after a switch; the step
// is written before that.
test('welcome page: the steps tick with reduced motion, when the window closes at once', async ({ ext, context }) => {
  const { windowId } = await ext.openWindow(['alpha', 'beta']);
  const opened = context.waitForEvent('page', (p) => p.url().includes('/overview.html'));
  await ext.pressDefaultShortcut(context.pages().find((p) => p.url().includes('/beta.html')));
  const overview = await opened;
  await overview.locator('#grid .tile').first().waitFor();
  await overview.emulateMedia({ reducedMotion: 'reduce' });
  await ext.pressDefaultShortcut(overview);
  await ext.expectClosed();
  expect(await ext.activeTitle(windowId)).toBe(PAGES.alpha.title);
  await expect.poll(() => stepsStored(ext)).toEqual({ tryItOpen: true, tryItBack: true });
  await expect(ext.welcome.locator('#try-it .step.done')).toHaveCount(2);
  await expect(ext.welcome.locator('#all-set')).toBeVisible();
});

// Opened with the page's button, the shortcut pressed inside is the user's
// first press: background.js records step 1 and the overview step 2 for the
// same press.
test('welcome page: opened with the button, the first press inside ticks both steps', async ({ ext }) => {
  const { windowId } = await ext.openWindow(['alpha', 'beta']);
  const overview = await ext.open();
  await ext.pressDefaultShortcut(overview);
  await ext.expectClosed();
  expect(await ext.activeTitle(windowId)).toBe(PAGES.alpha.title);
  await expect.poll(() => stepsStored(ext)).toEqual({ tryItOpen: true, tryItBack: true });
  await expect(ext.welcome.locator('#try-it .step.done')).toHaveCount(2);
});

// Help stays easy to find: the settings page's Help section has one switch,
// which shows the window's tips every time.
test('options page: Help is one Show tips switch, off by default, that saves at once', async ({ ext, context }) => {
  const { page } = await openOptions(ext, context);
  await expect(page.locator('section[aria-labelledby="help-heading"] .row')).toHaveCount(1);
  const tips = page.locator('#show-tips');
  await expect(tips).toHaveAttribute('role', 'switch');
  await expect(tips).not.toBeChecked();
  await page.locator('label[for="show-tips"]').click();
  await expect(tips).toBeChecked();
  await expect.poll(() => ext.sw.evaluate(() => chrome.storage.local.get('showTips'))).toEqual({ showTips: true });
});

// Chrome has no event for a changed shortcut: the welcome and settings pages
// read it again when the user comes back to their tab or window.
test('welcome and settings pages: a shortcut changed elsewhere shows on coming back', async ({ ext, context }) => {
  const host = new URL(ext.sw.url()).host;
  for (const [file, where] of [['welcome.html', '#step-open kbd'], ['options.html', '#shortcuts kbd.combo']]) {
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.shortcut_ = '';
      const getAll = chrome.commands.getAll.bind(chrome.commands);
      chrome.commands.getAll = async () => (await getAll()).map((c) => (c.name === 'open-overview' && window.shortcut_ ? { ...c, shortcut: window.shortcut_ } : c));
    });
    await page.goto(`chrome-extension://${host}/${file}`);
    await expect(page.locator(where)).toBeVisible();
    await page.evaluate(() => {
      window.shortcut_ = 'Alt+Shift+K';
      window.dispatchEvent(new Event('focus'));
    });
    await expect(page.locator(where)).toContainText('K');
    await expect(page.locator(where)).toContainText('Alt');
    await page.close();
  }
});

// Coming back from Chrome's shortcuts page fires both focus and
// visibilitychange; the row's button keeps the keyboard focus, or, when the
// shortcut changed, the new row's button gets it.
test('options page: coming back from the shortcuts page keeps the focus on the shortcut button', async ({ ext, context }) => {
  const { page, row } = await openOptions(ext, context, () => {
    window.shortcut_ = '';
    window.reads_ = 0;
    const getAll = chrome.commands.getAll.bind(chrome.commands);
    chrome.commands.getAll = async () => {
      const commands = (await getAll()).map((c) => (c.name === 'open-overview' && window.shortcut_ ? { ...c, shortcut: window.shortcut_ } : c));
      window.reads_++;
      return commands;
    };
  });
  const button = row.locator('button');
  await expect.poll(() => page.evaluate(() => window.reads_)).toBe(1);
  await button.evaluate((b) => {
    b.dataset.mark = 'first';
    b.focus();
  });
  const comeBack = () => page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
  // Each read is done once the page has counted it (the row is drawn right
  // after, before any other task).
  await comeBack();
  await expect.poll(() => page.evaluate(() => window.reads_)).toBe(3);
  expect(await page.evaluate(() => document.activeElement?.dataset.mark)).toBe('first');
  await page.evaluate(() => {
    window.shortcut_ = 'Alt+Shift+K';
  });
  await comeBack();
  await expect.poll(() => page.evaluate(() => window.reads_)).toBe(5);
  await expect(page.locator('#shortcuts kbd.combo')).toContainText('K');
  expect(await page.evaluate(() => ({
    inRow: Boolean(document.activeElement?.closest('#shortcuts')),
    tag: document.activeElement?.tagName,
    mark: document.activeElement?.dataset.mark ?? null,
  }))).toEqual({ inRow: true, tag: 'BUTTON', mark: null });
  await page.close();
});

// The switch's knob against its track, off and on, light and dark: 3:1 at
// least (WCAG 1.4.11), as the knob's side shows the state.
test('options page: a switch\'s knob stands out on its track, off and on, light and dark', async ({ ext, context }) => {
  const { page } = await openOptions(ext, context);
  await expect(page.locator('#preselect-previous')).toBeChecked();
  await expect(page.locator('#show-tips')).not.toBeChecked();
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    // The track's color slides to the new appearance's.
    await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);
    const ratios = await page.evaluate(() => {
      const rgba = (s) => (s.match(/[\d.]+/g) || []).map(Number);
      const over = (top, bottom) => [0, 1, 2].map((i) => top[i] * (top[3] ?? 1) + bottom[i] * (1 - (top[3] ?? 1)));
      const luminance = (c) => {
        const [r, g, b] = c.map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const result = {};
      for (const id of ['preselect-previous', 'show-tips']) {
        const input = document.getElementById(id);
        const chain = [];
        for (let node = input; node; node = node.parentElement) chain.push(node);
        let track = [255, 255, 255];
        for (const node of chain.reverse()) {
          const layer = rgba(getComputedStyle(node).backgroundColor);
          if (layer.length) track = over(layer, track);
        }
        const knob = over(rgba(getComputedStyle(input, '::before').backgroundColor), track);
        result[input.checked ? 'on' : 'off'] = Math.round(ratio(luminance(knob), luminance(track)) * 10) / 10;
      }
      return result;
    });
    for (const [state, value] of Object.entries(ratios)) {
      expect(value, `knob ${state} in ${colorScheme}`).toBeGreaterThanOrEqual(3);
    }
  }
});

test("options page: the shortcut button opens Chrome's shortcuts page", async ({ ext, context }) => {
  const { row } = await openOptions(ext, context);
  const opened = context.waitForEvent('page', (p) => p.url().startsWith('chrome://extensions/shortcuts'));
  await row.locator('button').click();
  await (await opened).close();
});

test('options and welcome pages follow the system appearance, stay readable and never scroll sideways', async ({ ext, context }) => {
  const { page } = await openOptions(ext, context);
  // One "Try it" step done, so both step styles are on the page.
  await ext.sw.evaluate(() => chrome.storage.local.set({ tryItOpen: true }));
  await expect(ext.welcome.locator('#try-it .step.done')).toHaveCount(1);
  const pages = [
    [page, ['h1', '.title', '.desc', 'h2', '#version', '#link-privacy']],
    [ext.welcome, ['h1', '.tips li', '.note', 'h2', '.step:not(.done) .step-mark', '.step:not(.done) .step-text',
      '.step.done .step-text', '.step.done .step-state', '#all-set']],
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
