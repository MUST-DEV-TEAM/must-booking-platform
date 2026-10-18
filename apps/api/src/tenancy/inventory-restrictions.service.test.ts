import { describe, expect, it } from 'vitest';
import { restrictionInput } from './inventory-restrictions.service';
const input = {
  name: ' Stay ',
  type: 'minimum_stay',
  value: 3,
  scope: 'property',
  targetIds: [],
  startsOn: '2026-11-01',
  endsOn: null,
};
describe('Restriction input validation', () => {
  it('normalizes names, defaults, weekdays and scoped IDs', () => {
    expect(restrictionInput(input)).toMatchObject({
      name: 'Stay',
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      priority: 50,
      internalReason: '',
    });
  });
  it.each([
    { name: '' },
    { name: 'x'.repeat(201) },
    { type: 'maximum_advance' },
    { value: 0 },
    { value: 1.5 },
    { value: 2147483648 },
    { scope: 'room' },
    { targetIds: ['not-a-uuid'] },
    { scope: 'room_type', targetIds: [] },
    { startsOn: '2026-11-02', endsOn: '2026-11-02', weekdays: [2] },
    { weekdays: [] },
    { weekdays: [0] },
    { weekdays: [8] },
    { weekdays: [1, 1] },
    { priority: 0 },
    { priority: 101 },
    { priority: 2.5 },
    { startsOn: '2026-02-30' },
    { startsOn: '0000-01-01' },
    { endsOn: '2026-10-31' },
    { endsOn: '2026-11-31' },
    { internalReason: 'x'.repeat(4001) },
    { type: 'stop_sell', value: 2 },
    { type: 'minimum_advance', value: -1 },
  ])('rejects invalid fields: %j', (patch) => {
    expect(() => restrictionInput({ ...input, ...patch })).toThrow();
  });
  it('supports same-date inclusive periods and zero-day advance', () => {
    expect(restrictionInput({ ...input, endsOn: input.startsOn }).endsOn).toBe(input.startsOn);
    expect(restrictionInput({ ...input, type: 'minimum_advance', value: 0 }).value).toBe(0);
  });
  it('canonicalizes UUID casing for target validation and idempotency', () => {
    expect(
      restrictionInput({
        ...input,
        scope: 'room_type',
        targetIds: ['ABCDEFAB-1111-4111-8111-ABCDEFABCDEF'],
      }).targetIds,
    ).toEqual(['abcdefab-1111-4111-8111-abcdefabcdef']);
  });
});
