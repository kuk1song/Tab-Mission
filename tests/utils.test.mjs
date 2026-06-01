import { describe, it, expect } from 'vitest';
import {
  getHostname,
  isValidIconUrl,
  isCapturableUrl,
  generateGradient,
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

describe('isValidIconUrl', () => {
  it('accepts http(s) and data URLs', () => {
    expect(isValidIconUrl('https://example.com/favicon.ico')).toBe(true);
    expect(isValidIconUrl('http://example.com/favicon.ico')).toBe(true);
    expect(isValidIconUrl('data:image/png;base64,AAAA')).toBe(true);
  });
  it('rejects other schemes and junk', () => {
    expect(isValidIconUrl('chrome://favicon')).toBe(false);
    expect(isValidIconUrl('ftp://example.com/x')).toBe(false);
    expect(isValidIconUrl('not a url')).toBe(false);
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

describe('generateGradient', () => {
  it('returns a deterministic CSS linear-gradient for a seed', () => {
    const gradient = generateGradient('example.com');
    expect(gradient.startsWith('linear-gradient(')).toBe(true);
    expect(generateGradient('example.com')).toBe(gradient);
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
