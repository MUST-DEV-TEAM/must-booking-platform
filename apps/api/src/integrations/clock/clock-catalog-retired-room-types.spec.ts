import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClockCatalogSyncService } from './clock-catalog-sync.service';

// Clock keeps returning retired room types (operational_until in the past) that have no rooms. The sync must not
// propose them, nor their rooms, as sellable inventory. Milestone 28 row 5.
function fixture(roomTypes: unknown[], rooms: unknown[]) {
  const audit = { recordInTransaction: vi.fn() };
  const database = {
    withTenantTransaction: vi.fn((_scope, callback) => callback({})),
  };
  const client = {
    request: vi.fn(async (_credentials, request: { path: string }) => ({
      status: 200,
      body: request.path === '/room_types' ? roomTypes : rooms,
    })),
  };
  const connections = {
    activePmsConnectionCredentials: vi.fn().mockResolvedValue({
      provider: 'CLOCK_PMS',
      connectionId: 'connection',
      credentials: {
        host: 'example.test',
        accountId: '1',
        subscriptionId: '2',
        apiUser: 'test',
        apiKey: 'test',
      },
    }),
  };
  const service = new ClockCatalogSyncService(
    database as never,
    connections as never,
    audit as never,
    client as never,
    { consume: vi.fn().mockResolvedValue({ allowed: true }) } as never,
    { assertClosed: vi.fn(), recordSuccess: vi.fn(), recordFailure: vi.fn() } as never,
  );
  const proposed: Array<{ entityType: string; externalEntityId: string }> = [];
  vi.spyOn(service as never, 'upsertMapping').mockImplementation((async (
    _tx: unknown,
    mapping: { entityType: string; externalEntityId: string },
  ) => {
    proposed.push({ entityType: mapping.entityType, externalEntityId: mapping.externalEntityId });
    return 'inserted';
  }) as never);
  return { service, audit, proposed };
}

describe('catalogue sync and retired room types', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-09T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('skips a room type retired in the past, and the rooms that belong to it', async () => {
    const f = fixture(
      [
        { id: 1, name: 'Standard Double room', operational_until: '2024-04-23' },
        { id: 2, name: 'Sea view suite', operational_until: null },
      ],
      [
        { id: 10, name: '101', room_type_id: 1 },
        { id: 20, name: '201', room_type_id: 2 },
      ],
    );
    const result = await f.service.sync('tenant', 'property', null);
    expect(f.proposed).toEqual([
      { entityType: 'ROOM_TYPE', externalEntityId: '2' },
      { entityType: 'ROOM', externalEntityId: '20' },
    ]);
    expect(result.proposed).toBe(2);
    expect(f.audit.recordInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ details: expect.objectContaining({ roomTypes: 1, rooms: 1 }) }),
    );
  });

  it('keeps a room type with no end date, one that ends today, and one that ends later', async () => {
    const f = fixture(
      [
        { id: 1, name: 'No end date' },
        { id: 2, name: 'Ends today', operational_until: '2026-11-09' },
        { id: 3, name: 'Ends later', operational_until: '2027-01-01' },
        { id: 4, name: 'Ended yesterday', operational_until: '2026-11-08' },
      ],
      [],
    );
    await f.service.sync('tenant', 'property', null);
    expect(f.proposed.map((p) => p.externalEntityId)).toEqual(['1', '2', '3']);
  });
});
