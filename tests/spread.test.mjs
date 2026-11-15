import { describe, it, expect } from 'vitest';
import { spreadLayout, weightOf, RATIO, MIN_WIDTH } from '../extension/src/spread.js';

// The grid's box in the default Tab Mission window (1280 x 752 with its toolbar).
const AREA = [1280, 668];
// The grid's box in a small upright window (662 x 856, its toolbar on two rows).
const UPRIGHT = [639, 685];
const GAP = 26; // between pictures in a row (spread.js)
const LABEL = 30; // a label's room under its picture: 7 px, its 22 px, 1 px to spare

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const smallest = (layout) => Math.min(...layout.boxes.map((b) => b.w));

describe('spreadLayout: the cards spread out', () => {
  it('has nothing to lay out without cards or without room', () => {
    expect(spreadLayout(0, ...AREA)).toBeNull();
    expect(spreadLayout(5, 0, 600)).toBeNull();
    expect(spreadLayout(5, 800, 0)).toBeNull();
    expect(spreadLayout(5, 60, 600)).toBeNull(); // narrower than its side margins
    expect(spreadLayout(5, NaN, 600)).toBeNull();
  });

  it('gives every card a picture of the cards\' shape, inside the area while they fit', () => {
    for (const count of [1, 2, 3, 7, 11, 20, 30]) {
      const layout = spreadLayout(count, ...AREA);
      expect(layout.scrolls).toBe(false);
      expect(layout.height).toBe(AREA[1]);
      expect(layout.boxes).toHaveLength(count);
      for (const box of layout.boxes) {
        expect(box.w / box.h).toBeCloseTo(RATIO, 6);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.w).toBeLessThanOrEqual(AREA[0]);
        // The label under the picture is inside too.
        expect(box.y + box.h + LABEL).toBeLessThanOrEqual(AREA[1]);
      }
    }
  });

  it('keeps pictures apart, with room for each label under its picture, in view or scrolling', () => {
    for (const [count, width, height] of [[2, ...AREA], [11, ...AREA], [24, ...AREA], [30, ...AREA], [80, ...AREA], [9, 900, 600], [40, 1600, 900], [100, 2560, 1300], [8, ...UPRIGHT], [14, ...UPRIGHT], [40, ...UPRIGHT], [12, 400, 900]]) {
      const { boxes } = spreadLayout(count, width, height);
      // Each picture with its label's room below and half the gap at its sides.
      const padded = boxes.map((b) => ({ x: b.x - GAP / 2 + 0.01, y: b.y, w: b.w + GAP - 0.02, h: b.h + LABEL }));
      for (let i = 0; i < padded.length; i++) {
        expect(boxes[i].x, `card ${i} of ${count} in ${width}x${height}`).toBeGreaterThanOrEqual(0);
        expect(boxes[i].x + boxes[i].w, `card ${i} of ${count} in ${width}x${height}`).toBeLessThanOrEqual(width);
        for (let j = i + 1; j < padded.length; j++) {
          expect(overlap(padded[i], padded[j]), `cards ${i} and ${j} of ${count} in ${width}x${height}`).toBe(false);
        }
      }
    }
  });

  it('makes the first cards larger: sizes follow the order, never growing', () => {
    for (const area of [AREA, UPRIGHT]) {
      for (const count of [12, 60]) {
        const { boxes } = spreadLayout(count, ...area);
        for (let i = 1; i < boxes.length; i++) expect(boxes[i].w).toBeLessThanOrEqual(boxes[i - 1].w + 1e-9);
        expect(boxes[0].w / boxes[11].w).toBeCloseTo(weightOf(0) / weightOf(11), 6);
        expect(boxes[0].w).toBeGreaterThan(boxes[1].w);
        expect(boxes[1].w).toBeGreaterThan(boxes[2].w);
      }
    }
  });

  it('reads in rows: a later card is to the right of the one before it, or on a lower row', () => {
    for (const [count, ...area] of [[20, ...AREA], [70, ...AREA], [20, ...UPRIGHT]]) {
      const { boxes } = spreadLayout(count, ...area);
      for (let i = 1; i < boxes.length; i++) {
        const before = boxes[i - 1];
        const sameRow = boxes[i].x >= before.x + before.w;
        const lowerRow = boxes[i].y >= before.y + before.h;
        expect(sameRow || lowerRow, `card ${i} of ${count}`).toBe(true);
      }
    }
  });

  it('does not sit in columns: no two cards start at the same place across', () => {
    const { boxes } = spreadLayout(12, ...AREA);
    expect(new Set(boxes.map((b) => Math.round(b.x))).size).toBe(boxes.length);
  });

  it('puts the same cards in the same places every time', () => {
    expect(spreadLayout(17, ...AREA)).toEqual(spreadLayout(17, ...AREA));
    expect(spreadLayout(50, ...UPRIGHT)).toEqual(spreadLayout(50, ...UPRIGHT));
  });

  it('does not fill the window with two or three cards', () => {
    const { boxes } = spreadLayout(2, ...AREA);
    expect(boxes[0].h).toBeLessThan(AREA[1] / 2);
    expect(boxes[0].y + boxes[0].h / 2).toBeGreaterThan(AREA[1] * 0.3);
    expect(boxes[0].y + boxes[0].h / 2).toBeLessThan(AREA[1] * 0.7);
  });

  it('shrinks the cards to keep them all in view, down to their smallest; from there the rows go on below', () => {
    for (const area of [AREA, UPRIGHT, [1600, 900], [500, 700]]) {
      let scrolling = false;
      let inView = 0;
      let previous = Infinity;
      for (let count = 1; count <= 120; count++) {
        const layout = spreadLayout(count, ...area);
        // The size of a plain card (a ninth card and later ones are the smallest kind).
        const width = smallest(layout) / weightOf(count - 1) * weightOf(Infinity);
        expect(width).toBeGreaterThanOrEqual(MIN_WIDTH - 1e-6);
        // Smaller with more cards. Evenly filled rows may give up to 5% of
        // the size, so one more card can leave the cards that much larger.
        expect(width).toBeLessThanOrEqual(previous / 0.95 + 1e-6);
        previous = Math.min(previous, width);
        // Once the rows go on below, they do for every larger number.
        if (scrolling) expect(layout.scrolls, `${count} cards in ${area}`).toBe(true);
        scrolling = layout.scrolls;
        if (!scrolling) {
          inView = count;
          continue;
        }
        // Scrolling: the cards at their smallest, the rows from the top to `height`.
        expect(width).toBeCloseTo(MIN_WIDTH, 6);
        expect(layout.height).toBeGreaterThan(area[1]);
        expect(Math.min(...layout.boxes.map((b) => b.y))).toBeLessThan(60);
        const reach = Math.max(...layout.boxes.map((b) => b.y + b.h + LABEL));
        expect(reach).toBeLessThanOrEqual(layout.height);
        expect(layout.height - reach).toBeLessThan(40);
      }
      expect(scrolling).toBe(true);
      expect(inView).toBeGreaterThanOrEqual(5);
    }
  });

  it('holds about thirty cards in view in the default window, a dozen in a small upright one', () => {
    expect(spreadLayout(28, ...AREA).scrolls).toBe(false);
    expect(spreadLayout(36, ...AREA).scrolls).toBe(true);
    expect(spreadLayout(12, ...UPRIGHT).scrolls).toBe(false);
    expect(spreadLayout(16, ...UPRIGHT).scrolls).toBe(true);
    // A larger window holds more.
    expect(spreadLayout(50, 1920, 1000).scrolls).toBe(false);
  });

  it('uses the width it has: scrolling, rows are filled, not left half empty', () => {
    for (const [count, ...area] of [[60, ...AREA], [40, ...UPRIGHT]]) {
      const { boxes } = spreadLayout(count, ...area);
      const rows = new Map();
      for (const box of boxes) {
        const key = [...rows.keys()].find((y) => Math.abs(y - box.y) < box.h) ?? box.y;
        rows.set(key, [...(rows.get(key) ?? []), box]);
      }
      const widths = [...rows.values()].map((row) => row.at(-1).x + row.at(-1).w - row[0].x);
      // Every row but the last takes more than two thirds of the width.
      for (const width of widths.slice(0, -1)) expect(width).toBeGreaterThan(area[0] * 0.66);
    }
  });

  it('still places the cards in a window too narrow for one at its smallest: one a row, as wide as it lets them', () => {
    const layout = spreadLayout(4, 180, 400);
    expect(layout.scrolls).toBe(true);
    for (const box of layout.boxes) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.w).toBeLessThanOrEqual(180);
    }
    expect(new Set(layout.boxes.map((b) => Math.round(b.y))).size).toBe(4);
  });

  it('stays quick with hundreds of cards', () => {
    const start = performance.now();
    for (let i = 0; i < 10; i++) spreadLayout(500, ...AREA);
    expect((performance.now() - start) / 10).toBeLessThan(50);
  });
});
