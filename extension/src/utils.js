// utils.js

export function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url || '';
  }
}

export function isCapturableUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// A tab is "sleeping" when Chrome has discarded it (Memory Saver) or it was
// restored without loading. Such tabs cannot run scripts until reloaded.
export function isSleeping(tab) {
  return Boolean(tab.discarded) || tab.status === 'unloaded';
}

function hueOf(seed) {
  return Array.from(seed || '').reduce((acc, char) => acc + char.charCodeAt(0), 0) % 360;
}

// A color for a site from its name, for its icon card until the icon's own
// color is known (and for pages without an icon).
export function hueColor(seed) {
  return `hsl(${hueOf(seed)} 45% 55%)`;
}

// A site's icon from Chrome's own favicon store (the "favicon" permission):
// no network request, and it works for sleeping tabs. Chrome keeps 16 and
// 32 px icons and scales them, so it is shown small.
export function faviconUrl(pageUrl, size = 32) {
  return `${chrome.runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent(pageUrl)}&size=${size}`;
}

// An icon's main color: the average of its opaque, colored pixels (white,
// black and grey are skipped, as Chrome's own fallback icons do), or null when
// it has too few of them. RGBA data, as from getImageData.
export function dominantColor(data) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const max = Math.max(data[i], data[i + 1], data[i + 2]);
    const min = Math.min(data[i], data[i + 1], data[i + 2]);
    if (data[i + 3] < 200 || max - min < 40) continue;
    r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
  }
  if (n < 12) return null;
  return `rgb(${Math.round(r / n)} ${Math.round(g / n)} ${Math.round(b / n)})`;
}

export function createPlaceholderIcon(hostname) {
  const letter = (hostname.startsWith('www.') ? hostname.substring(4) : hostname)[0]?.toUpperCase() || '?';
  const hue = hueOf(hostname);

  // Define two colors for a subtle gradient, derived from the hostname hue
  const color1 = `hsl(${hue}, 35%, 20%)`;
  const color2 = `hsl(${(hue + 40) % 360}, 40%, 15%)`;
  const textColor = `hsl(${hue}, 20%, 85%)`;

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${color1}" />
          <stop offset="100%" stop-color="${color2}" />
        </linearGradient>
      </defs>
      <rect width="16" height="16" rx="3" fill="url(#grad)" />
      <text x="50%" y="50%" dominant-baseline="central" text-anchor="middle"
            font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
            font-size="9" font-weight="600" fill="${textColor}">
        ${letter}
      </text>
    </svg>
  `.trim();
  // URL-encode rather than base64: btoa throws on non-Latin1 characters
  // (e.g. the first letter of an IDN hostname), while encodeURIComponent
  // handles all Unicode safely.
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
