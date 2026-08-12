import { describe, expect, it, vi } from 'vitest';

import { AmenitiesService } from './amenities.service';

const tenantId = 'a1111111-1111-4111-8111-111111111111';
const propertyId = 'b2222222-2222-4222-8222-222222222222';
const actorUserId = 'c3333333-3333-4333-8333-333333333333';

function service() {
  const queryRaw = vi
    .fn()
    .mockResolvedValue([{ id: 'amenity-id', name: 'Breakfast', icon: 'BREAKFAST' }]);
  const database = {
    withTenantTransaction: async (
      _context: unknown,
      callback: (tx: { $queryRaw: typeof queryRaw }) => Promise<unknown>,
    ) => callback({ $queryRaw: queryRaw }),
  };
  const audit = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
  return { amenities: new AmenitiesService(database as never, audit as never), queryRaw };
}

function roomAmenityService() {
  const queryRaw = vi
    .fn()
    .mockResolvedValueOnce([{ id: 'room-id' }])
    .mockResolvedValueOnce([{ id: 'amenity-id' }])
    .mockResolvedValueOnce([{ id: 'amenity-id', name: 'Private balcony', icon: 'BEACH' }]);
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
  return {
    amenities: new AmenitiesService(database as never, audit as never),
    audit,
    executeRaw,
    queryRaw,
  };
}

describe('AmenitiesService icon validation', () => {
  it('persists a curated amenity icon', async () => {
    const { amenities } = service();

    await expect(
      amenities.create(tenantId, propertyId, actorUserId, { name: 'Breakfast', icon: 'BREAKFAST' }),
    ).resolves.toEqual({ id: 'amenity-id', name: 'Breakfast', icon: 'BREAKFAST' });
  });

  it('rejects an icon outside the fixed amenity-icon enum before querying the database', async () => {
    const { amenities, queryRaw } = service();

    await expect(
      amenities.create(tenantId, propertyId, actorUserId, { name: 'Lift', icon: 'ELEVATOR' }),
    ).rejects.toThrow(
      'icon must be one of: WIFI, BREAKFAST, POOL, PARKING, AIR_CONDITIONING, BEACH.',
    );
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

describe('AmenitiesService room amenities', () => {
  it('fully replaces a physical room amenity override', async () => {
    const { amenities, audit, executeRaw } = roomAmenityService();

    await expect(
      amenities.setRoomAmenities(tenantId, propertyId, 'room-id', actorUserId, {
        amenityIds: ['amenity-id'],
      }),
    ).resolves.toEqual([{ id: 'amenity-id', name: 'Private balcony', icon: 'BEACH' }]);

    expect(executeRaw).toHaveBeenCalledTimes(2);
    expect(audit.recordInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'room.amenities_updated', targetId: 'room-id' }),
    );
  });

  it('rejects duplicate room amenity IDs before querying the database', async () => {
    const { amenities, queryRaw } = roomAmenityService();

    await expect(
      amenities.setRoomAmenities(tenantId, propertyId, 'room-id', actorUserId, {
        amenityIds: ['amenity-id', 'amenity-id'],
      }),
    ).rejects.toThrow('amenityIds must not contain duplicates.');
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
