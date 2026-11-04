import { describe, expect, it } from 'vitest';

import {
  clampToCanvas,
  keyboardStep,
  movedPosition,
  snap,
  tableDimensions,
  resizedTable,
} from './floor-map-geometry';

const canvas = { width: 1000, height: 700 };

describe('snap', () => {
  it('rounds to the nearest grid line', () => {
    expect(snap(14, 10)).toBe(10);
    expect(snap(15, 10)).toBe(20);
    expect(snap(0, 10)).toBe(0);
  });
  it('leaves values alone when there is no grid', () => {
    expect(snap(13, 1)).toBe(13);
  });
});

describe('clampToCanvas', () => {
  it('keeps a table fully inside the canvas', () => {
    expect(clampToCanvas({ x: -20, y: -5, w: 80, h: 80 }, canvas)).toEqual({ x: 0, y: 0 });
    expect(clampToCanvas({ x: 990, y: 690, w: 80, h: 80 }, canvas)).toEqual({ x: 920, y: 620 });
    expect(clampToCanvas({ x: 300, y: 200, w: 80, h: 80 }, canvas)).toEqual({ x: 300, y: 200 });
  });
});

describe('movedPosition', () => {
  const table = { x: 100, y: 100, w: 80, h: 80 };

  it('turns a pixel drag into canvas units using the on-screen scale', () => {
    // The 1000-wide canvas is drawn 500px wide, so 50px on screen is 100 canvas units.
    expect(movedPosition(table, { x: 50, y: 25 }, 0.5, 1, canvas)).toEqual({ x: 200, y: 150 });
  });

  it('snaps to the grid and stays inside the canvas', () => {
    expect(movedPosition(table, { x: 13, y: 12 }, 1, 10, canvas)).toEqual({ x: 110, y: 110 });
    expect(movedPosition(table, { x: 5000, y: 5000 }, 1, 10, canvas)).toEqual({ x: 920, y: 620 });
  });

  it('treats an unknown scale as 1 (nothing measured yet)', () => {
    expect(movedPosition(table, { x: 30, y: 0 }, 0, 10, canvas)).toEqual({ x: 130, y: 100 });
  });
});

describe('keyboardStep', () => {
  it('moves one grid step per arrow key', () => {
    expect(keyboardStep('ArrowRight', 10)).toEqual({ x: 10, y: 0 });
    expect(keyboardStep('ArrowLeft', 10)).toEqual({ x: -10, y: 0 });
    expect(keyboardStep('ArrowDown', 10)).toEqual({ x: 0, y: 10 });
    expect(keyboardStep('ArrowUp', 10)).toEqual({ x: 0, y: -10 });
  });
  it('ignores other keys', () => {
    expect(keyboardStep('Enter', 10)).toBeNull();
  });
});

describe('table dimensions and resizing', () => {
  it('keeps circle/square sides equal and legacy rectangles distinct', () => {
    expect(tableDimensions('square', 120, 80)).toEqual({ w: 120, h: 120 });
    expect(tableDimensions('round', 80, 100)).toEqual({ w: 80, h: 80 });
    expect(tableDimensions('rect', 80, 80)).toEqual({ w: 120, h: 80 });
  });
  it('moves a resized table back inside its canvas and keeps equal sides', () => {
    expect(
      resizedTable({ x: 950, y: 650, w: 40, h: 40 }, 'round', { w: 120, h: 50 }, canvas),
    ).toEqual({ x: 880, y: 580, w: 120, h: 120 });
    expect(
      resizedTable({ x: 950, y: 650, w: 40, h: 40 }, 'rect', { w: 140, h: 60 }, canvas),
    ).toEqual({ x: 860, y: 640, w: 140, h: 60 });
  });
});
