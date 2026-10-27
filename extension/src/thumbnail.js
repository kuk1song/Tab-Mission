// thumbnail.js
import { state } from './state.js';
import { isCapturableUrl, isSleeping, faviconUrl, dominantColor } from './utils.js';
import { readCover } from './covers.js';

// Preview image URLs are cached in chrome.storage.session (kept in memory and
// cleared when the browser quits), so reopening the overview shows previews
// instantly instead of injecting a script into every visible tab again.
const CACHE_KEY = 'previewCache';
const HIT_TTL_MS = 30 * 60 * 1000; // a found image is reused for 30 minutes
const MISS_TTL_MS = 5 * 60 * 1000; // a page without one is retried after 5
let cache = {};
let cacheLoaded = null;
let thumbnailObserver = null;

function loadCache() {
  cacheLoaded ??= chrome.storage.session
    .get(CACHE_KEY)
    .then((stored) => { cache = stored[CACHE_KEY] || {}; })
    .catch(() => {});
  return cacheLoaded;
}

let saving = 0; // the pending write of the cache

function remember(tab, imageUrl) {
  cache[tab.id] = { url: tab.url, img: imageUrl || null, at: Date.now() };
  // Drop entries for tabs that no longer exist so the cache stays small.
  const openIds = new Set(state.allTabs.map((t) => String(t.id)));
  for (const id of Object.keys(cache)) {
    if (!openIds.has(id)) delete cache[id];
  }
  // One write for a burst of answers (the cards of a window open at once),
  // not one per card: each write stores the whole cache.
  if (saving) return;
  saving = setTimeout(() => {
    saving = 0;
    chrome.storage.session.set({ [CACHE_KEY]: cache }).catch(() => {});
  }, 50);
}

// The service worker's side (background.js): a tab put to sleep is swapped
// for a new one with a new id, and a sleeping tab cannot be asked again, so
// the image found for it moves to the new id. (A Tab Mission window open
// meanwhile stores its own copy of the cache over this.)
let moves = Promise.resolve(); // one at a time, so none is lost

export function movePreviewsOfReplacedTabs() {
  chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
    moves = moves.then(async () => {
      const { [CACHE_KEY]: stored } = await chrome.storage.session.get(CACHE_KEY);
      if (!stored?.[removedTabId]) return;
      stored[addedTabId] = stored[removedTabId];
      delete stored[removedTabId];
      await chrome.storage.session.set({ [CACHE_KEY]: stored });
    }).catch(() => {});
  });
}

// Watch tiles that have not been handled yet; each loads its preview once,
// when it first scrolls near the viewport. Tiles are reused across renders,
// so filtering never reloads or flickers a preview.
export function observeTiles(tiles) {
  if (!thumbnailObserver) {
    thumbnailObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const tile = entry.target;
        observer.unobserve(tile);
        const tabId = parseInt(tile.getAttribute('data-tab-id'), 10);
        const tab = state.allTabs.find((t) => t.id === tabId);
        if (tab) loadThumbnail(tab, tile);
      });
    }, { root: document.getElementById('grid'), rootMargin: '0px 0px 300px 0px' });
  }
  for (const tile of tiles) {
    if (tile.dataset.thumb) continue;
    tile.dataset.thumb = 'pending';
    thumbnailObserver.observe(tile);
  }
}

// Grouped by site, a recent tab has two tiles, often in view together. While
// one asks for its cover, the page's own image or that image's bytes, the
// other waits for the same answer instead of asking again. Nothing is kept
// once answered.
const coverReads = new Map(); // tab id -> its cover (readCover), in flight
const imageLookups = new Map(); // tab id -> the image its page names, in flight
const imageFetches = new Map(); // address -> fetchImage's answer, in flight

function shared(map, key, start) {
  if (!map.has(key)) {
    const promise = start();
    map.set(key, promise);
    promise.finally(() => map.delete(key)).catch(() => {});
  }
  return map.get(key);
}

async function loadThumbnail(tab, tile) {
  tile.dataset.thumb = 'done';
  const img = tile.querySelector('.thumbnail');
  // Pages we cannot read keep their icon card (a letter on a color).
  if (!img || !isCapturableUrl(tab.url)) return;

  // A picture of the page as you last saw it (covers.js) says more than the
  // image the page declares for itself, and needs nothing from the tab, so
  // it also serves sleeping tabs.
  const cover = await shared(coverReads, tab.id, () => readCover(tab));
  if (cover) {
    img.classList.add('cover');
    img.onload = () => requestAnimationFrame(() => img.classList.add('loaded'));
    img.onerror = () => {
      img.style.display = 'none';
      tintIcon(tab, tile.querySelector('.preview')); // the icon card shows after all
    };
    img.src = cover;
    return;
  }
  tintIcon(tab, tile.querySelector('.preview'));
  // An incognito tab's page is never read and its images never loaded from
  // here (this window belongs to the normal profile, with its cache and
  // cookies); its card keeps the icon card.
  if (tab.incognito) return;

  await loadCache();
  const hit = cache[tab.id];
  const sameUrl = hit && hit.url === tab.url;

  // A sleeping tab cannot run scripts, and injecting would risk waking it, so
  // it shows whatever was cached before it slept, however old.
  if (isSleeping(tab)) {
    if (sameUrl && hit.img) showImage(img, tab, hit.img);
    return;
  }

  if (sameUrl && Date.now() - hit.at < (hit.img ? HIT_TTL_MS : MISS_TTL_MS)) {
    if (hit.img) showImage(img, tab, hit.img);
    return;
  }

  const imageUrl = await shared(imageLookups, tab.id, async () => webImageUrl(await extractPreviewImage(tab.id)));
  remember(tab, imageUrl);
  if (imageUrl) showImage(img, tab, imageUrl);
}

// The icon card takes the color of the site's icon (from Chrome's own store,
// so the canvas can read it), worked out once per icon for this window. Not
// per site: Docs, Sheets and Slides share docs.google.com, not their icons.
const iconColors = new Map();

async function tintIcon(tab, preview) {
  const key = tab.favIconUrl || tab.url;
  if (!iconColors.has(key)) iconColors.set(key, iconColor(tab.url));
  const color = await iconColors.get(key);
  if (color && preview) preview.style.setProperty('--c', color);
}

async function iconColor(url) {
  try {
    const icon = new Image();
    icon.src = faviconUrl(url);
    await icon.decode();
    const context = new OffscreenCanvas(32, 32).getContext('2d', { willReadFrequently: true });
    context.drawImage(icon, 0, 0, 32, 32);
    return dominantColor(context.getImageData(0, 0, 32, 32).data);
  } catch {
    return null;
  }
}

// Accept only an http(s) address of sane length: a page could hand back a
// huge data: URL, which would fill the session cache.
function webImageUrl(url) {
  return typeof url === 'string' && url.length <= 2048 && isCapturableUrl(url) ? url : null;
}

// A page's own image is shown unless it is small or about square: a social
// preview (1200 × 630), a video frame or a portrait photo says something
// about the page, while a square one is mostly a logo, which says less than
// the icon card underneath.
const MIN_WIDTH = 300;
const SQUARE = [0.8, 1.25]; // width to height

async function showImage(img, tab, src) {
  img.dataset.from = src; // the address the page named
  const { blob, lasting } = await shared(imageFetches, src, () => fetchImage(src));
  const local = blob && URL.createObjectURL(blob);
  // A dead or refused address, or an image that is not one or is a logo:
  // hide it and remember the miss so we do not retry it.
  const miss = () => {
    img.style.display = 'none';
    remember(tab, null);
  };
  if (!local) {
    // A network failure or a slow server may pass: hide the image this
    // time, but keep what is remembered (a sleeping tab cannot look again).
    if (lasting) miss();
    else img.style.display = 'none';
    return;
  }
  img.onload = () => {
    URL.revokeObjectURL(local);
    const ratio = img.naturalWidth / img.naturalHeight;
    if (img.naturalWidth < MIN_WIDTH || (ratio >= SQUARE[0] && ratio <= SQUARE[1])) return miss();
    requestAnimationFrame(() => img.classList.add('loaded'));
  };
  img.onerror = () => {
    URL.revokeObjectURL(local);
    miss();
  };
  img.src = local;
}

// The image a page names is fetched without cookies or a referrer: the page
// chooses the address, which could be one that acts on the user's account
// elsewhere. It is then shown from memory. Images over MAX_IMAGE_BYTES, or
// slower than IMAGE_TIMEOUT_MS, are skipped. Resolves { blob }, or
// { lasting } telling whether the failure will not pass (an error status, a
// page instead of an image, an image too big).
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 10_000;

// Image servers often send no type or a generic one; <img> decodes those,
// so they pass too, and a decoding failure counts as a miss (onerror).
const NOT_AN_IMAGE = /^(text\/|application\/(json|javascript|xml|xhtml))/i;

async function fetchImage(src) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), IMAGE_TIMEOUT_MS);
  try {
    const response = await fetch(src, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      // What Chrome itself sends for an image, for servers that choose by it.
      headers: { accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8' },
      signal: abort.signal,
    });
    const type = response.headers.get('content-type') || '';
    if (!response.ok || NOT_AN_IMAGE.test(type) || Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) {
      abort.abort();
      return { lasting: response.status < 500 };
    }
    const blob = await response.blob();
    if (blob.size > MAX_IMAGE_BYTES) return { lasting: true };
    return { blob };
  } catch {
    return { lasting: false }; // offline, refused, or too slow
  } finally {
    clearTimeout(timer);
  }
}

async function extractPreviewImage(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // og:image and friends may be relative; resolve against the page.
        const absolute = (url) => {
          try {
            return new URL(url, document.baseURI).href;
          } catch {
            return null;
          }
        };

        // YouTube watch pages: the video's own thumbnail. Match the domain
        // exactly, so "notyoutube.com" or "youtube.com.example" never do.
        const host = window.location.hostname;
        if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
          const videoId = new URLSearchParams(window.location.search).get('v');
          if (videoId) {
            return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
          }
        }

        // 1. Try OpenGraph or Twitter Card image
        const metaSelectors = [
          'meta[property="og:image"]', 'meta[property="og:image:secure_url"]',
          'meta[name="twitter:image"]', 'meta[name="twitter:image:src"]'
        ];
        for (const selector of metaSelectors) {
          const meta = document.querySelector(selector);
          if (meta && meta.content) return absolute(meta.content);
        }

        // 2. The older way to name a page's preview image
        const link = document.querySelector('link[rel="image_src"]');
        if (link && link.href) return link.href;

        // 3. A video's poster frame
        const video = document.querySelector('video[poster]');
        if (video && video.poster) return video.poster;

        // None: the card keeps its icon card.
        return null;
      }
    });
    return results[0]?.result || null;
  } catch (err) {
    console.debug('Script injection failed for tab', tabId, err.message);
    // Returning null keeps the icon card, instead of caching a blank image as
    // a "real" thumbnail.
    return null;
  }
}
