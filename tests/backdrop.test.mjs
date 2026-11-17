import { describe, it, expect } from 'vitest';
import { parseHex, luminance, contrastOf, safeStrength } from '../extension/src/backdrop.js';

// The window's own colors (overview.css).
const DARK = { bg: '#161618', fg: '#f0f0f0', muted: '#a0a0aa' };
const LIGHT = { bg: '#f4f4f7', fg: '#1d1d26', muted: '#5b5b6b' };

// RGBA data of pixels given as '#rrggbb'.
const pixels = (...colors) => new Uint8ClampedArray(colors.flatMap((c) => [...parseHex(c), 255]));
const strength = (theme, ...colors) => safeStrength(pixels(...colors), parseHex(theme.bg), [theme.fg, theme.muted].map(parseHex));
// The contrast of a text color on a pixel under the tint.
const shown = (theme, text, pixel, s) => {
  const under = parseHex(pixel);
  const tint = parseHex(theme.bg);
  return contrastOf(luminance(parseHex(text)), luminance(under.map((v, c) => v * (1 - s) + tint[c] * s)));
};

describe('colors', () => {
  it('reads a hex color', () => {
    expect(parseHex('#00d4ff')).toEqual([0, 212, 255]);
    expect(parseHex(' #F4F4F7 ')).toEqual([244, 244, 247]);
    expect(() => parseHex('rgb(0, 0, 0)')).toThrow();
  });

  it('measures contrast as WCAG does', () => {
    expect(contrastOf(luminance([255, 255, 255]), luminance([0, 0, 0]))).toBeCloseTo(21, 5);
    expect(contrastOf(luminance([118, 118, 118]), luminance([255, 255, 255]))).toBeCloseTo(4.54, 2);
  });
});

describe('safeStrength: how strong the tint over a picture must be', () => {
  it('is lightest over a picture of the window\'s own tone', () => {
    expect(strength(DARK, '#000000', '#101418')).toBe(0.42);
    expect(strength(LIGHT, '#ffffff', '#f0f0f0')).toBe(0.42);
  });

  it('is strong over a picture of the opposite tone, and never opaque for a real picture', () => {
    expect(strength(DARK, '#ffffff')).toBeGreaterThan(0.8);
    expect(strength(DARK, '#ffffff')).toBeLessThan(1);
    expect(strength(LIGHT, '#000000')).toBeGreaterThan(0.8);
    expect(strength(LIGHT, '#000000')).toBeLessThan(1);
  });

  it('goes by the least readable pixel, wherever it is', () => {
    const many = Array.from({ length: 200 }, () => '#101418');
    expect(strength(DARK, ...many, '#ffffff')).toBe(strength(DARK, '#ffffff'));
    expect(strength(DARK, '#ffffff', ...many)).toBe(strength(DARK, '#ffffff'));
  });

  it('keeps every text at 4.5:1 or more on every pixel', () => {
    const picture = ['#ffffff', '#000000', '#808080', '#c04060', '#2060c0', '#ffe14d', '#00d4ff', '#3b6fd6'];
    for (const theme of [DARK, LIGHT]) {
      const s = strength(theme, ...picture);
      for (const pixel of picture) {
        expect(shown(theme, theme.fg, pixel, s), `${theme.bg} fg on ${pixel}`).toBeGreaterThanOrEqual(4.5);
        expect(shown(theme, theme.muted, pixel, s), `${theme.bg} muted on ${pixel}`).toBeGreaterThanOrEqual(4.5);
      }
      // And not much stronger than needed: one step lighter would not do.
      const lighter = s - 0.02;
      expect(picture.some((pixel) => shown(theme, theme.muted, pixel, lighter) < 4.8)).toBe(true);
    }
  });
});
