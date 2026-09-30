import { describe, expect, it, vi } from 'vitest';

import { RoomTypesService } from './room-types.service';

const tenantId = 'a1111111-1111-4111-8111-111111111111';
const propertyId = 'b2222222-2222-4222-8222-222222222222';
const actorUserId = 'c3333333-3333-4333-8333-333333333333';

function service() {
  const queryRaw = vi.fn().mockResolvedValue([
    {
      id: 'room-type-id',
      name: 'Deluxe',
      description: null,
      amenitiesIntro: null,
      mainImageUrl: 'https://images.example.test/deluxe.jpg',
      galleryImageUrls: ['https://images.example.test/deluxe-1.jpg'],
      maxOccupancy: 2,
    },
  ]);
  const database = {
    withTenantTransaction: async (
      _context: unknown,
      callback: (tx: { $queryRaw: typeof queryRaw }) => Promise<unknown>,
    ) => callback({ $queryRaw: queryRaw }),
  };
  const audit = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
  const storage = { createPresignedUpload: vi.fn(), publicUrl: vi.fn() };
  return {
    roomTypes: new RoomTypesService(database as never, audit as never, storage as never),
    queryRaw,
  };
}

describe('RoomTypesService presentation-image validation', () => {
  it('trims amenitiesIntro like description and persists it on create', async () => {
    const { roomTypes, queryRaw } = service();

    await roomTypes.create(tenantId, propertyId, actorUserId, {
      name: 'Deluxe',
      maxOccupancy: 2,
      amenitiesIntro: '  Everything needed for a comfortable stay.  ',
    });

    expect(queryRaw.mock.calls[0]).toContain('Everything needed for a comfortable stay.');
  });

  it('normalizes a blank amenitiesIntro to null', async () => {
    const { roomTypes, queryRaw } = service();

    await roomTypes.create(tenantId, propertyId, actorUserId, {
      name: 'Deluxe',
      maxOccupancy: 2,
      amenitiesIntro: '   ',
    });

    expect(queryRaw.mock.calls[0]).toContain(null);
  });

  it('persists amenitiesIntro on update', async () => {
    const { roomTypes, queryRaw } = service();

    await roomTypes.update(tenantId, propertyId, 'room-type-id', actorUserId, {
      name: 'Deluxe',
      maxOccupancy: 2,
      amenitiesIntro: 'Amenities for every guest.',
    });

    expect(queryRaw.mock.calls[0]).toContain('Amenities for every guest.');
  });

  it('accepts http(s) main and gallery image URLs', async () => {
    const { roomTypes } = service();

    await expect(
      roomTypes.create(tenantId, propertyId, actorUserId, {
        name: 'Deluxe',
        maxOccupancy: 2,
        mainImageUrl: ' https://images.example.test/deluxe.jpg ',
        galleryImageUrls: ['https://images.example.test/deluxe-1.jpg'],
      }),
    ).resolves.toMatchObject({
      mainImageUrl: 'https://images.example.test/deluxe.jpg',
      galleryImageUrls: ['https://images.example.test/deluxe-1.jpg'],
    });
  });

  it.each([
    [
      { mainImageUrl: 'ftp://images.example.test/deluxe.jpg' },
      'mainImageUrl must be an http(s) URL.',
    ],
    [
      { galleryImageUrls: 'https://images.example.test/deluxe.jpg' },
      'galleryImageUrls must be an array of image URLs.',
    ],
    [
      {
        galleryImageUrls: [
          'https://images.example.test/duplicate.jpg',
          'https://images.example.test/duplicate.jpg',
        ],
      },
      'galleryImageUrls must not contain duplicates.',
    ],
  ])('rejects invalid image input %#', async (presentation, message) => {
    const { roomTypes, queryRaw } = service();

    await expect(
      roomTypes.create(tenantId, propertyId, actorUserId, {
        name: 'Deluxe',
        maxOccupancy: 2,
        ...presentation,
      }),
    ).rejects.toThrow(message);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

describe('RoomTypesService property image library', () => {
  const libraryId = 'd4444444-4444-4444-8444-444444444444';
  const roomTypeId = 'e5555555-5555-4555-8555-555555555555';

  function libraryService(queryResults: unknown[][]) {
    const queryRaw = vi.fn();
    for (const result of queryResults) queryRaw.mockResolvedValueOnce(result);
    const executeRaw = vi.fn().mockResolvedValue(1);
    const database = {
      withTenantTransaction: async (
        _context: unknown,
        callback: (tx: { $queryRaw: typeof queryRaw; $executeRaw: typeof executeRaw }) => unknown,
      ) => callback({ $queryRaw: queryRaw, $executeRaw: executeRaw }),
    };
    const audit = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
    const storage = {
      createPresignedUpload: vi.fn().mockResolvedValue({ uploadUrl: 'https://upload.test/x' }),
      publicUrl: vi.fn((key: string) => `https://cdn.test/${key}`),
      deleteObject: vi.fn().mockResolvedValue(undefined),
    };
    return {
      roomTypes: new RoomTypesService(database as never, audit as never, storage as never),
      queryRaw,
      executeRaw,
      storage,
    };
  }

  it('refuses to delete a library photo that a room type still uses', async () => {
    const { roomTypes, storage, executeRaw } = libraryService([
      [{ objectKey: 'library/a.jpg' }],
      [{ count: 2 }],
    ]);

    await expect(
      roomTypes.removeLibraryImage(tenantId, propertyId, libraryId, actorUserId),
    ).rejects.toThrow('This photo is used by a room type.');
    expect(executeRaw).not.toHaveBeenCalled();
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('deletes an unused library photo and its stored object', async () => {
    const { roomTypes, storage, executeRaw } = libraryService([
      [{ objectKey: 'library/a.jpg' }],
      [{ count: 0 }],
    ]);

    await roomTypes.removeLibraryImage(tenantId, propertyId, libraryId, actorUserId);

    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(storage.deleteObject).toHaveBeenCalledWith('library/a.jpg');
  });

  it('attaches a library photo once and promotes it when asked to be the main image', async () => {
    const { roomTypes, executeRaw } = libraryService([
      [{ id: roomTypeId }],
      [{ id: libraryId, objectKey: 'library/a.jpg' }],
      [{ id: 'existing-1', objectKey: 'library/b.jpg' }],
      [{ nextOrder: 1 }],
      [], // syncImageFields read
    ]);

    await expect(
      roomTypes.attachLibraryImages(tenantId, propertyId, roomTypeId, actorUserId, {
        libraryImageIds: [libraryId],
        asPrimary: true,
      }),
    ).resolves.toEqual({ added: 1 });
    // insert the attachment, promote it, then sync the legacy image columns
    expect(executeRaw).toHaveBeenCalledTimes(3);
  });

  it('does not duplicate a photo that is already in the room type', async () => {
    const { roomTypes, executeRaw } = libraryService([
      [{ id: roomTypeId }],
      [{ id: libraryId, objectKey: 'library/a.jpg' }],
      [{ id: 'existing-1', objectKey: 'library/a.jpg' }],
      [{ nextOrder: 1 }],
      [],
    ]);

    await expect(
      roomTypes.attachLibraryImages(tenantId, propertyId, roomTypeId, actorUserId, {
        libraryImageIds: [libraryId],
      }),
    ).resolves.toEqual({ added: 0 });
    expect(executeRaw).toHaveBeenCalledTimes(1); // only the legacy column sync
  });

  it('publishes a library upload only after the file is found in storage', async () => {
    const { roomTypes, executeRaw } = libraryService([
      [{ objectKey: 'library/a.jpg', confirmedAt: null }],
    ]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    try {
      await roomTypes.confirmLibraryUpload(tenantId, propertyId, libraryId);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(fetchMock).toHaveBeenCalledWith(
      'https://cdn.test/library/a.jpg',
      expect.objectContaining({ method: 'HEAD' }),
    );
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it('does not publish a library upload whose file is missing from storage', async () => {
    const { roomTypes, executeRaw } = libraryService([
      [{ objectKey: 'library/a.jpg', confirmedAt: null }],
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    try {
      await expect(roomTypes.confirmLibraryUpload(tenantId, propertyId, libraryId)).rejects.toThrow(
        'The uploaded file was not found in storage.',
      );
    } finally {
      vi.unstubAllGlobals();
    }
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('removes abandoned uploads when listing the library', async () => {
    const { roomTypes, storage } = libraryService([
      [{ objectKey: 'library/stale.jpg' }],
      [
        {
          id: libraryId,
          objectKey: 'library/a.jpg',
          originalName: 'a.jpg',
          createdAt: new Date(),
          usageCount: 1,
        },
      ],
    ]);

    const images = await roomTypes.listLibrary(tenantId, propertyId);

    expect(images).toEqual([
      expect.objectContaining({ id: libraryId, url: 'https://cdn.test/library/a.jpg' }),
    ]);
    expect(storage.deleteObject).toHaveBeenCalledWith('library/stale.jpg');
  });

  it.each([
    [{}, 'libraryImageIds must be a unique list'],
    [{ libraryImageIds: [] }, 'libraryImageIds must be a unique list'],
    [{ libraryImageIds: ['not-a-uuid'] }, 'libraryImageIds must be a unique list'],
    [
      { libraryImageIds: [libraryId, 'f6666666-6666-4666-8666-666666666666'], asPrimary: true },
      'asPrimary requires exactly one library photo.',
    ],
  ])('rejects invalid attach input %#', async (body, message) => {
    const { roomTypes, queryRaw } = libraryService([]);

    await expect(
      roomTypes.attachLibraryImages(tenantId, propertyId, roomTypeId, actorUserId, body),
    ).rejects.toThrow(message);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
