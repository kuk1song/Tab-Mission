// utils.js

export function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url || '';
  }
}

export function isValidIconUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'data:';
  } catch {
    return false;
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

// Placeholder backdrop for tiles without a preview image: a dark vertical
// gradient tinted per hostname. Pure CSS, so building hundreds of tiles costs
// nothing (the old per-tile canvas + JPEG encode blocked the main thread).
export function generateGradient(seed) {
  const hue = hueOf(seed);
  return `linear-gradient(180deg, hsl(${hue}, 30%, 25%), hsl(${hue}, 30%, 15%))`;
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
