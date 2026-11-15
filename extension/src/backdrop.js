// backdrop.js: the picture behind the cards (settings page, "The page you
// were on"; the wallpaper needs no code, overview.css draws it). It is the
// one covers.js took while that page was in front, so nothing new is
// captured. Without one (a browser page, a private window, pictures not
// taken yet) the window keeps its plain background. The picture is blurred
// here, once and small, and shown as a plain image: a filter on a layer the
// size of the window, like the backdrop-filter 1.5.0 removed, could cost
// every frame.
import { state } from './state.js';
import { readCover } from './covers.js';

// Text on the backdrop keeps at least this contrast (WCAG 1.4.3 asks 4.5:1;
// the rest is for what the sample below does not see of the blurred picture).
const CONTRAST = 4.8;
// The tint is never lighter than this: what the cards spread out use, where
// no text stands on the backdrop itself (overview.css).
const MIN_STRENGTH = 0.42;
// The blurred picture: a quarter of a stored one (640 px wide, 16:10), the
// blur about what 28 px is in a window 1280 px wide.
const BLURRED = { width: 160, height: 100, blur: 3.5, past: 12 };
const SAMPLE = { width: 64, height: 40 };

export async function showBackdrop() {
  const root = document.documentElement;
  if (root.dataset.backdrop !== 'page') return;
  const el = document.getElementById('backdrop');
  try {
    const tab = state.allTabs.find((candidate) => candidate.id === state.currentTabId);
    const picture = el && tab ? await readCover(tab) : null;
    if (!picture) {
      delete root.dataset.backdrop;
      return;
    }
    const image = new Image();
    image.src = picture;
    await image.decode();
    const blurred = blur(image);
    const style = getComputedStyle(root);
    const color = (name) => parseHex(style.getPropertyValue(name));
    // The texts that stand on the backdrop itself in the grid (the
    // selected title takes --fg there, overview.css).
    const strength = safeStrength(sample(blurred), color('--bg'), ['--fg', '--muted'].map(color));
    const url = URL.createObjectURL(await blurred.convertToBlob({ type: 'image/png' }));
    root.style.setProperty('--backdrop-safe', String(strength));
    el.style.setProperty('--backdrop-image', `url("${url}")`);
    el.dataset.picture = '';
  } catch {
    delete root.dataset.backdrop;
  }
}

// The picture small, blurred, its colors a little stronger. Drawn past the
// canvas's edges, so the blur has picture to take from there and the edges
// do not fade.
function blur(image) {
  const { width, height, past } = BLURRED;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.filter = `blur(${BLURRED.blur}px) saturate(1.5)`;
  context.drawImage(image, -past, -past, width + 2 * past, height + 2 * past);
  return canvas;
}

// The blurred picture's colors, a little smaller still (blurred, it loses
// nothing by it). RGBA data.
function sample(blurred) {
  const canvas = new OffscreenCanvas(SAMPLE.width, SAMPLE.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.imageSmoothingQuality = 'high';
  context.drawImage(blurred, 0, 0, SAMPLE.width, SAMPLE.height);
  return context.getImageData(0, 0, SAMPLE.width, SAMPLE.height).data;
}

// '#rrggbb' to [r, g, b].
export function parseHex(value) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(value).trim());
  if (!match) throw new Error(`not a color: ${value}`);
  return [0, 2, 4].map((at) => parseInt(match[1].slice(at, at + 2), 16));
}

// WCAG's relative luminance of an sRGB color ([r, g, b], 0 to 255).
export function luminance([r, g, b]) {
  const linear = (v) => (v <= 10.31475 ? v / 3294.6 : ((v / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

// WCAG's contrast ratio of two luminances.
export function contrastOf(a, b) {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// How strong the tint over a picture must be (its opacity, in steps of
// 0.02, from MIN_STRENGTH to 1) for every text color to keep CONTRAST on
// every pixel of the picture under it. pixels is RGBA data; tint and texts
// are [r, g, b]. The tint is the window's own background, on which the
// texts are readable, so a strength of 1 always does.
export function safeStrength(pixels, tint, texts) {
  const textLuminances = texts.map(luminance);
  for (let strength = MIN_STRENGTH; strength < 1; strength += 0.02) {
    // Against one text color, contrast is lowest at the lightest or the
    // darkest pixel, so those two decide.
    let lightest = -Infinity;
    let darkest = Infinity;
    for (let i = 0; i < pixels.length; i += 4) {
      const shown = luminance([0, 1, 2].map((c) => pixels[i + c] * (1 - strength) + tint[c] * strength));
      if (shown > lightest) lightest = shown;
      if (shown < darkest) darkest = shown;
    }
    const readable = textLuminances.every((text) => (
      contrastOf(text, lightest) >= CONTRAST && contrastOf(text, darkest) >= CONTRAST
      // A text color between the two would meet its own shade somewhere.
      && !(text > darkest && text < lightest)
    ));
    if (readable) return Math.round(strength * 100) / 100;
  }
  return 1;
}
