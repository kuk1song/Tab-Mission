import { describe, it, expect, vi } from 'vitest';
import {
  getHostname,
  isCapturableUrl,
  isSleeping,
  hueColor,
  faviconUrl,
  dominantColor,
  createPlaceholderIcon,
} from '../extension/src/utils.js';

describe('getHostname', () => {
  it('extracts the hostname from a URL', () => {
    expect(getHostname('https://www.example.com/path?q=1')).toBe('www.example.com');
  });
  it('falls back to the raw string for non-URLs', () => {
    expect(getHostname('not a url')).toBe('not a url');
    expect(getHostname('')).toBe('');
  });
});

describe('isCapturableUrl', () => {
  it('accepts only http(s) pages', () => {
    expect(isCapturableUrl('https://example.com')).toBe(true);
    expect(isCapturableUrl('http://example.com')).toBe(true);
  });
  it('rejects chrome pages, blanks, and empties', () => {
    expect(isCapturableUrl('chrome://extensions')).toBe(false);
    expect(isCapturableUrl('about:blank')).toBe(false);
    expect(isCapturableUrl('')).toBe(false);
    expect(isCapturableUrl(undefined)).toBe(false);
  });
});

describe('isSleeping', () => {
  it('treats discarded and unloaded tabs as sleeping', () => {
    expect(isSleeping({ discarded: true, status: 'complete' })).toBe(true);
    expect(isSleeping({ discarded: false, status: 'unloaded' })).toBe(true);
    expect(isSleeping({ discarded: false, status: 'complete' })).toBe(false);
  });
});

describe('hueColor', () => {
  it('gives the same color for the same site', () => {
    expect(hueColor('example.com')).toMatch(/^hsl\(\d+ 45% 55%\)$/);
    expect(hueColor('example.com')).toBe(hueColor('example.com'));
  });
});

describe('faviconUrl', () => {
  it('asks Chrome\'s favicon store for the page', () => {
    vi.stubGlobal('chrome', { runtime: { getURL: (path) => `chrome-extension://id${path}` } });
    expect(faviconUrl('https://a.test/x?y=1')).toBe('chrome-extension://id/_favicon/?pageUrl=https%3A%2F%2Fa.test%2Fx%3Fy%3D1&size=32');
    vi.unstubAllGlobals();
  });
});

describe('dominantColor', () => {
  const pixels = (list) => Uint8ClampedArray.from(list.flat());
  it('averages the colored pixels, skipping white, black, grey and transparent ones', () => {
    const red = [230, 30, 40, 255];
    const data = pixels([...Array(20).fill(red), ...Array(20).fill([255, 255, 255, 255]), ...Array(20).fill([20, 20, 20, 255]), ...Array(20).fill([0, 120, 255, 10])]);
    expect(dominantColor(data)).toBe('rgb(230 30 40)');
  });
  it('is null for an icon with almost no color (Chrome\'s default globe, a black logo)', () => {
    expect(dominantColor(pixels(Array(64).fill([128, 128, 130, 255])))).toBe(null);
    expect(dominantColor(pixels([...Array(5).fill([230, 30, 40, 255]), ...Array(59).fill([0, 0, 0, 255])]))).toBe(null);
  });
});

describe('createPlaceholderIcon', () => {
  it('returns an svg data URI', () => {
    expect(createPlaceholderIcon('example.com').startsWith('data:image/svg+xml')).toBe(true);
  });
  it('does not throw on non-Latin1 (IDN) hostnames', () => {
    // Regression for the btoa() crash: the first letter of an IDN hostname can
    // be a code point > 255, which btoa rejected. encodeURIComponent handles it.
    expect(() => createPlaceholderIcon('中文.com')).not.toThrow();
    expect(createPlaceholderIcon('日本語.jp').startsWith('data:image/svg+xml')).toBe(true);
  });
});
