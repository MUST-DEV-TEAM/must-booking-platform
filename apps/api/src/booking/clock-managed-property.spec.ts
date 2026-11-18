import { describe, expect, it } from 'vitest';

import { enforcedRoomCapacity } from './clock-managed-property';

describe('enforcedRoomCapacity (task 40-4c)', () => {
  it('always enforces a hotel without Clock', () => {
    expect(enforcedRoomCapacity(false, { maxOccupancy: 3, capacityConfirmedAt: null })).toBe(3);
  });

  it('enforces a Clock room type only once the hotel confirmed it', () => {
    expect(enforcedRoomCapacity(true, { maxOccupancy: 3, capacityConfirmedAt: null })).toBe(
      undefined,
    );
    expect(enforcedRoomCapacity(true, { maxOccupancy: 3 })).toBe(undefined);
    expect(enforcedRoomCapacity(true, { maxOccupancy: 3, capacityConfirmedAt: new Date() })).toBe(
      3,
    );
  });
});
