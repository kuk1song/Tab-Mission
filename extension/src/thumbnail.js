// thumbnail.js
import { state } from './state.js';
import { isCapturableUrl, createPlaceholderIcon, getHostname } from './utils.js';

const captureCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const NOT_FOUND_URL = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
let thumbnailObserver = null;

export function startThumbnailCapture() {
  const gridEl = document.getElementById('grid');
  if (thumbnailObserver) {
    thumbnailObserver.disconnect();
  }

  thumbnailObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const tile = entry.target;
        const tabId = parseInt(tile.getAttribute('data-tab-id'));
        const tab = state.filteredTabs.find(t => t.id === tabId);
        const img = tile.querySelector('.thumbnail');
        
        if (tab && img) {
          loadThumbnail(tab, img);
        }
        observer.unobserve(tile);
      }
    });
  }, { root: gridEl, rootMargin: '0px 0px 300px 0px' });

  const tilesWithThumbnails = gridEl.querySelectorAll('.tile .thumbnail');
  tilesWithThumbnails.forEach(img => {
    const tile = img.closest('.tile');
    if (tile) {
      thumbnailObserver.observe(tile);
    }
  });
}

async function loadThumbnail(tab, imgElement) {
  const previewElement = imgElement.parentElement;
  const textPreviewElement = previewElement.querySelector('.text-preview');

  // Keep the canvas placeholder background (title top-left, URL bottom-left)
  // and simply hide the <img> when we cannot load a real thumbnail.
  const showTextFallback = () => {
    imgElement.style.display = 'none';
    if (textPreviewElement) textPreviewElement.style.display = 'none';
    // Do NOT clear previewElement.style.backgroundImage here;
    // createPreviewElement already set a placeholder that matches sleeping tabs.
  };

  const cacheKey = `${tab.id}|${tab.url}`;
  const cached = captureCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
    // If found in cache, directly use the dataUrl for both src and background
    imgElement.src = cached.dataUrl;
    imgElement.style.backgroundImage = `url('${cached.dataUrl}')`;
    imgElement.classList.add('loaded');
    return;
  }
  
  if (!isCapturableUrl(tab.url)) {
    showTextFallback();
    return;
  }
  
  try {
    const result = await extractPreviewImage(tab.id);
    if (result) {
      const { imageUrl, dataUrl } = result;
      const finalUrl = imageUrl || dataUrl;
      
      if (finalUrl) {
        imgElement.style.backgroundImage = `url('${finalUrl}')`;
        imgElement.src = finalUrl;
        imgElement.onload = () => {
          requestAnimationFrame(() => imgElement.classList.add('loaded'));
          captureCache.set(cacheKey, { dataUrl: finalUrl, timestamp: Date.now() });
        };
        imgElement.onerror = () => {
          showTextFallback();
        };
      } else {
        showTextFallback();
      }
    } else {
      showTextFallback();
    }
  } catch (err) {
    console.debug('Thumbnail capture failed for tab', tab.id, err.message);
    showTextFallback();
  }
}

async function extractPreviewImage(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Special case for YouTube
        if (window.location.hostname.includes('youtube.com')) {
          const videoId = new URLSearchParams(window.location.search).get('v');
          if (videoId) {
            return { imageUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` };
          }
        }
        
        // 1. Try OpenGraph or Twitter Card image
        const metaSelectors = [
          'meta[property="og:image"]', 'meta[property="og:image:secure_url"]',
          'meta[name="twitter:image"]', 'meta[name="twitter:image:src"]'
        ];
        for (const selector of metaSelectors) {
          const meta = document.querySelector(selector);
          if (meta && meta.content) return { imageUrl: meta.content };
        }

        // 2. Try other semantic link tags
        const linkSelectors = ['link[rel="image_src"]', 'link[rel="apple-touch-icon"]'];
        for (const selector of linkSelectors) {
          const link = document.querySelector(selector);
          if (link && link.href) return { imageUrl: link.href };
        }

        // 3. Look for video posters
        const video = document.querySelector('video[poster]');
        if (video && video.poster) return { imageUrl: video.poster };

        // 4. Check for background-image on large elements
        const largeElements = Array.from(document.querySelectorAll('body, body > *, body > * > *'));
        for (const el of largeElements) {
          const style = window.getComputedStyle(el);
          if (style.backgroundImage && style.backgroundImage.startsWith('url("')) {
            const url = style.backgroundImage.slice(5, -2);
            if (el.clientWidth > 200 && el.clientHeight > 150) return { imageUrl: url };
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
        if (bestImage && bestImage.src) return { imageUrl: bestImage.src };

        // Fallback: If no suitable image is found, signal to use placeholder
        return null;
      }
    });
    return results[0].result;
  } catch (err) {
    console.debug('Script injection failed for tab', tabId, err.message);
    return { imageUrl: NOT_FOUND_URL };
  }
}
