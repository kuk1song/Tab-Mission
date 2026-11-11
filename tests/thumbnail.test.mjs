import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The service worker's side of thumbnail.js: a small fake of the tab event
// it listens to and of session storage, which copies what it stores as
// Chrome does.
function fakeChrome() {
  const listeners = {};
  const data = {};
  return {
    listeners,
    data,
    storage: {
      session: {
        get: vi.fn(async (key) => (key in data ? { [key]: structuredClone(data[key]) } : {})),
        set: vi.fn(async (items) => { Object.assign(data, structuredClone(items)); }),
      },
    },
    tabs: { onReplaced: { addListener: (fn) => { listeners.onReplaced = fn; } } },
  };
}

let chrome;
let thumbnail;
beforeEach(async () => {
  vi.resetModules();
  chrome = fakeChrome();
  vi.stubGlobal('chrome', chrome);
  thumbnail = await import('../extension/src/thumbnail.js');
  thumbnail.movePreviewsOfReplacedTabs();
});

// The fake answers at once, so one turn of the event loop runs every move.
const settled = () => new Promise((r) => setImmediate(r));

describe('thumbnail.js, in the service worker', () => {
  it('moves the image found for a tab put to sleep to its new id', async () => {
    const found = { url: 'https://site.test/a', img: 'https://img.test/a.png', at: 1 };
    const other = { url: 'https://site.test/b', img: null, at: 2 };
    chrome.data.previewCache = { 5: found, 6: other };
    // Two tabs put to sleep at once: both moves are kept.
    chrome.listeners.onReplaced(9, 5);
    chrome.listeners.onReplaced(10, 6);
    await settled();
    expect(chrome.data.previewCache).toEqual({ 9: found, 10: other });
  });

  it('writes nothing for a tab without a cached image, or when storage fails', async () => {
    chrome.data.previewCache = { 5: { url: 'https://site.test/a', img: null, at: 1 } };
    chrome.listeners.onReplaced(9, 7);
    await settled();
    chrome.storage.session.get.mockRejectedValueOnce(new Error('no storage'));
    chrome.listeners.onReplaced(9, 5);
    await settled();
    expect(chrome.storage.session.set).not.toHaveBeenCalled();
    // The next move still runs.
    chrome.listeners.onReplaced(9, 5);
    await settled();
    expect(Object.keys(chrome.data.previewCache)).toEqual(['9']);
  });
});

// fetchImage, which fetches the image a page names, against a stub of
// fetch: what it asks for, and which failures it remembers as lasting.
describe('fetchImage', () => {
  const MB8 = 8 * 1024 * 1024;
  const SRC = 'https://img.test/preview.png';
  const PAGE = 'news.test'; // the host of the tab's own page
  // An answer as fetch gives it: the bytes, a status, headers and the
  // address it finally came from (after any redirect).
  const answer = ({ body = new Uint8Array(16), status = 200, headers = { 'content-type': 'image/png' }, url = SRC } = {}) => {
    const response = new Response(body, { status, headers });
    Object.defineProperty(response, 'url', { value: url });
    return response;
  };
  // fetch's stub answers with `respond` and keeps the request's signal.
  let signal;
  const stubFetch = (respond) => {
    const fetch = vi.fn(async (src, options) => {
      signal = options.signal;
      return respond(src, options);
    });
    vi.stubGlobal('fetch', fetch);
    return fetch;
  };
  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks without cookies or a referrer, with the Accept header Chrome sends for images, and gives the bytes', async () => {
    const fetch = stubFetch(() => answer());
    const result = await thumbnail.fetchImage(SRC, PAGE);
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.size).toBe(16);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [src, options] = fetch.mock.calls[0];
    expect(src).toBe(SRC);
    expect(options).toMatchObject({
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8' },
    });
    // Redirects are followed, as fetch does by default.
    expect(options.redirect).toBeUndefined();
    expect(signal.aborted).toBe(false);
  });

  it('remembers a 4xx status as a lasting miss and a 5xx as passing, without reading either body', async () => {
    for (const [status, lasting] of [[400, true], [403, true], [404, true], [410, true], [499, true], [500, false], [503, false], [599, false]]) {
      stubFetch(() => answer({ status, headers: { 'content-type': 'image/png' } }));
      expect(await thumbnail.fetchImage(SRC, PAGE), String(status)).toEqual({ lasting });
      expect(signal.aborted, String(status)).toBe(true);
    }
  });

  it('remembers a page, text, JSON, script or XML instead of an image as a lasting miss', async () => {
    for (const type of ['text/html; charset=utf-8', 'TEXT/HTML', 'text/plain', 'application/json', 'application/javascript', 'application/xml', 'application/xhtml+xml']) {
      stubFetch(() => answer({ headers: { 'content-type': type } }));
      expect(await thumbnail.fetchImage(SRC, PAGE), type).toEqual({ lasting: true });
      expect(signal.aborted, type).toBe(true);
    }
  });

  it('takes an image type, a generic one or none, as <img> decodes those', async () => {
    for (const headers of [{ 'content-type': 'image/svg+xml' }, { 'content-type': 'application/octet-stream' }, { 'content-type': 'binary/octet-stream' }, {}]) {
      stubFetch(() => answer({ headers }));
      const result = await thumbnail.fetchImage(SRC, PAGE);
      expect(result.blob, JSON.stringify(headers)).toBeInstanceOf(Blob);
    }
  });

  it('skips an image whose Content-Length is over 8 MB before reading it, as a lasting miss', async () => {
    stubFetch(() => answer({ headers: { 'content-type': 'image/png', 'content-length': String(MB8 + 1) } }));
    expect(await thumbnail.fetchImage(SRC, PAGE)).toEqual({ lasting: true });
    expect(signal.aborted).toBe(true);
    // 8 MB itself passes.
    stubFetch(() => answer({ headers: { 'content-type': 'image/png', 'content-length': String(MB8) } }));
    expect((await thumbnail.fetchImage(SRC, PAGE)).blob).toBeInstanceOf(Blob);
  });

  it('drops an image over 8 MB that did not say its length, as a lasting miss', async () => {
    stubFetch(() => answer({ body: new Uint8Array(MB8 + 1), headers: {} }));
    expect(await thumbnail.fetchImage(SRC, PAGE)).toEqual({ lasting: true });
    stubFetch(() => answer({ body: new Uint8Array(MB8), headers: {} }));
    expect((await thumbnail.fetchImage(SRC, PAGE)).blob.size).toBe(MB8);
  });

  // fetch rejects once its signal aborts, while waiting for the answer or
  // while reading the body.
  const abortable = () => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
  });

  it('gives up on an answer slower than 10 s, as a miss that may pass', async () => {
    vi.useFakeTimers();
    stubFetch(() => abortable());
    let result;
    thumbnail.fetchImage(SRC, PAGE).then((r) => { result = r; });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(signal.aborted).toBe(false);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(signal.aborted).toBe(true);
    expect(result).toEqual({ lasting: false });
  });

  it('counts the time to read the body in those 10 s', async () => {
    vi.useFakeTimers();
    stubFetch(() => ({ ok: true, status: 200, url: SRC, headers: new Headers({ 'content-type': 'image/png' }), blob: abortable }));
    let result;
    thumbnail.fetchImage(SRC, PAGE).then((r) => { result = r; });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toEqual({ lasting: false });
  });

  it('takes a network failure, before the answer or in its body, as a miss that may pass', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await thumbnail.fetchImage(SRC, PAGE)).toEqual({ lasting: false });
    stubFetch(() => ({ ok: true, status: 200, url: SRC, headers: new Headers(), blob: () => Promise.reject(new TypeError('network error')) }));
    expect(await thumbnail.fetchImage(SRC, PAGE)).toEqual({ lasting: false });
  });

  it('does not ask a local host for a page elsewhere, and remembers that as a lasting miss', async () => {
    const fetch = stubFetch(() => answer());
    for (const src of ['http://localhost/a.png', 'http://127.0.0.1:8080/a.png', 'http://0x7f.1/a.png', 'http://192.168.1.1/cam.jpg',
      'http://10.0.0.2/a.png', 'http://[::1]/a.png', 'http://[::ffff:7f00:1]/a.png', 'http://printer.local/a.png']) {
      expect(await thumbnail.fetchImage(src, PAGE), src).toEqual({ lasting: true });
    }
    // Nor one local host for a page on another.
    expect(await thumbnail.fetchImage('http://192.168.1.1/a.png', 'localhost')).toEqual({ lasting: true });
    expect(await thumbnail.fetchImage('http://localhost:3000/a.png', '127.0.0.1')).toEqual({ lasting: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("asks a local host for a page on that same host: a page you develop locally shows its own image", async () => {
    const fetch = stubFetch((src) => answer({ url: src }));
    expect((await thumbnail.fetchImage('http://localhost:3000/og.png', 'localhost')).blob).toBeInstanceOf(Blob);
    expect((await thumbnail.fetchImage('http://192.168.1.20/cam.jpg', '192.168.1.20')).blob).toBeInstanceOf(Blob);
    expect((await thumbnail.fetchImage('http://[::1]:8000/og.png', '[::1]')).blob).toBeInstanceOf(Blob);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('drops an image a redirect brought from a local host other than the page\'s, as a lasting miss', async () => {
    stubFetch(() => answer({ url: 'http://192.168.1.1/cam.jpg' }));
    expect(await thumbnail.fetchImage(SRC, PAGE)).toEqual({ lasting: true });
    expect(signal.aborted).toBe(true);
    stubFetch(() => answer({ url: 'http://192.168.1.1/cam.jpg' }));
    expect(await thumbnail.fetchImage('http://localhost:3000/og.png', 'localhost')).toEqual({ lasting: true });
  });

  it("keeps an image a redirect brought from a public host or from the page's own", async () => {
    stubFetch(() => answer({ url: 'https://cdn.test/preview.png' }));
    expect((await thumbnail.fetchImage(SRC, PAGE)).blob).toBeInstanceOf(Blob);
    stubFetch(() => answer({ url: 'http://localhost:3000/og.png' }));
    expect((await thumbnail.fetchImage('https://img.test/og', 'localhost')).blob).toBeInstanceOf(Blob);
  });
});
