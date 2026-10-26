import { describe, it, expect } from 'vitest';
import { availableOn } from './clock-sync';
describe('synchronized Clock sellable rooms', () => {
  it('sums complete stored room-type snapshots and counts closed rooms as zero', () => {
    expect(
      availableOn(
        {
          roomTypes: [
            {
              id: 'a',
              name: 'A',
              days: [{ date: '2026-10-22', status: 'available', availableUnits: 3 }],
            },
            {
              id: 'b',
              name: 'B',
              days: [{ date: '2026-10-22', status: 'closed', availableUnits: 2 }],
            },
          ],
        },
        '2026-10-22',
      ),
    ).toBe(3);
  });
  it('leaves incomplete data unknown and preserves a real sold-out zero', () => {
    expect(
      availableOn({ roomTypes: [{ id: 'a', name: 'A', days: [] }] }, '2026-10-22'),
    ).toBeUndefined();
    expect(
      availableOn(
        {
          roomTypes: [
            {
              id: 'a',
              name: 'A',
              days: [{ date: '2026-10-22', status: 'sold_out', availableUnits: 0 }],
            },
          ],
        },
        '2026-10-22',
      ),
    ).toBe(0);
  });
});
