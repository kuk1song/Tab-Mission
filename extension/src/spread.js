// spread.js: where the cards go when they are spread out (settings page, off
// by default), as windows in Mission Control: every card in view at once, in
// rows, none in a column. Tabs of one window are all the same shape, so the
// sizes come from how recently each was used: the first cards (state.js puts
// the previous tab first) are larger. Same number of cards and same area,
// same places: nothing here is random between two draws.

export const RATIO = 16 / 10; // a card's picture, as in the grid
const GAP = 26; // between pictures in a row
const CAPTION = 44; // under each row: the title's pill and the space to the next row
const SIDE = 34; // left and right of the rows
const TOP = 18;
const BOTTOM = 8;
const MAX_ROWS = 8;
// A picture of weight 1 is at most this share of the area's height, so two
// or three cards do not fill the window.
const MAX_UNIT = 0.31;
// Under this width the smallest picture shows only the site's icon, not its
// title (the selected card still shows it).
export const SMALL_WIDTH = 135;
// Under this one the cards are too small to tell apart: no spread layout,
// and the window shows its grid instead.
export const MIN_WIDTH = 112;

// How much larger a card is than the plain ones, by its place in the order.
export function weightOf(rank) {
  if (rank === 0) return 1.55;
  if (rank === 1) return 1.4;
  if (rank < 4) return 1.18;
  if (rank < 8) return 1;
  return 0.84;
}

// The cards' boxes ({ x, y, w, h } of each picture, in the order given) for
// `count` cards in an area of width by height px, with `small` when titles
// do not fit; null when the cards would be too small, or there is nothing to
// lay out.
export function spreadLayout(count, width, height) {
  if (!(count > 0) || !(width > 0) || !(height > 0)) return null;
  const weights = Array.from({ length: count }, (_, rank) => weightOf(rank));
  const total = weights.reduce((sum, w) => sum + w, 0);
  const areaW = width - 2 * SIDE;
  const areaH = height - TOP - BOTTOM;
  if (areaW <= 0 || areaH <= 0) return null;

  // Each number of rows in turn, the cards shared out so that every row
  // carries about the same weight; kept: the one whose pictures come out
  // largest (the first of equals, so fewer rows).
  let best = null;
  for (let rowCount = 1; rowCount <= Math.min(MAX_ROWS, count); rowCount++) {
    const rows = [[]];
    let carried = 0;
    weights.forEach((w, rank) => {
      if (carried >= (total / rowCount) * rows.length - 1e-6 && rows.length < rowCount) rows.push([]);
      rows.at(-1).push(rank);
      carried += w;
    });
    const rowWeight = (row) => row.reduce((sum, rank) => sum + weights[rank], 0);
    const tallest = (row) => Math.max(...row.map((rank) => weights[rank]));
    // unit: the height of a picture of weight 1, limited by the widest row
    // and by all rows' heights together.
    const byWidth = Math.min(...rows.map((row) => (areaW - GAP * (row.length - 1)) / (RATIO * rowWeight(row))));
    const byHeight = (areaH - CAPTION * rows.length) / rows.reduce((sum, row) => sum + tallest(row), 0);
    const unit = Math.min(byWidth, byHeight, areaH * MAX_UNIT);
    if (!best || unit > best.unit + 1e-6) best = { unit, rows, tallest };
  }
  const { unit, rows, tallest } = best;
  const smallest = Math.min(...weights) * unit * RATIO;
  if (!(smallest >= MIN_WIDTH)) return null;

  // A fixed sequence stands in for chance (Lehmer), so the cards sit a
  // little off their lines the same way every time.
  let seed = 7;
  const next = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  const boxes = new Array(count);
  const usedH = rows.reduce((sum, row) => sum + tallest(row) * unit + CAPTION, 0);
  let y = TOP + (areaH - usedH) / 2;
  rows.forEach((row, rowIndex) => {
    const rowH = tallest(row) * unit;
    const rowW = row.reduce((sum, rank) => sum + weights[rank] * unit * RATIO, 0) + GAP * (row.length - 1);
    const slack = areaW - rowW;
    // Rows lean left and right in turn, within the room they have.
    let x = SIDE + slack / 2 + (rowIndex % 2 ? 1 : -1) * Math.min(slack / 2, 22);
    for (const rank of row) {
      const h = weights[rank] * unit;
      const w = h * RATIO;
      boxes[rank] = { x, y: y + (rowH - h) * (0.25 + 0.5 * next()), w, h };
      x += w + GAP;
    }
    y += rowH + CAPTION;
  });
  return { boxes, small: smallest < SMALL_WIDTH };
}
