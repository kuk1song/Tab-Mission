// Tab Mosaic Overview - Simplified design with progressive enhancement
let allTabs = [];
let filtered = [];
let selectedIndex = 0;
let currentWindowId = null;

// UI Elements
const searchEl = document.getElementById('search');
const gridEl = document.getElementById('grid');
const toggleHideDiscarded = document.getElementById('toggle-hide-discarded');
const toggleCurrentWindow = document.getElementById('toggle-current-window');
const toggleThumbnails = document.getElementById('toggle-thumbnails');
const toggleArt = document.getElementById('toggle-art');

// Thumbnail capture state
const captureCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function init() {
  console.log('Initializing Tab Mosaic Overview...');
  await fetchAllTabs();
  console.log(`Fetched ${allTabs.length} tabs`);
  applyFilters();
  console.log(`After filtering: ${filtered.length} tabs`);
  // Ensure default Thumbnails ON
  try {
    if (toggleThumbnails && !toggleThumbnails.checked) {
      toggleThumbnails.checked = true;
    }
  } catch {}
  render();
  if (toggleThumbnails?.checked) startThumbnailCapture();
  
  // Setup event listeners
  searchEl.addEventListener('input', () => {
    applyFilters();
    render();
  });
  
  toggleHideDiscarded.addEventListener('change', () => {
    applyFilters();
    render();
  });
  
  toggleCurrentWindow.addEventListener('change', async () => {
    await fetchAllTabs(); // Re-fetch tabs when window scope changes
    applyFilters();
    render();
  });
  
  toggleThumbnails.addEventListener('change', () => {
    render(); // Re-render to show/hide thumbnails
    if (toggleThumbnails.checked) {
      startThumbnailCapture();
    }
  });
  
  // Keyboard navigation
  document.addEventListener('keydown', handleKeydown);

  // Art mode toggle
  if (toggleArt) {
    toggleArt.addEventListener('change', () => {
      applyArtLayout();
    });
  }
}

async function fetchAllTabs() {
  try {
    // Always fetch all tabs first, then filter in applyFilters()
    allTabs = await chrome.tabs.query({});
    
    // Get current window ID for potential filtering
    try {
      const current = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
      currentWindowId = current?.id || null;
    } catch {
      currentWindowId = null;
    }
  } catch (err) {
    console.warn('Failed to fetch tabs:', err);
    allTabs = [];
  }
}

function applyFilters() {
  let tabs = [...allTabs];
  
  // Filter current window
  if (toggleCurrentWindow.checked && currentWindowId) {
    tabs = tabs.filter(tab => tab.windowId === currentWindowId);
  }
  
  // Filter sleeping tabs
  if (toggleHideDiscarded.checked) {
    tabs = tabs.filter(tab => !tab.discarded);
  }
  
  // Search filter
  const query = searchEl.value.toLowerCase().trim();
  if (query) {
    tabs = tabs.filter(tab => 
      (tab.title || '').toLowerCase().includes(query) ||
      (tab.url || '').toLowerCase().includes(query)
    );
  }
  
  filtered = tabs;
  selectedIndex = Math.min(selectedIndex, Math.max(0, filtered.length - 1));
}

function render() {
  console.log(`Rendering ${filtered.length} tabs out of ${allTabs.length} total tabs`);
  gridEl.innerHTML = '';
  
  if (filtered.length === 0) {
    const emptyMessage = document.createElement('div');
    emptyMessage.style.cssText = 'padding: 40px; text-align: center; color: #9aa0a6; font-size: 14px;';
    emptyMessage.textContent = allTabs.length === 0 
      ? 'No tabs found. Please check permissions.'
      : 'No tabs match current filters.';
    gridEl.appendChild(emptyMessage);
    return;
  }
  
  filtered.forEach((tab, index) => {
    const tile = document.createElement('button');
    tile.className = 'tile' + (index === selectedIndex ? ' selected' : '');
    tile.style.setProperty('--stagger', `${(index % 10) * 20}ms`);
    tile.setAttribute('data-tab-id', String(tab.id));
    tile.addEventListener('click', () => activateTab(tab));
    
    // Create preview area
    const preview = document.createElement('div');
    preview.className = 'preview';
    
    if (toggleThumbnails.checked) {
      // Show thumbnail if enabled
      const img = document.createElement('img');
      img.className = 'thumbnail';
      img.alt = 'Tab preview';
      img.src = getPlaceholderDataUrl(tab.title || 'Untitled', getHostname(tab.url));
      preview.appendChild(img);
      
      // Try to load actual thumbnail
      loadThumbnail(tab, img);
    } else {
      // Show text-only preview
      const textPreview = document.createElement('div');
      textPreview.className = 'text-preview';
      textPreview.style.background = generateGradient(tab.title || getHostname(tab.url));
      
      const title = document.createElement('div');
      title.className = 'preview-title';
      title.textContent = tab.title || 'Untitled';
      textPreview.appendChild(title);
      
      const url = document.createElement('div');
      url.className = 'preview-url';
      url.textContent = getHostname(tab.url);
      textPreview.appendChild(url);
      
      preview.appendChild(textPreview);
    }
    
    tile.appendChild(preview);
    
    // Create metadata
    const meta = document.createElement('div');
    meta.className = 'meta';
    
    const titleRow = document.createElement('div');
    titleRow.className = 'title-row';
    
    // Favicon
    if (tab.favIconUrl && isValidIconUrl(tab.favIconUrl)) {
      const favicon = document.createElement('img');
      favicon.className = 'favicon';
      favicon.src = tab.favIconUrl;
      favicon.alt = '';
      titleRow.appendChild(favicon);
    }
    
    // Title
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = tab.title || 'Untitled';
    titleRow.appendChild(title);
    
    meta.appendChild(titleRow);
    
    // URL
    const url = document.createElement('div');
    url.className = 'url';
    url.textContent = getHostname(tab.url);
    meta.appendChild(url);
    
    tile.appendChild(meta);
    gridEl.appendChild(tile);
  });

  // Apply art layout if enabled
  applyArtLayout();
}

async function loadThumbnail(tab, imgElement) {
  const cacheKey = `${tab.id}|${tab.url}`;
  
  // Check cache first
  const cached = captureCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
    imgElement.src = cached.dataUrl;
    imgElement.classList.add('loaded');
    return;
  }
  
  // Skip non-web URLs
  if (!isCapturableUrl(tab.url)) {
    return;
  }
  
  try {
    // Use simple DOM-based thumbnail approach
    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPreviewImage
    });
    
    if (result && result[0] && result[0].result) {
      const { imageUrl, dataUrl } = result[0].result;
      
      if (imageUrl) {
        // Try to load external image
        try {
          const response = await fetch(imageUrl, { mode: 'no-cors' });
          const blob = await response.blob();
          const objectUrl = URL.createObjectURL(blob);
          imgElement.src = objectUrl;
          imgElement.classList.add('loaded');
          captureCache.set(cacheKey, { dataUrl: objectUrl, timestamp: Date.now() });
        } catch {
          // Fallback to direct URL
          imgElement.src = imageUrl;
          imgElement.classList.add('loaded');
        }
      } else if (dataUrl) {
        imgElement.src = dataUrl;
        imgElement.classList.add('loaded');
        captureCache.set(cacheKey, { dataUrl, timestamp: Date.now() });
      }
    }
  } catch (err) {
    // Silently fail - keep placeholder
    console.debug('Thumbnail capture failed for tab', tab.id, err.message);
  }
}

// Injected function to extract preview image from page
function extractPreviewImage() {
  // Look for Open Graph image
  const ogImage = document.querySelector('meta[property="og:image"]');
  if (ogImage && ogImage.content) {
    return { imageUrl: ogImage.content };
  }
  
  // Look for Twitter image
  const twitterImage = document.querySelector('meta[name="twitter:image"]');
  if (twitterImage && twitterImage.content) {
    return { imageUrl: twitterImage.content };
  }
  
  // Look for largest image on page
  const images = Array.from(document.images);
  let bestImage = null;
  let bestArea = 0;
  
  for (const img of images) {
    const rect = img.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area > bestArea && rect.width >= 200 && rect.height >= 150) {
      bestImage = img;
      bestArea = area;
    }
  }
  
  if (bestImage && bestImage.src) {
    return { imageUrl: bestImage.src };
  }
  
  // Fallback: create simple text preview
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 200;
  const ctx = canvas.getContext('2d');
  
  // Simple gradient background
  const gradient = ctx.createLinearGradient(0, 0, 0, 200);
  gradient.addColorStop(0, '#2d3748');
  gradient.addColorStop(1, '#1a202c');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 320, 200);
  
  // Add title text
  ctx.fillStyle = '#ffffff';
  ctx.font = '16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(document.title || location.hostname, 16, 40);
  
  // Add URL
  ctx.fillStyle = '#a0aec0';
  ctx.font = '12px monospace';
  ctx.fillText(location.hostname, 16, 180);
  
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.8) };
}

function startThumbnailCapture() {
  // Start capturing thumbnails for visible tiles
  const tiles = Array.from(gridEl.querySelectorAll('.tile'));
  tiles.forEach(tile => {
    const tabId = parseInt(tile.getAttribute('data-tab-id'));
    const tab = filtered.find(t => t.id === tabId);
    const img = tile.querySelector('.thumbnail');
    if (tab && img) {
      loadThumbnail(tab, img);
    }
  });
}

function activateTab(tab) {
  chrome.tabs.update(tab.id, { active: true });
  chrome.runtime.sendMessage({ type: 'close-overview-window' });
}

function handleKeydown(e) {
  switch (e.key) {
    case 'Escape':
      chrome.runtime.sendMessage({ type: 'close-overview-window' });
      break;
    case 'Enter':
      if (filtered[selectedIndex]) {
        activateTab(filtered[selectedIndex]);
      }
      break;
    case 'ArrowUp':
      e.preventDefault();
      selectedIndex = Math.max(0, selectedIndex - getColumnCount());
      updateSelection();
      break;
    case 'ArrowDown':
      e.preventDefault();
      selectedIndex = Math.min(filtered.length - 1, selectedIndex + getColumnCount());
      updateSelection();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      selectedIndex = Math.max(0, selectedIndex - 1);
      updateSelection();
      break;
    case 'ArrowRight':
      e.preventDefault();
      selectedIndex = Math.min(filtered.length - 1, selectedIndex + 1);
      updateSelection();
      break;
  }
}

function updateSelection() {
  const tiles = Array.from(gridEl.querySelectorAll('.tile'));
  tiles.forEach((tile, index) => {
    tile.classList.toggle('selected', index === selectedIndex);
  });
  
  // Scroll selected tile into view
  const selectedTile = tiles[selectedIndex];
  if (selectedTile) {
    selectedTile.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function getColumnCount() {
  // Estimate column count from CSS grid
  const style = getComputedStyle(gridEl);
  const columns = style.gridTemplateColumns.split(' ').length;
  return Math.max(1, columns);
}

// Utility functions
function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url || '';
  }
}

function isValidIconUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'data:';
  } catch {
    return false;
  }
}

function isCapturableUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function getPlaceholderDataUrl(title, hostname) {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 200;
  const ctx = canvas.getContext('2d');
  
  // Generate color based on hostname
  const gradient = ctx.createLinearGradient(0, 0, 0, 200);
  const hue = Array.from(hostname).reduce((acc, char) => acc + char.charCodeAt(0), 0) % 360;
  gradient.addColorStop(0, `hsl(${hue}, 30%, 25%)`);
  gradient.addColorStop(1, `hsl(${hue}, 30%, 15%)`);
  
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 320, 200);
  
  // Add title
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const titleText = title.slice(0, 30) + (title.length > 30 ? '...' : '');
  ctx.fillText(titleText, 16, 40);
  
  // Add hostname
  ctx.fillStyle = '#a0aec0';
  ctx.font = '12px monospace';
  ctx.fillText(hostname, 16, 180);
  
  return canvas.toDataURL('image/jpeg', 0.8);
}

function generateGradient(seed) {
  const hue = Array.from(seed).reduce((acc, char) => acc + char.charCodeAt(0), 0) % 360;
  return `linear-gradient(135deg, hsl(${hue}, 40%, 25%), hsl(${hue}, 40%, 15%))`;
}

// Simple weighted treemap-like layout: map index to varying row spans
function applyArtLayout() {
  const enable = !!toggleArt?.checked;
  gridEl.classList.toggle('art', enable);
  const tiles = Array.from(gridEl.querySelectorAll('.tile'));
  if (!enable) {
    tiles.forEach(tile => tile.style.gridRowEnd = '');
    return;
  }
  // Size palette (row spans). grid-auto-rows is 8px; 24 ≈ 192px height area.
  const spans = [32, 28, 24, 24, 20, 20, 16, 16, 12, 12];
  tiles.forEach((tile, i) => {
    const span = spans[i % spans.length];
    tile.style.gridRowEnd = `span ${span}`;
  });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
