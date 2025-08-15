// layout.js
const gridEl = document.getElementById('grid');
const toggleArt = document.getElementById('toggle-art');

export function applyArtLayout() {
  const enable = !!toggleArt?.checked;
  gridEl.classList.toggle('art', enable);
  
  const tiles = Array.from(gridEl.querySelectorAll('.tile'));
  if (!enable) {
    tiles.forEach(tile => tile.style.gridRowEnd = '');
    return;
  }
  
  // Simple weighted treemap-like layout: map index to varying row spans
  const spans = [32, 28, 24, 24, 20, 20, 16, 16, 12, 12];
  tiles.forEach((tile, i) => {
    const span = spans[i % spans.length];
    tile.style.gridRowEnd = `span ${span}`;
  });
}
