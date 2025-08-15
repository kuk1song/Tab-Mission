// layout.js
import { state } from './state.js';

const gridEl = document.getElementById('grid');
const toggleArt = document.getElementById('toggle-art');

export function applyArtLayout() {
  const enable = !!toggleArt?.checked;
  gridEl.classList.toggle('art', enable);
  
  const tiles = Array.from(gridEl.querySelectorAll('.tile'));
  
  if (!enable) {
    // Reset styles when art mode is disabled
    tiles.forEach(tile => {
      tile.style.left = '';
      tile.style.top = '';
      tile.style.width = '';
      tile.style.height = '';
    });
    return;
  }
  
  // Prepare data for the treemap algorithm
  const containerWidth = gridEl.clientWidth;
  const containerHeight = gridEl.clientHeight;
  const now = Date.now();
  const tabs = state.filteredTabs.map(tab => {
    // Bonus for recency (e.g., accessed in the last hour)
    const recencyBonus = (now - tab.lastAccessed) < 3600000 ? 50 : 0;
    // Bonus for being active
    const activeBonus = !tab.discarded ? 20 : 0;
    
    return {
      ...tab,
      weight: 10 + recencyBonus + activeBonus, 
    };
  });

  const layout = generateCollageLayout(tabs, containerWidth, containerHeight);

  layout.forEach((item, i) => {
    const tile = tiles.find(t => parseInt(t.getAttribute('data-tab-id')) === item.node.id);
    if (tile) {
      Object.assign(tile.style, {
        left: `${item.x}px`,
        top: `${item.y}px`,
        width: `${item.width}px`,
        height: `${item.height}px`,
        transform: `rotate(${item.rotation}deg) scale(1)`,
        zIndex: item.zIndex,
        transitionDelay: `${(i % 20) * 20}ms`,
      });
    }
  });
}

function generateCollageLayout(nodes, width, height) {
  const sortedNodes = [...nodes].sort((a, b) => b.weight - a.weight);
  const layout = [];
  const occupied = [];

  const baseWidth = width / 5;
  const baseHeight = height / 3;

  sortedNodes.forEach((node, i) => {
    const scale = 1 + (node.weight / 100);
    const itemWidth = baseWidth * scale;
    const itemHeight = baseHeight * scale;
    
    let x, y, attempts = 0;
    
    // Find a non-overlapping position
    do {
      if (i < 3) { // Place the most important items near the center
        x = width * 0.5 + (Math.random() - 0.5) * (width * 0.4) - itemWidth / 2;
        y = height * 0.5 + (Math.random() - 0.5) * (height * 0.4) - itemHeight / 2;
      } else {
        x = Math.random() * (width - itemWidth);
        y = Math.random() * (height - itemHeight);
      }
      attempts++;
    } while (isOverlapping({ x, y, width: itemWidth, height: itemHeight }, occupied) && attempts < 100);

    const rotation = (Math.random() - 0.5) * 8;
    const zIndex = 10 + sortedNodes.length - i;
    
    layout.push({ x, y, width: itemWidth, height: itemHeight, rotation, zIndex, node });
    occupied.push({ x, y, width: itemWidth, height: itemHeight });
  });

  return layout;
}

function isOverlapping(rect1, others) {
  for (const rect2 of others) {
    if (!(rect1.x + rect1.width < rect2.x || rect2.x + rect2.width < rect1.x ||
          rect1.y + rect1.height < rect2.y || rect2.y + rect2.height < rect1.y)) {
      return true; // Found overlap
    }
  }
  return false;
}
