// thumbnail.js
import { state } from './state.js';
import { isCapturableUrl, isSleeping } from './utils.js';

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

function remember(tab, imageUrl) {
  // Incognito pages are never kept beyond the overview that showed them.
  if (tab.incognito) return;
  cache[tab.id] = { url: tab.url, img: imageUrl || null, at: Date.now() };
  // Drop entries for tabs that no longer exist so the cache stays small.
  const openIds = new Set(state.allTabs.map((t) => String(t.id)));
  for (const id of Object.keys(cache)) {
    if (!openIds.has(id)) delete cache[id];
  }
  chrome.storage.session.set({ [CACHE_KEY]: cache }).catch(() => {});
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

async function loadThumbnail(tab, tile) {
  tile.dataset.thumb = 'done';
  const img = tile.querySelector('.thumbnail');
  // Pages we cannot read keep the placeholder (title + hostname on a gradient).
  if (!img || !isCapturableUrl(tab.url)) return;

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

  const imageUrl = webImageUrl(await extractPreviewImage(tab.id));
  remember(tab, imageUrl);
  if (imageUrl) showImage(img, tab, imageUrl);
}

// Accept only an http(s) address of sane length: a page could hand back a
// huge data: URL, which would fill the session cache.
function webImageUrl(url) {
  return typeof url === 'string' && url.length <= 2048 && isCapturableUrl(url) ? url : null;
}

function showImage(img, tab, src) {
  img.onload = () => requestAnimationFrame(() => img.classList.add('loaded'));
  img.onerror = () => {
    // A dead image URL: hide it and remember the miss so we do not retry it.
    img.style.display = 'none';
    remember(tab, null);
  };
  img.src = src;
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

        // Special case for YouTube
        if (window.location.hostname.includes('youtube.com')) {
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

        // 2. Try other semantic link tags
        const linkSelectors = ['link[rel="image_src"]', 'link[rel="apple-touch-icon"]'];
        for (const selector of linkSelectors) {
          const link = document.querySelector(selector);
          if (link && link.href) return link.href;
        }

        // 3. Look for video posters
        const video = document.querySelector('video[poster]');
        if (video && video.poster) return video.poster;

        // 4. Check for background-image on large elements
        const largeElements = Array.from(document.querySelectorAll('body, body > *, body > * > *'));
        for (const el of largeElements) {
          const style = window.getComputedStyle(el);
          if (style.backgroundImage && style.backgroundImage.startsWith('url("')) {
            const url = style.backgroundImage.slice(5, -2);
            if (el.clientWidth > 200 && el.clientHeight > 150) return url;
          }
        }

        // 5. Look for largest image on page
        const images = Array.from(document.images);
        let bestImage = null;
        let bestArea = 0;
        for (const img of images) {
          if (!img.complete || !img.naturalWidth || !img.naturalHeight) continue;
          const aspectRatio = img.naturalWidth / img.naturalHeight;
          const area = img.naturalWidth * img.naturalHeight;
          if (area > bestArea && img.naturalWidth > 300 && img.naturalHeight > 150 && aspectRatio > 0.5 && aspectRatio < 3.0) {
            bestImage = img;
            bestArea = area;
          }
        }
        if (bestImage && bestImage.currentSrc) return bestImage.currentSrc;

        // Fallback: If no suitable image is found, signal to use placeholder
        return null;
      }
    });
    return results[0]?.result || null;
  } catch (err) {
    console.debug('Script injection failed for tab', tabId, err.message);
    // Returning null keeps the text/placeholder preview, instead of caching a
    // blank image as a "real" thumbnail.
    return null;
  }
}
