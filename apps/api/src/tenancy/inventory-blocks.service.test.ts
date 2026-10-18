import { describe, expect, it } from 'vitest';
import { blockInput, blockLifecycle, inventoryBlockReasons } from './inventory-blocks.service';
const input = {
  title: ' Maintenance ',
  reason: 'maintenance',
  startsOn: '2035-03-29',
  endsOn: '2035-03-31',
  all: true,
};
describe('Inventory block validation and lifecycle', () => {
  it.each(inventoryBlockReasons)('supports %s', (reason) =>
    expect(blockInput({ ...input, reason }).reason).toBe(reason),
  );
  it.each([
    { startsOn: '2035-02-30' },
    { endsOn: '2035-03-29' },
    { endsOn: '2035-03-28' },
    { all: false },
    { all: true, roomIds: ['bad'] },
    { reason: 'invented' },
    { title: '' },
    { responsibleStaffId: 'bad' },
    { note: 'x'.repeat(501) },
  ])('rejects invalid fields %j', (patch) =>
    expect(() => blockInput({ ...input, ...patch })).toThrow(),
  );
  it('normalizes text and optional fields', () =>
    expect(blockInput(input)).toMatchObject({
      title: 'Maintenance',
      roomIds: [],
      roomTypeIds: [],
      responsibleStaffId: null,
      note: '',
      reference: '',
    }));
  it.each([
    ['2035-03-28', 'Scheduled'],
    ['2035-03-29', 'Active'],
    ['2035-03-30', 'Active'],
    ['2035-03-31', 'Ended'],
  ])('uses property date %s including exclusive end', (today, expected) =>
    expect(blockLifecycle({ ...input, lifecycle: 'Active' }, today)).toBe(expected),
  );
  it.each(['Draft', 'Ended', 'Cancelled'])('keeps explicit %s state', (lifecycle) =>
    expect(blockLifecycle({ ...input, lifecycle }, '2036-01-01')).toBe(lifecycle),
  );
});
