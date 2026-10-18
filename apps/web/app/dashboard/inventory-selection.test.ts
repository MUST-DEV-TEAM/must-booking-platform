import { describe, expect, it } from 'vitest';
import { inventorySelection } from './inventory-selection';
describe('Inventory create prefill', () => {
  it.each([
    ['2036-02-29', '2036-03-01'],
    ['2035-12-31', '2036-01-01'],
    ['2026-10-25', '2026-10-26'],
  ])('converts a single day %s without timezone drift', (date, next) => {
    const cells = [{ rowId: 'king', date }];
    expect(inventorySelection(cells, 'restrictions')).toMatchObject({
      startsOn: date,
      endsOn: date,
      scope: 'room_type',
      type: 'stop_sell',
    });
    expect(inventorySelection(cells, 'blocks')).toMatchObject({
      startsOn: date,
      endsOn: next,
      all: false,
    });
  });
  it('sorts a rectangular multi-type selection and deduplicates targets', () => {
    const cells = [
      { rowId: 'twin', date: '2036-03-02' },
      { rowId: 'king', date: '2036-02-29' },
      { rowId: 'king', date: '2036-03-01' },
    ];
    expect(inventorySelection(cells, 'restrictions')).toMatchObject({
      targetIds: ['king', 'twin'],
      endsOn: '2036-03-02',
    });
    expect(inventorySelection(cells, 'blocks')).toMatchObject({
      roomTypeIds: ['king', 'twin'],
      startsOn: '2036-02-29',
      endsOn: '2036-03-03',
    });
  });
  it('returns no prefill for empty selection', () =>
    expect(inventorySelection([], 'blocks')).toBeNull());
});
