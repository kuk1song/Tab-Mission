// backdrop.js: the frosted backdrop (settings page, off by default). Behind
// the Tab Mission window goes a blurred picture of the page you were on: the
// one covers.js took while that page was in front, so nothing new is
// captured. Without a picture (a browser page, a private window, pictures
// not taken yet) the window keeps its plain background.
import { state } from './state.js';
import { readCover } from './covers.js';

const BLUR_MARGIN = 48; // px the picture must reach past the window's edges

export async function showBackdrop() {
  const root = document.documentElement;
  if (!root.dataset.frost) return;
  const el = document.getElementById('backdrop');
  try {
    const tab = state.allTabs.find((candidate) => candidate.id === state.currentTabId);
    const picture = el && tab ? await readCover(tab) : null;
    if (!picture) {
      delete root.dataset.frost;
      return;
    }
    const probe = new Image();
    probe.src = picture;
    await probe.decode();
    el.style.setProperty('--backdrop-image', `url("${picture}")`);
    await place(el, tab);
    root.dataset.frost = 'on';
  } catch {
    delete root.dataset.frost;
  }
}

// Where the page is on the screen, seen from this window: when the page
// reaches past every edge of this window, the picture sits exactly where the
// page is, as if seen through the window. Otherwise it fills the window.
async function place(el, tab) {
  const rect = await pageRect(tab);
  const covers = rect
    && rect.x <= -BLUR_MARGIN && rect.y <= -BLUR_MARGIN
    && rect.x + rect.w >= innerWidth + BLUR_MARGIN && rect.y + rect.h >= innerHeight + BLUR_MARGIN;
  if (!covers) {
    delete el.dataset.place;
    return;
  }
  for (const [name, value] of [['x', rect.x], ['y', rect.y], ['w', rect.w], ['h', rect.h]]) {
    el.style.setProperty(`--backdrop-${name}`, `${Math.round(value)}px`);
  }
  el.dataset.place = 'page';
}

// The page's area in this window's coordinates (CSS px). A browser window's
// toolbars are above the page, so the page is taken to sit at the bottom of
// its window, centered; null when the sizes are not known.
export async function pageRect(tab) {
  try {
    const win = await chrome.windows.get(tab.windowId);
    if (![win.left, win.top, win.width, win.height, tab.width, tab.height].every(Number.isFinite)) return null;
    if (win.state === 'minimized' || tab.width <= 0 || tab.height <= 0) return null;
    const pageLeft = win.left + (win.width - tab.width) / 2;
    const pageTop = win.top + win.height - tab.height;
    const selfLeft = screenX + (outerWidth - innerWidth) / 2;
    const selfTop = screenY + (outerHeight - innerHeight);
    return { x: pageLeft - selfLeft, y: pageTop - selfTop, w: tab.width, h: tab.height };
  } catch {
    return null;
  }
}
