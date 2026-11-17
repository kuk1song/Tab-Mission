import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { issueFormUrl, browserName, systemName } from '../extension/src/feedback.js';

describe('issueFormUrl', () => {
  it("opens the issue form with its fields filled in, each value encoded", () => {
    const url = issueFormUrl({ version: '1.6.0', browser: 'Google Chrome 142', os: 'macOS' });
    expect(url).toBe('https://github.com/kuk1song/Tab-Mission/issues/new?template=bug.yml&version=1.6.0&browser=Google%20Chrome%20142&os=macOS');
  });

  it('reads back as written, whatever a value holds', () => {
    const values = { version: '1.6.0', browser: 'Brave & Co 142', os: 'Linux #1 = a+b?/é' };
    const { searchParams } = new URL(issueFormUrl(values));
    expect(Object.fromEntries(searchParams)).toEqual({ template: 'bug.yml', ...values });
  });

  it('leaves out a value it does not know, so the field stays empty', () => {
    expect(issueFormUrl({ version: '1.6.0', browser: '', os: undefined }))
      .toBe('https://github.com/kuk1song/Tab-Mission/issues/new?template=bug.yml&version=1.6.0');
  });

  // Installed copies link to the form's file and field ids, so neither may change.
  it("names the form's file and the ids of its fields", () => {
    const form = readFileSync(new URL('../.github/ISSUE_TEMPLATE/bug.yml', import.meta.url), 'utf8');
    for (const id of ['version', 'browser', 'os']) expect(form).toMatch(new RegExp(`^ {4}id: ${id}$`, 'm'));
  });
});

describe('browserName', () => {
  const MADE_UP = { brand: 'Not:A-Brand', version: '8' };
  it("names the browser by its own brand and major version, never Chrome's made-up one", () => {
    expect(browserName({ brands: [MADE_UP, { brand: 'Chromium', version: '142' }, { brand: 'Google Chrome', version: '142' }] })).toBe('Google Chrome 142');
    expect(browserName({ brands: [{ brand: 'Chromium', version: '142' }, { brand: 'Microsoft Edge', version: '142' }, { brand: 'Not_A Brand', version: '24' }] })).toBe('Microsoft Edge 142');
    expect(browserName({ brands: [{ brand: 'Not)A;Brand', version: '99' }, { brand: 'Chromium', version: '156' }] })).toBe('Chromium 156');
  });

  it("falls back to Chrome's version in the user agent string, else says nothing", () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
    expect(browserName(undefined, ua)).toBe('Chrome 142');
    expect(browserName({ brands: [MADE_UP] }, ua)).toBe('Chrome 142');
    expect(browserName(undefined, 'Mozilla/5.0')).toBe('');
    expect(browserName(undefined, undefined)).toBe('');
  });
});

describe('systemName', () => {
  it("names the system from Chrome's platform info", () => {
    expect(systemName({ os: 'mac', arch: 'arm64' })).toBe('macOS');
    expect(systemName({ os: 'win' })).toBe('Windows');
    expect(systemName({ os: 'linux' })).toBe('Linux');
    expect(systemName({ os: 'cros' })).toBe('ChromeOS');
  });

  it('falls back to the platform userAgentData names, else says nothing', () => {
    expect(systemName(null, { platform: 'macOS' })).toBe('macOS');
    expect(systemName({ os: 'something new' }, { platform: 'Windows' })).toBe('Windows');
    expect(systemName(null, undefined)).toBe('');
  });
});
