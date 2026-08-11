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
