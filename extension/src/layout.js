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
  
  // Calculate optimal grid that gives good spacing
  const numNodes = nodes.length;
  const cols = Math.ceil(Math.sqrt(numNodes * (width / height))) + 1;
  const rows = Math.ceil(numNodes / cols);
  
  const cellWidth = width / cols;
  const cellHeight = height / rows;
  
  // Base size maintains 16:10 aspect ratio and leaves breathing room
  const baseWidth = Math.min(cellWidth * 0.75, cellHeight * 0.75 * (16/10));
  const baseHeight = baseWidth / (16/10);
  
  const grid = Array(rows).fill(null).map(() => Array(cols).fill(false));
  
  sortedNodes.forEach((node, i) => {
    let placed = false;
    
    // Larger tiles for important nodes
    const importance = i < 3 ? (i === 0 ? 1.3 : 1.15) : 1.0;
    const itemWidth = baseWidth * importance;
    const itemHeight = baseHeight * importance;
    
    // Find placement in grid
    for (let r = 0; r < rows && !placed; r++) {
      for (let c = 0; c < cols && !placed; c++) {
        if (!grid[r][c]) {
          // Calculate center position in cell
          const centerX = (c + 0.5) * cellWidth;
          const centerY = (r + 0.5) * cellHeight;
          
          // Add slight organic offset but ensure no overlap
          const maxOffset = Math.min(cellWidth - itemWidth, cellHeight - itemHeight) * 0.2;
          const offsetX = (Math.random() - 0.5) * maxOffset;
          const offsetY = (Math.random() - 0.5) * maxOffset;
          
          const x = centerX - itemWidth / 2 + offsetX;
          const y = centerY - itemHeight / 2 + offsetY;
          
          // Ensure within bounds
          const finalX = Math.max(0, Math.min(x, width - itemWidth));
          const finalY = Math.max(0, Math.min(y, height - itemHeight));
          
          const zIndex = 10 + numNodes - i;
          
          layout.push({ 
            x: finalX, 
            y: finalY, 
            width: itemWidth, 
            height: itemHeight, 
            rotation: 0, // No rotation for cleaner F3-like look
            zIndex, 
            node 
          });
          
          grid[r][c] = true;
          placed = true;
        }
      }
    }
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
