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

  const layout = treemap(tabs, containerWidth, containerHeight);

  // Apply the calculated layout with a staggered animation
  const PADDING = 4; // Add padding around tiles
  layout.forEach((rect, i) => {
    const tile = tiles.find(t => parseInt(t.getAttribute('data-tab-id')) === rect.node.id);
    if (tile) {
      tile.style.left = `${rect.x + PADDING}px`;
      tile.style.top = `${rect.y + PADDING}px`;
      tile.style.width = `${rect.width - PADDING * 2}px`;
      tile.style.height = `${rect.height - PADDING * 2}px`;
      tile.style.transitionDelay = `${(i % 20) * 15}ms`;
    }
  });
}

/**
 * Implements the Squarified Treemap algorithm.
 * @param {Array<Object>} nodes - Array of items to layout, each with a 'weight'.
 * @param {number} width - The width of the container.
 * @param {number} height - The height of the container.
 * @returns {Array<Object>} Array of rectangles with x, y, width, height.
 */
function treemap(nodes, width, height) {
  const rectangles = [];
  
  function recurse(nodes, x, y, w, h) {
    if (nodes.length === 0) return;

    const totalWeight = nodes.reduce((sum, node) => sum + node.weight, 0);
    
    let row = [];
    let i = 0;
    
    while (i < nodes.length) {
      const newRow = [...row, nodes[i]];
      if (worstAspectRatio(row, w, h, totalWeight) >= worstAspectRatio(newRow, w, h, totalWeight) || row.length === 0) {
        row.push(nodes[i]);
        i++;
      } else {
        break;
      }
    }
    
    const { newX, newY, newW, newH } = layoutRow(row, x, y, w, h, totalWeight);
    const remainingNodes = nodes.slice(row.length);
    
    recurse(remainingNodes, newX, newY, newW, newH);
  }

  function layoutRow(row, x, y, w, h, totalWeight) {
    const rowWeight = row.reduce((sum, node) => sum + node.weight, 0);
    const rowArea = (rowWeight / totalWeight) * (w * h);
    
    if (w > h) {
      const rowWidth = rowArea / h;
      let currentY = y;
      for (const node of row) {
        const nodeHeight = (node.weight / rowWeight) * h;
        rectangles.push({ x, y: currentY, width: rowWidth, height: nodeHeight, node });
        currentY += nodeHeight;
      }
      return { newX: x + rowWidth, newY: y, newW: w - rowWidth, newH: h };
    } else {
      const rowHeight = rowArea / w;
      let currentX = x;
      for (const node of row) {
        const nodeWidth = (node.weight / rowWeight) * w;
        rectangles.push({ x: currentX, y, width: nodeWidth, height: rowHeight, node });
        currentX += nodeWidth;
      }
      return { newX: x, newY: y + rowHeight, newW: w, newH: h - rowHeight };
    }
  }
  
  function worstAspectRatio(row, w, h, totalWeight) {
    if (row.length === 0) return Infinity;
    
    const rowWeight = row.reduce((sum, node) => sum + node.weight, 0);
    const rowArea = (rowWeight / totalWeight) * (w * h);
    const minWeight = Math.min(...row.map(n => n.weight));
    const maxWeight = Math.max(...row.map(n => n.weight));
    const length = w < h ? w : h;
    
    if (length === 0 || rowArea === 0) return Infinity;
    
    const val1 = (length * length * maxWeight) / (rowArea * rowArea);
    const val2 = (rowArea * rowArea) / (length * length * minWeight);
    
    return Math.max(val1, val2);
  }
  
  recurse(nodes, 0, 0, width, height);
  return rectangles;
}
