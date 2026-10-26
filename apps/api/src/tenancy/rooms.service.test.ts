import { describe, expect, it, vi } from 'vitest';

import { RoomsService } from './rooms.service';

const tenantId = 'a1111111-1111-4111-8111-111111111111';
const propertyId = 'b2222222-2222-4222-8222-222222222222';
const roomTypeId = 'c3333333-3333-4333-8333-333333333333';
const actorUserId = 'd4444444-4444-4444-8444-444444444444';

function service(
  typeRules: string | null = 'Room type rules.',
  ownRules: string | null = 'No smoking.',
) {
  const queryRaw = vi
    .fn()
    .mockResolvedValueOnce([{ id: roomTypeId, rules: typeRules }])
    .mockResolvedValueOnce([
      {
        id: 'room-id',
        name: '101',
        title: 'Deluxe Sea Suite',
        roomSize: '70m²',
        rules: ownRules,
        description: 'A private sea-facing suite.',
        floor: 1,
        viewType: 'Sea view',
        isActive: true,
      },
    ]);
  const database = {
    withTenantTransaction: async (
      _context: unknown,
      callback: (tx: { $queryRaw: typeof queryRaw }) => Promise<unknown>,
    ) => callback({ $queryRaw: queryRaw }),
  };
  const audit = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
  const storage = { publicUrl: vi.fn((key: string) => `https://cdn.example.test/${key}`) };
  return { rooms: new RoomsService(database as never, audit as never, storage as never), queryRaw };
}

describe('RoomsService room presentation validation', () => {
  it('persists trimmed title, room size, rules, description, floor, and view type', async () => {
    const { rooms } = service();

    await expect(
      rooms.create(tenantId, propertyId, roomTypeId, actorUserId, {
        name: '101',
        title: ' Deluxe Sea Suite ',
        roomSize: ' 70m² ',
        rules: ' No smoking. ',
        description: ' A private sea-facing suite. ',
        floor: 1,
        viewType: ' Sea view ',
      }),
    ).resolves.toEqual({
      id: 'room-id',
      name: '101',
      title: 'Deluxe Sea Suite',
      roomSize: '70m²',
      rules: 'No smoking.',
      effectiveRules: 'No smoking.',
      rulesSource: 'room',
      description: 'A private sea-facing suite.',
      floor: 1,
      viewType: 'Sea view',
      isActive: true,
    });
  });

  it('persists an inactive room when requested', async () => {
    const { rooms, queryRaw } = service();

    await rooms.create(tenantId, propertyId, roomTypeId, actorUserId, {
      name: 'Maintenance room',
      isActive: false,
    });

    expect(queryRaw.mock.calls[1]).toContain(false);
  });

  it('returns room type rules when a room has no override', async () => {
    const { rooms } = service('No smoking in the room.', null);

    await expect(
      rooms.create(tenantId, propertyId, roomTypeId, actorUserId, { name: '102' }),
    ).resolves.toMatchObject({
      rules: null,
      effectiveRules: 'No smoking in the room.',
      rulesSource: 'room-type',
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
    [{ rules: 123 }, 'rules must be a string or null.'],
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
    const storage = { publicUrl: vi.fn((key: string) => key) };
    const rooms = new RoomsService(database as never, audit as never, storage as never);

    await expect(rooms.remove(tenantId, propertyId, 'room-id', actorUserId)).rejects.toThrow(
      'Cannot delete a room with assigned amenities or other dependent records.',
    );
  });

  it('lists only a scoped room gallery and resolves stored objects to public URLs', async () => {
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'room-id' }])
      .mockResolvedValueOnce([
        {
          id: 'photo-id',
          sourceUrl: null,
          objectKey: 'rooms/room-photo.jpg',
          sortOrder: 0,
          isPrimary: true,
          createdAt: new Date('2026-10-17T00:00:00.000Z'),
        },
      ]);
    const database = {
      withTenantTransaction: async (
        context: unknown,
        callback: (tx: { $queryRaw: typeof queryRaw }) => Promise<unknown>,
      ) => {
        expect(context).toEqual({ tenantId, propertyId });
        return callback({ $queryRaw: queryRaw });
      },
    };
    const rooms = new RoomsService(
      database as never,
      { recordInTransaction: vi.fn() } as never,
      { publicUrl: vi.fn((key: string) => `https://cdn.example.test/${key}`) } as never,
    );

    await expect(rooms.listImages(tenantId, propertyId, 'room-id')).resolves.toMatchObject([
      { id: 'photo-id', url: 'https://cdn.example.test/rooms/room-photo.jpg', isPrimary: true },
    ]);
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it('adds a validated URL as the first primary room photo and records the change', async () => {
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'room-id' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 0, nextOrder: 0 }]);
    const executeRaw = vi.fn().mockResolvedValue(1);
    const database = {
      withTenantTransaction: async (
        _context: unknown,
        callback: (tx: {
          $queryRaw: typeof queryRaw;
          $executeRaw: typeof executeRaw;
        }) => Promise<unknown>,
      ) => callback({ $queryRaw: queryRaw, $executeRaw: executeRaw }),
    };
    const audit = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
    const rooms = new RoomsService(
      database as never,
      audit as never,
      { publicUrl: vi.fn((key: string) => key) } as never,
    );

    await expect(
      rooms.createImageFromUrl(tenantId, propertyId, 'room-id', actorUserId, {
        url: 'https://images.example.test/room.jpg',
      }),
    ).resolves.toMatchObject({
      sourceUrl: 'https://images.example.test/room.jpg',
      sortOrder: 0,
      isPrimary: true,
    });
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(audit.recordInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'room_image.created_from_url', targetType: 'room_image' }),
    );
  });

  it('creates a scoped presigned room photo upload and library entry', async () => {
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'room-id' }])
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([{ nextOrder: 0 }]);
    const executeRaw = vi.fn().mockResolvedValue(1);
    const database = {
      withTenantTransaction: async (
        context: unknown,
        callback: (tx: {
          $queryRaw: typeof queryRaw;
          $executeRaw: typeof executeRaw;
        }) => Promise<unknown>,
      ) => {
        expect(context).toEqual({ tenantId, propertyId });
        return callback({ $queryRaw: queryRaw, $executeRaw: executeRaw });
      },
    };
    const storage = {
      createPresignedUpload: vi
        .fn()
        .mockResolvedValue({ uploadUrl: 'https://upload.example.test/photo' }),
      publicUrl: vi.fn((key: string) => `https://cdn.example.test/${key}`),
    };
    const audit = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
    const rooms = new RoomsService(database as never, audit as never, storage as never);

    await expect(
      rooms.createImageUpload(tenantId, propertyId, 'room-id', actorUserId, {
        contentType: 'image/png',
        contentLength: 100,
      }),
    ).resolves.toMatchObject({
      uploadUrl: 'https://upload.example.test/photo',
      publicUrl: expect.stringMatching(/^https:\/\/cdn\.example\.test\/rooms\//),
    });
    expect(executeRaw).toHaveBeenCalledTimes(2);
    expect(storage.createPresignedUpload).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: 'image/png', contentLength: 100 }),
    );
  });
});
