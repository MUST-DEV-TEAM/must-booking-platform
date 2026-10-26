import { describe, expect, it } from 'vitest';
import { stockInput, stockDay } from './inventory-stock-input';
const id = '11111111-1111-4111-8111-111111111111';
const body = {
  roomTypeIds: [id],
  startsOn: '2036-02-28',
  endsOn: '2036-03-02',
  operation: 'set',
  value: 3,
};
describe('stock input', () => {
  it('normalizes legacy writes and explicit selection', () => {
    expect(
      stockInput({
        roomTypeId: id,
        startsOn: body.startsOn,
        endsOn: body.endsOn,
        availableUnits: 3,
      }).cells,
    ).toHaveLength(3);
    expect(
      stockInput({ cells: [{ roomTypeId: id, date: '2036-02-29' }], operation: 'reset' }),
    ).toMatchObject({ value: 0, operation: 'reset' });
  });
  it.each([
    { ...body, value: -1 },
    { ...body, value: 1.5 },
    { ...body, endsOn: '2036-02-28' },
    { ...body, weekdays: [1, 1] },
    { ...body, weekdays: [0] },
    { ...body, roomTypeIds: [id, id] },
    { ...body, endsOn: '2040-01-01' },
    { ...body, startsOn: '2036-02-30' },
    {
      cells: [
        { roomTypeId: id, date: '2036-02-29' },
        { roomTypeId: id, date: '2036-02-29' },
      ],
      operation: 'set',
      value: 1,
    },
  ])('rejects invalid or oversized requests %#', (input) =>
    expect(() => stockInput(input)).toThrow(),
  );
  it('rejects mixed cell/rectangle payloads and dates without a representable exclusive end', () => {
    expect(() =>
      stockInput({ ...body, cells: [{ roomTypeId: id, date: '2036-02-29' }] }),
    ).toThrow();
    expect(() =>
      stockInput({ cells: [{ roomTypeId: id, date: '9999-12-31' }], operation: 'set', value: 1 }),
    ).toThrow();
  });
  it('uses calendar days across leap years and DST', () => {
    expect(stockDay('2036-02-28', 1)).toBe('2036-02-29');
    expect(stockDay('2026-10-25', 1)).toBe('2026-10-26');
  });
});
