import { describe, expect, it, vi } from 'vitest';

import { RoomsService } from './rooms.service';

const tenantId = 'a1111111-1111-4111-8111-111111111111';
const propertyId = 'b2222222-2222-4222-8222-222222222222';
const roomTypeId = 'c3333333-3333-4333-8333-333333333333';
const actorUserId = 'd4444444-4444-4444-8444-444444444444';

function service() {
  const queryRaw = vi
    .fn()
    .mockResolvedValueOnce([{ id: roomTypeId }])
    .mockResolvedValueOnce([{ id: 'room-id', name: '101', floor: 1, viewType: 'Sea view' }]);
  const database = {
    withTenantTransaction: async (
      _context: unknown,
      callback: (tx: { $queryRaw: typeof queryRaw }) => Promise<unknown>,
    ) => callback({ $queryRaw: queryRaw }),
  };
  const audit = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
  return { rooms: new RoomsService(database as never, audit as never), queryRaw };
}

describe('RoomsService floor and view-type validation', () => {
  it('persists an integer floor and trimmed view type', async () => {
    const { rooms } = service();

    await expect(
      rooms.create(tenantId, propertyId, roomTypeId, actorUserId, {
        name: '101',
        floor: 1,
        viewType: ' Sea view ',
      }),
    ).resolves.toEqual({ id: 'room-id', name: '101', floor: 1, viewType: 'Sea view' });
  });

  it.each([
    [{ floor: '1' }, 'floor must be an integer between -10 and 200.'],
    [{ floor: 1.5 }, 'floor must be an integer between -10 and 200.'],
    [{ floor: -11 }, 'floor must be an integer between -10 and 200.'],
    [{ floor: 201 }, 'floor must be an integer between -10 and 200.'],
    [{ viewType: 'x'.repeat(101) }, 'viewType must be at most 100 characters.'],
  ])('rejects invalid room presentation input %#', async (presentation, message) => {
    const { rooms, queryRaw } = service();

    await expect(
      rooms.create(tenantId, propertyId, roomTypeId, actorUserId, { name: '101', ...presentation }),
    ).rejects.toThrow(message);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
