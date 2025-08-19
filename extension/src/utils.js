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

export function getPlaceholderDataUrl(title, hostname) {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 200;
  const ctx = canvas.getContext('2d');
  
  const gradient = ctx.createLinearGradient(0, 0, 0, 200);
  const hue = Array.from(hostname).reduce((acc, char) => acc + char.charCodeAt(0), 0) % 360;
  gradient.addColorStop(0, `hsl(${hue}, 30%, 25%)`);
  gradient.addColorStop(1, `hsl(${hue}, 30%, 15%)`);
  
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 320, 200);
  
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const titleText = title.slice(0, 30) + (title.length > 30 ? '...' : '');
  ctx.fillText(titleText, 16, 40);
  
  ctx.fillStyle = '#a0aec0';
  ctx.font = '12px monospace';
  ctx.fillText(hostname, 16, 180);
  
  return canvas.toDataURL('image/jpeg', 0.8);
}

export function generateGradient(seed) {
  const hue = Array.from(seed).reduce((acc, char) => acc + char.charCodeAt(0), 0) % 360;
  return `linear-gradient(135deg, hsl(${hue}, 40%, 25%), hsl(${hue}, 40%, 15%))`;
}

export function createPlaceholderIcon(hostname) {
  const letter = (hostname.startsWith('www.') ? hostname.substring(4) : hostname)[0]?.toUpperCase() || '?';
  const hue = Array.from(hostname).reduce((acc, char) => acc + char.charCodeAt(0), 0) % 360;
  
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
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
