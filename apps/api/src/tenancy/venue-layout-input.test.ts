import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import {
  findFreeSpot,
  parseAreaInput,
  parseAreaUpdate,
  parseCombinableInput,
  parsePositionsInput,
  parseTableInput,
} from './venue-layout-input';

const area = { mapWidth: 1000, mapHeight: 700 };
const table = { label: 'T1', minSeats: 2, maxSeats: 4, mapX: 10, mapY: 20 };
const id1 = 'b2222222-2222-4222-8222-222222222222';
const id2 = 'c3333333-3333-4333-8333-333333333333';

describe('parseAreaInput', () => {
  it('trims the name and fills the default map size', () => {
    expect(parseAreaInput({ name: '  Terrace ' })).toEqual({
      name: 'Terrace',
      sortOrder: 0,
      mapWidth: 1000,
      mapHeight: 700,
    });
  });

  it.each([
    ['a missing name', {}],
    ['a blank name', { name: '  ' }],
    ['a name over 100 characters', { name: 'x'.repeat(101) }],
    ['a map narrower than 400', { name: 'A', mapWidth: 399 }],
    ['a map taller than 3000', { name: 'A', mapHeight: 3001 }],
    ['a fractional map width', { name: 'A', mapWidth: 500.5 }],
    ['a body that is not an object', 'Terrace'],
  ])('rejects %s', (_label, body) => {
    expect(() => parseAreaInput(body)).toThrow(BadRequestException);
  });
});

describe('parseAreaUpdate', () => {
  it('returns only the fields that are present', () => {
    expect(parseAreaUpdate({ name: 'Garden', active: false })).toEqual({
      name: 'Garden',
      active: false,
    });
  });
  it('rejects an empty update', () => {
    expect(() => parseAreaUpdate({})).toThrow(BadRequestException);
  });
});

describe('parseTableInput', () => {
  it('accepts a valid round table and fills the size defaults', () => {
    expect(parseTableInput({ ...table, shape: 'round' }, area)).toEqual({
      label: 'T1',
      minSeats: 2,
      maxSeats: 4,
      mapX: 10,
      mapY: 20,
      mapWidth: 80,
      mapHeight: 80,
      shape: 'round',
      notes: null,
      features: [],
      onlineBookable: true,
      priority: 0,
    });
  });

  it('defaults the shape to square', () => {
    expect(parseTableInput(table, area).shape).toBe('square');
  });

  it.each([
    ['minimum seats above maximum', { ...table, minSeats: 4, maxSeats: 2 }],
    ['zero minimum seats', { ...table, minSeats: 0 }],
    ['fractional seats', { ...table, maxSeats: 4.5 }],
    ['an empty label', { ...table, label: ' ' }],
    ['a label over 30 characters', { ...table, label: 'x'.repeat(31) }],
    ['an unknown shape', { ...table, shape: 'triangle' }],
    ['a negative position', { ...table, mapX: -1 }],
    ['a table that sticks out of the right edge', { ...table, mapX: 950 }],
    ['a table that sticks out of the bottom edge', { ...table, mapY: 650 }],
    ['a zero-width table', { ...table, mapWidth: 0 }],
  ])('rejects %s', (_label, body) => {
    expect(() => parseTableInput(body, area)).toThrow(BadRequestException);
  });

  it('accepts a table that exactly touches the edges', () => {
    expect(() => parseTableInput({ ...table, mapX: 920, mapY: 620 }, area)).not.toThrow();
  });
});

describe('findFreeSpot', () => {
  const size = { w: 80, h: 80 };
  const at = (x: number, y: number) => ({ x, y, w: 80, h: 80 });

  it('starts near the top-left corner of an empty area', () => {
    expect(findFreeSpot([], size, { width: 1000, height: 700 })).toEqual({ x: 20, y: 20 });
  });

  it('puts the next table beside the last one, with a gap', () => {
    expect(findFreeSpot([at(20, 20)], size, { width: 1000, height: 700 })).toEqual({
      x: 110,
      y: 20,
    });
  });

  it('starts a new row when the first row is full', () => {
    const canvas = { width: 300, height: 300 };
    const row = [at(20, 20), at(110, 20), at(200, 20)];
    expect(findFreeSpot(row, size, canvas)).toEqual({ x: 20, y: 110 });
  });

  it('fills a gap left by a moved table', () => {
    expect(findFreeSpot([at(20, 20), at(200, 20)], size, { width: 1000, height: 700 })).toEqual({
      x: 110,
      y: 20,
    });
  });

  it('never returns a spot that overlaps a table or leaves the map', () => {
    const existing = [at(20, 20), at(110, 20), at(200, 20)];
    const spot = findFreeSpot(existing, size, { width: 1000, height: 700 })!;
    expect(
      existing.some(
        (t) => spot.x < t.x + t.w && spot.x + 80 > t.x && spot.y < t.y + t.h && spot.y + 80 > t.y,
      ),
    ).toBe(false);
    expect(spot.x + 80).toBeLessThanOrEqual(1000);
  });

  it('gives up (null) when the area has no room left', () => {
    expect(findFreeSpot([at(20, 20)], size, { width: 100, height: 100 })).toBeNull();
  });
});

describe('parsePositionsInput', () => {
  it('returns the positions in order', () => {
    expect(parsePositionsInput({ positions: [{ tableId: id1, mapX: 5, mapY: 6 }] })).toEqual([
      { tableId: id1, mapX: 5, mapY: 6 },
    ]);
  });

  it.each([
    ['no positions', { positions: [] }],
    ['a missing list', {}],
    [
      'the same table twice',
      {
        positions: [
          { tableId: id1, mapX: 1, mapY: 1 },
          { tableId: id1, mapX: 2, mapY: 2 },
        ],
      },
    ],
    ['a table id that is not a UUID', { positions: [{ tableId: 'T1', mapX: 1, mapY: 1 }] }],
    ['a negative coordinate', { positions: [{ tableId: id1, mapX: -1, mapY: 1 }] }],
    [
      'more than 500 positions',
      { positions: Array.from({ length: 501 }, (_, i) => ({ tableId: `${i}`, mapX: 0, mapY: 0 })) },
    ],
  ])('rejects %s', (_label, body) => {
    expect(() => parsePositionsInput(body)).toThrow(BadRequestException);
  });
});

describe('parseCombinableInput', () => {
  it('returns the unique table ids', () => {
    expect(parseCombinableInput({ tableIds: [id1, id2, id1] })).toEqual([id1, id2]);
  });
  it('accepts an empty list, which clears the set', () => {
    expect(parseCombinableInput({ tableIds: [] })).toEqual([]);
  });
  it.each([
    ['a missing list', {}],
    ['ids that are not UUIDs', { tableIds: ['x'] }],
    [
      'more than 100 ids',
      {
        tableIds: Array.from({ length: 101 }, () => id1).map(
          (_, i) => `b2222222-2222-4222-8222-${String(i).padStart(12, '0')}`,
        ),
      },
    ],
  ])('rejects %s', (_label, body) => {
    expect(() => parseCombinableInput(body)).toThrow(BadRequestException);
  });
});

describe('table options and shape dimensions', () => {
  it('preserves supported tags and notes independently of seats', () => {
    expect(
      parseTableInput(
        {
          ...table,
          notes: ' Window ',
          features: ['window', 'quiet', 'window'],
          onlineBookable: false,
          priority: 12,
        },
        area,
      ),
    ).toMatchObject({
      notes: 'Window',
      features: ['window', 'quiet'],
      onlineBookable: false,
      priority: 12,
    });
  });
  it.each([
    { features: ['unknown'] },
    { notes: 4 },
    { onlineBookable: 'yes' },
    { priority: -1 },
    { priority: 1.5 },
    { priority: 1001 },
  ])('rejects invalid options %j', (options) => {
    expect(() => parseTableInput({ ...table, ...options }, area)).toThrow(BadRequestException);
  });
  it('creates rectangles with distinct sides and keeps squares and circles proportional', () => {
    expect(parseTableInput({ ...table, shape: 'rect' }, area)).toMatchObject({
      mapWidth: 120,
      mapHeight: 80,
    });
    for (const shape of ['square', 'round'])
      expect(
        parseTableInput({ ...table, shape, mapWidth: 100, mapHeight: 50 }, area),
      ).toMatchObject({ mapWidth: 100, mapHeight: 100 });
  });
  it('places a resized rectangle using its full footprint', () => {
    expect(
      findFreeSpot(
        [{ x: 20, y: 20, w: 160, h: 80 }],
        { w: 140, h: 60 },
        { width: 400, height: 200 },
      ),
    ).toEqual({ x: 190, y: 20 });
  });
});
