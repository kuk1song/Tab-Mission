import { describe, it, expect, vi } from 'vitest';
import {
  getHostname,
  addressLabel,
  isCapturableUrl,
  isLocalHost,
  isSleeping,
  hueColor,
  faviconUrl,
  dominantColor,
  createPlaceholderIcon,
  pageAddress,
  withPendingAddress,
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

describe('pageAddress', () => {
  it('writes a web page as its host and path, for a card with no title yet', () => {
    expect(pageAddress('https://www.news.example/2026/10/story.html?ref=a#top')).toBe('news.example/2026/10/story.html');
    expect(pageAddress('http://localhost:3000/app')).toBe('localhost:3000/app');
    expect(pageAddress('https://example.com/')).toBe('example.com');
  });
  it('is empty for other pages and what is not an address', () => {
    expect(pageAddress('chrome://settings/')).toBe('');
    expect(pageAddress('')).toBe('');
  });
});

describe('withPendingAddress', () => {
  it('gives a tab whose page has not committed the address it is going to', () => {
    const tab = { id: 1, url: '', pendingUrl: 'https://news.example/story', title: '' };
    expect(withPendingAddress(tab)).toEqual({ ...tab, url: 'https://news.example/story' });
  });
  it('leaves other tabs as they are, one moving on to another page included', () => {
    const moving = { id: 2, url: 'https://a.example/', pendingUrl: 'https://b.example/' };
    expect(withPendingAddress(moving)).toBe(moving);
    const blank = { id: 3, url: '' };
    expect(withPendingAddress(blank)).toBe(blank);
  });
});

describe('addressLabel', () => {
  const names = { own: 'Tab Mission', extension: 'Extension page', file: 'Local file', host: 'ownid' };
  it('names a web page by its host, without www', () => {
    expect(addressLabel('https://www.youtube.com/watch?v=1', names)).toBe('youtube.com');
    expect(addressLabel('http://docs.example.com/a', names)).toBe('docs.example.com');
  });
  it('names a browser page by its scheme and host, as the address bar does', () => {
    expect(addressLabel('chrome://extensions/', names)).toBe('chrome://extensions');
    expect(addressLabel('chrome://settings/privacy', names)).toBe('chrome://settings');
    expect(addressLabel('about:blank', names)).toBe('about:blank');
  });
  it("names Tab Mission's pages, other extensions' pages and local files", () => {
    expect(addressLabel('chrome-extension://ownid/options.html', names)).toBe('Tab Mission');
    expect(addressLabel('chrome-extension://otherid/popup.html', names)).toBe('Extension page');
    expect(addressLabel('file:///Users/me/notes.html', names)).toBe('Local file');
  });
  it('says nothing for an address without a host, or what is not an address', () => {
    expect(addressLabel('data:text/html,<p>x', names)).toBe('');
    expect(addressLabel('blob:https://example.com/123', names)).toBe('');
    expect(addressLabel('javascript:void(0)', names)).toBe('');
    expect(addressLabel('vbscript:msgbox(1)', names)).toBe('');
    expect(addressLabel('not a url', names)).toBe('');
    expect(addressLabel(undefined, names)).toBe('');
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

describe('isLocalHost', () => {
  // Hosts as the callers pass them: URL's hostname of an address.
  const host = (address) => new URL(address).hostname;
  const local = (address) => isLocalHost(host(address));

  it('knows localhost and the names kept for local use, with any name under them', () => {
    for (const name of ['localhost', 'app.localhost', 'printer.local', 'db.corp.internal', 'home.arpa', 'nas.home.arpa', 'LOCALHOST', 'localhost.', 'router.local.']) {
      expect(isLocalHost(name), name).toBe(true);
    }
    for (const name of ['localhost.example', 'mylocalhost', 'notlocal', 'local.example', 'internal.example', 'home.arpa.example', 'example.com', 'site.test', '']) {
      expect(isLocalHost(name), name).toBe(false);
    }
    expect(isLocalHost(undefined)).toBe(false);
  });

  it('knows the local IPv4 ranges, up to each edge and not past it', () => {
    const edges = [
      // [last outside, first inside, last inside, first outside]
      [null, '0.0.0.0', '0.255.255.255', '1.0.0.0'], // this network, 0/8
      ['9.255.255.255', '10.0.0.0', '10.255.255.255', '11.0.0.0'], // 10/8
      ['100.63.255.255', '100.64.0.0', '100.127.255.255', '100.128.0.0'], // shared, 100.64/10
      ['126.255.255.255', '127.0.0.0', '127.255.255.255', '128.0.0.0'], // loopback, 127/8
      ['169.253.255.255', '169.254.0.0', '169.254.255.255', '169.255.0.0'], // link-local, 169.254/16
      ['172.15.255.255', '172.16.0.0', '172.31.255.255', '172.32.0.0'], // 172.16/12
      ['192.167.255.255', '192.168.0.0', '192.168.255.255', '192.169.0.0'], // 192.168/16
    ];
    for (const [before, first, last, after] of edges) {
      if (before) expect(isLocalHost(before), before).toBe(false);
      expect(isLocalHost(first), first).toBe(true);
      expect(isLocalHost(last), last).toBe(true);
      expect(isLocalHost(after), after).toBe(false);
    }
    expect(isLocalHost('8.8.8.8')).toBe(false);
    expect(isLocalHost('255.255.255.255')).toBe(false);
  });

  it('reads IPv4 addresses however they are written, once URL has read them', () => {
    for (const address of ['http://0x7f.1/', 'http://2130706433/', 'http://127.1/', 'http://017700000001/', 'http://0/', 'http://127.0.0.1./', 'http://192.168.1.1:8080/a.png']) {
      expect(local(address), address).toBe(true);
    }
    expect(local('http://0x8.8.8.8/')).toBe(false);
  });

  it('knows the local IPv6 addresses and ranges, in brackets as URL gives them', () => {
    const inside = ['http://[::]/', 'http://[::1]/', 'http://[0:0:0:0:0:0:0:1]/',
      'http://[fc00::]/', 'http://[fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff]/', // fc00::/7
      'http://[fe80::]/', 'http://[FE80::1]/', 'http://[febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff]/']; // fe80::/10
    const outside = ['http://[::2]/', 'http://[fbff:ffff:ffff:ffff:ffff:ffff:ffff:ffff]/', 'http://[fe00::]/',
      'http://[fe7f:ffff:ffff:ffff:ffff:ffff:ffff:ffff]/', 'http://[fec0::]/', 'http://[2001:db8::1]/', 'http://[2606:4700::1111]/'];
    for (const address of inside) expect(local(address), address).toBe(true);
    for (const address of outside) expect(local(address), address).toBe(false);
  });

  it('knows a local IPv4 address mapped to IPv6, at the edges of each range', () => {
    expect(host('http://[::ffff:127.0.0.1]/')).toBe('[::ffff:7f00:1]'); // as URL writes it
    for (const v4 of ['0.0.0.0', '10.0.0.0', '10.255.255.255', '100.64.0.0', '100.127.255.255', '127.0.0.1', '169.254.0.0', '172.16.0.0', '172.31.255.255', '192.168.0.0', '192.168.255.255']) {
      expect(local(`http://[::ffff:${v4}]/`), v4).toBe(true);
    }
    for (const v4 of ['1.0.0.0', '9.255.255.255', '11.0.0.0', '100.63.255.255', '100.128.0.0', '128.0.0.0', '169.255.0.0', '172.15.255.255', '172.32.0.0', '192.169.0.0', '8.8.8.8']) {
      expect(local(`http://[::ffff:${v4}]/`), v4).toBe(false);
    }
    // The dotted form, as people write it, reads the same.
    expect(isLocalHost('[::ffff:192.168.1.1]')).toBe(true);
    expect(isLocalHost('[::ffff:8.8.8.8]')).toBe(false);
    // Only ::ffff: maps an IPv4 address.
    expect(local('http://[::fffe:7f00:1]/')).toBe(false);
    expect(local('http://[0:0:0:0:1:ffff:7f00:1]/')).toBe(false);
  });

  it('is false for what is not a host it knows', () => {
    for (const text of ['[]', '[::1', '[1::2::3]', '[1:2:3:4:5:6:7:8:9]', '[xyz::1]', '256.0.0.1', '10.0.0', 'fe80::1']) {
      expect(isLocalHost(text), text).toBe(false);
    }
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
