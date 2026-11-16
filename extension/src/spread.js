// spread.js: where the cards go when they are spread out (settings page, off
// by default), as windows in Mission Control: in rows, none in a column,
// every card in view at once while they fit. Tabs of one window are all the
// same shape, so the sizes come from how recently each was used: the first
// cards (state.js puts the previous tab first) are larger. Same number of
// cards and same area, same places: nothing here is random between two draws.

export const RATIO = 16 / 10; // a card's picture, as in the grid
const GAP = 26; // between pictures in a row
const CAPTION = 44; // under each row: the title's label and the space to the next row
const SIDE = 34; // left and right of the rows
const TOP = 18;
const BOTTOM = 8;
// A picture of weight 1 is at most this share of the area's height (or its
// smallest size, in a very low window), so two or three cards do not fill
// the window.
const MAX_UNIT = 0.31;
// The cards shrink to fit until the smallest kind (weightOf's last value)
// would be narrower than this: its label still holds a short title. From
// there on they keep that size and the rows go on below, to scroll to.
export const MIN_WIDTH = 120;

// How much larger a card is than the plain ones, by its place in the order.
export function weightOf(rank) {
  if (rank === 0) return 1.55;
  if (rank === 1) return 1.4;
  if (rank < 4) return 1.18;
  if (rank < 8) return 1;
  return 0.84;
}
const LEAST = weightOf(Infinity);
// Evenly filled rows are kept while their pictures are at least this share
// of the largest that would fit.
const EVEN_WORTH = 0.95;
// The height of a picture of weight 1 when the cards are at their smallest.
const FLOOR_UNIT = MIN_WIDTH / (RATIO * LEAST);

// The cards' boxes ({ x, y, w, h } of each picture, in the order given) for
// `count` cards in an area of width by height px; `height`, how far down
// they and their labels reach; and `scrolls` when that is further than the
// area. null when there is nothing to lay out or no room at all.
export function spreadLayout(count, width, height) {
  if (!(count > 0) || !(width > 0) || !(height > 0)) return null;
  const areaW = width - 2 * SIDE;
  const areaH = height - TOP - BOTTOM;
  if (areaW <= 0 || areaH <= 0) return null;

  const weights = Array.from({ length: count }, (_, rank) => weightOf(rank));
  const before = [0]; // before[i]: the weights of the cards before card i, summed
  for (const w of weights) before.push(before.at(-1) + w);
  // What a row of the cards i to j - 1 asks of the width: 1 / the unit (the
  // height of a picture of weight 1) at which it is exactly as wide as the
  // area; Infinity when their gaps alone are wider.
  const need = (i, j) => {
    const room = areaW - GAP * (j - i - 1);
    return room > 0 ? (RATIO * (before[j] - before[i])) / room : Infinity;
  };
  // A row never holds more cards than fit at their smallest.
  const perRow = Math.max(1, Math.floor((areaW + GAP) / (MIN_WIDTH + GAP)));
  // A row is as tall as its first card, the largest in it.
  const tall = (rows, unit) => rows.reduce((sum, row) => sum + weights[row.start] * unit + CAPTION, 0);

  // Rows filled one after the other, each with as many cards as are not
  // too wide at this unit: the fewest and lowest rows the unit allows, so
  // the cards fit in view at a unit exactly when these rows do.
  const filled = (unit) => {
    const rows = [];
    for (let start = 0; start < count;) {
      let end = start + 1;
      while (end < count && need(start, end + 1) <= 1 / unit + 1e-9) end++;
      rows.push({ start, end });
      start = end;
    }
    return rows;
  };

  // Rows evenly filled: the cards shared out in order so that the most
  // crowded row asks least (tightest[j]: for the first j cards; starts[r][j]:
  // where the last of their r rows starts), worked out one more row at a
  // time, as far as asked.
  const starts = [null];
  let tightest = new Array(count + 1).fill(Infinity);
  tightest[0] = 0;
  const oneMoreRow = () => {
    const r = starts.length;
    const next = new Array(count + 1).fill(Infinity);
    const from = new Array(count + 1).fill(-1);
    for (let j = r; j <= count; j++) {
      for (let i = Math.max(r - 1, j - perRow); i < j; i++) {
        const asked = Math.max(tightest[i], need(i, j));
        if (asked < next[j]) {
          next[j] = asked;
          from[j] = i;
        }
      }
    }
    tightest = next;
    starts.push(from);
    return r;
  };
  const even = (r) => {
    const rows = [];
    for (let end = count, row = r; row >= 1; row--) {
      const start = starts[row][end];
      rows.unshift({ start, end });
      end = start;
    }
    return rows;
  };

  // The cards at their smallest (in a window narrower than the first card
  // at that size: as wide as the window lets it be).
  const floorUnit = Math.min(FLOOR_UNIT, 1 / need(0, 1));
  const floorRows = filled(floorUnit);
  const scrolls = tall(floorRows, floorUnit) > areaH + 0.5;

  let unit = floorUnit;
  let rows;
  if (scrolls) {
    // As many rows as that, evenly filled.
    while (starts.length <= floorRows.length) oneMoreRow();
    rows = even(floorRows.length);
  } else {
    // In view: evenly filled rows, as many of them as make the pictures
    // largest (the first of equals, so fewer rows), no larger than the cap:
    // a share of the height, and never so large that the first card, the
    // widest, alone in its row is wider than the area (a tall, narrow
    // window with a card or two).
    const cap = Math.min(Math.max(areaH * MAX_UNIT, floorUnit), 1 / need(0, 1));
    let best = null;
    while (starts.length <= count) {
      const r = oneMoreRow();
      if (Number.isFinite(tightest[count])) {
        const split = even(r);
        const byHeight = (areaH - CAPTION * r) / split.reduce((sum, row) => sum + weights[row.start], 0);
        const size = Math.min(1 / tightest[count], byHeight, cap);
        if (!best || size > best.unit + 1e-6) best = { unit: size, rows: split };
        // More rows only make the pictures smaller from here on.
        if ((areaH - CAPTION * (r + 1)) / ((r + 1) * LEAST) <= best.unit) break;
      }
    }
    // The largest unit at which the cards fit at all, with rows filled one
    // after the other (the smallest size does, or they would scroll).
    let low = floorUnit;
    if (tall(filled(cap), cap) <= areaH) {
      low = cap;
    } else {
      let high = cap;
      for (let step = 0; step < 30; step++) {
        const middle = (low + high) / 2;
        if (tall(filled(middle), middle) <= areaH) low = middle;
        else high = middle;
      }
    }
    // Evenly filled rows look better and are kept when they cost little;
    // near the limit they are too tall, and the filled rows are used.
    if (best && best.unit >= floorUnit && best.unit >= low * EVEN_WORTH) {
      ({ unit, rows } = best);
    } else {
      unit = low;
      rows = filled(low);
    }
  }

  // A fixed sequence stands in for chance (Lehmer), so the cards sit a
  // little off their lines the same way every time.
  let seed = 7;
  const next = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  const boxes = new Array(count);
  const used = tall(rows, unit);
  // In view, the rows sit in the middle of the area; scrolling, they start at its top.
  let y = TOP + (scrolls ? 0 : (areaH - used) / 2);
  rows.forEach((row, rowIndex) => {
    const rowH = weights[row.start] * unit;
    const rowW = (before[row.end] - before[row.start]) * unit * RATIO + GAP * (row.end - row.start - 1);
    const slack = Math.max(0, areaW - rowW);
    // Rows lean left and right in turn, within the room they have.
    let x = SIDE + slack / 2 + (rowIndex % 2 ? 1 : -1) * Math.min(slack / 2, 22);
    for (let rank = row.start; rank < row.end; rank++) {
      const h = weights[rank] * unit;
      const w = h * RATIO;
      boxes[rank] = { x, y: y + (rowH - h) * (0.25 + 0.5 * next()), w, h };
      x += w + GAP;
    }
    y += rowH + CAPTION;
  });
  return { boxes, height: scrolls ? TOP + used + BOTTOM : height, scrolls };
}
