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
