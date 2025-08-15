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
