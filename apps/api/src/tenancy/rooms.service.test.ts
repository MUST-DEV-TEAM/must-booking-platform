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
    .mockResolvedValueOnce([
      {
        id: 'room-id',
        name: '101',
        title: 'Deluxe Sea Suite',
        roomSize: '70m²',
        rules: 'No smoking.',
        floor: 1,
        viewType: 'Sea view',
      },
    ]);
  const database = {
    withTenantTransaction: async (
      _context: unknown,
      callback: (tx: { $queryRaw: typeof queryRaw }) => Promise<unknown>,
    ) => callback({ $queryRaw: queryRaw }),
  };
  const audit = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
  return { rooms: new RoomsService(database as never, audit as never), queryRaw };
}

describe('RoomsService room presentation validation', () => {
  it('persists trimmed title, room size, rules, floor, and view type', async () => {
    const { rooms } = service();

    await expect(
      rooms.create(tenantId, propertyId, roomTypeId, actorUserId, {
        name: '101',
        title: ' Deluxe Sea Suite ',
        roomSize: ' 70m² ',
        rules: ' No smoking. ',
        floor: 1,
        viewType: ' Sea view ',
      }),
    ).resolves.toEqual({
      id: 'room-id',
      name: '101',
      title: 'Deluxe Sea Suite',
      roomSize: '70m²',
      rules: 'No smoking.',
      floor: 1,
      viewType: 'Sea view',
    });
  });

  it.each([
    [{ floor: '1' }, 'floor must be an integer between -10 and 200.'],
    [{ floor: 1.5 }, 'floor must be an integer between -10 and 200.'],
    [{ floor: -11 }, 'floor must be an integer between -10 and 200.'],
    [{ floor: 201 }, 'floor must be an integer between -10 and 200.'],
    [{ title: 'x'.repeat(201) }, 'title must be at most 200 characters.'],
    [{ roomSize: 'x'.repeat(51) }, 'roomSize must be at most 50 characters.'],
    [{ viewType: 'x'.repeat(101) }, 'viewType must be at most 100 characters.'],
  ])('rejects invalid room presentation input %#', async (presentation, message) => {
    const { rooms, queryRaw } = service();

    await expect(
      rooms.create(tenantId, propertyId, roomTypeId, actorUserId, { name: '101', ...presentation }),
    ).rejects.toThrow(message);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('reports a clear conflict when a room with amenity overrides is deleted', async () => {
    const queryRaw = vi.fn().mockRejectedValue({ code: 'P2010', meta: { code: '23503' } });
    const database = {
      withTenantTransaction: async (
        _context: unknown,
        callback: (tx: { $queryRaw: typeof queryRaw }) => Promise<unknown>,
      ) => callback({ $queryRaw: queryRaw }),
    };
    const audit = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
    const rooms = new RoomsService(database as never, audit as never);

    await expect(rooms.remove(tenantId, propertyId, 'room-id', actorUserId)).rejects.toThrow(
      'Cannot delete a room with assigned amenities or other dependent records.',
    );
  });
});
