import { describe, it, expect } from 'vitest';
import { spreadLayout, weightOf, RATIO, SMALL_WIDTH, MIN_WIDTH } from '../extension/src/spread.js';

// The grid's box in the default Tab Mission window (1280 x 752 with its toolbar).
const AREA = [1280, 668];
const GAP = 26; // between pictures in a row (spread.js)
const LABEL = 30; // a label's room under its picture: 7 px, its 22 px, 1 px to spare

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('spreadLayout: the cards spread out', () => {
  it('has nothing to lay out without cards or without room', () => {
    expect(spreadLayout(0, ...AREA)).toBeNull();
    expect(spreadLayout(5, 0, 600)).toBeNull();
    expect(spreadLayout(5, 800, 0)).toBeNull();
    expect(spreadLayout(5, 60, 600)).toBeNull(); // narrower than its side margins
    expect(spreadLayout(5, NaN, 600)).toBeNull();
  });

  it('gives every card a picture of the cards\' shape, inside the area', () => {
    for (const count of [1, 2, 3, 7, 11, 20, 30]) {
      const { boxes } = spreadLayout(count, ...AREA);
      expect(boxes).toHaveLength(count);
      for (const box of boxes) {
        expect(box.w / box.h).toBeCloseTo(RATIO, 6);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.w).toBeLessThanOrEqual(AREA[0]);
        // The label under the picture is inside too.
        expect(box.y + box.h + LABEL).toBeLessThanOrEqual(AREA[1]);
      }
    }
  });

  it('keeps pictures apart, with room for each label under its picture', () => {
    for (const [count, width, height] of [[2, ...AREA], [11, ...AREA], [24, ...AREA], [30, ...AREA], [9, 900, 600], [40, 1600, 900], [100, 2560, 1300]]) {
      const { boxes } = spreadLayout(count, width, height);
      // Each picture with its label's room below and half the gap at its sides.
      const padded = boxes.map((b) => ({ x: b.x - GAP / 2 + 0.01, y: b.y, w: b.w + GAP - 0.02, h: b.h + LABEL }));
      for (let i = 0; i < padded.length; i++) {
        for (let j = i + 1; j < padded.length; j++) {
          expect(overlap(padded[i], padded[j]), `cards ${i} and ${j} of ${count} in ${width}x${height}`).toBe(false);
        }
      }
    }
  });

  it('makes the first cards larger: sizes follow the order, never growing', () => {
    const { boxes } = spreadLayout(12, ...AREA);
    for (let i = 1; i < boxes.length; i++) expect(boxes[i].w).toBeLessThanOrEqual(boxes[i - 1].w + 1e-9);
    expect(boxes[0].w / boxes[11].w).toBeCloseTo(weightOf(0) / weightOf(11), 6);
    expect(boxes[0].w).toBeGreaterThan(boxes[1].w);
    expect(boxes[1].w).toBeGreaterThan(boxes[2].w);
  });

  it('reads in rows: a later card is to the right of the one before it, or on a lower row', () => {
    const { boxes } = spreadLayout(20, ...AREA);
    for (let i = 1; i < boxes.length; i++) {
      const before = boxes[i - 1];
      const sameRow = boxes[i].x >= before.x + before.w;
      const lowerRow = boxes[i].y >= before.y + before.h;
      expect(sameRow || lowerRow, `card ${i}`).toBe(true);
    }
  });

  it('does not sit in columns: cards of two rows are not all aligned', () => {
    const { boxes } = spreadLayout(12, ...AREA);
    const lefts = new Set(boxes.map((b) => Math.round(b.x)));
    expect(lefts.size).toBe(boxes.length);
  });

  it('puts the same cards in the same places every time', () => {
    expect(spreadLayout(17, ...AREA)).toEqual(spreadLayout(17, ...AREA));
  });

  it('does not fill the window with two or three cards', () => {
    const { boxes } = spreadLayout(2, ...AREA);
    expect(boxes[0].h).toBeLessThan(AREA[1] / 2);
    expect(boxes[0].y + boxes[0].h / 2).toBeGreaterThan(AREA[1] * 0.3);
    expect(boxes[0].y + boxes[0].h / 2).toBeLessThan(AREA[1] * 0.7);
  });

  it('drops the titles when cards get small, and gives up when they would be too small to tell apart', () => {
    let lastWithTitles = 0;
    let last = 0;
    for (let count = 1; count <= 80; count++) {
      const layout = spreadLayout(count, ...AREA);
      if (!layout) continue;
      // No gaps: once it gives up, it gives up for every larger number.
      expect(count).toBe(last + 1);
      last = count;
      const smallest = Math.min(...layout.boxes.map((b) => b.w));
      expect(smallest).toBeGreaterThanOrEqual(MIN_WIDTH);
      expect(layout.small).toBe(smallest < SMALL_WIDTH);
      if (!layout.small) lastWithTitles = count;
    }
    // In the default window: titles up to about two dozen cards, spread out up to about thirty.
    expect(lastWithTitles).toBeGreaterThanOrEqual(20);
    expect(lastWithTitles).toBeLessThan(last);
    expect(last).toBeGreaterThanOrEqual(28);
    expect(last).toBeLessThanOrEqual(36);
    expect(spreadLayout(last + 1, ...AREA)).toBeNull();
  });

  it('holds more cards in a larger window', () => {
    expect(spreadLayout(60, ...AREA)).toBeNull();
    expect(spreadLayout(60, 1920, 1000)).not.toBeNull();
  });
});
