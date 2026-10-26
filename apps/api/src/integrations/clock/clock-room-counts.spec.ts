import { describe, expect, it, vi } from 'vitest';
import { ClockCatalogSyncService } from './clock-catalog-sync.service';
function setup(
  rooms: unknown = [
    { id: 1, name: '101', room_type_id: 42 },
    { id: 2, name: '102', room_type_id: 42 },
  ],
) {
  const database = {
    withTenantTransaction: vi.fn(async (_scope, fn) =>
      fn({ $queryRaw: vi.fn().mockResolvedValue([{ localId: 'local', externalId: '42' }]) }),
    ),
  };
  const connections = {
    activePmsConnectionCredentials: vi.fn().mockResolvedValue({
      provider: 'CLOCK_PMS',
      connectionId: 'c',
      credentials: {
        host: 'h',
        accountId: '1',
        subscriptionId: '2',
        apiUser: 'u',
        apiKey: 'test',
      },
    }),
  };
  const client = { request: vi.fn().mockResolvedValue({ status: 200, body: rooms }) };
  const service = new ClockCatalogSyncService(
    database as never,
    connections as never,
    {} as never,
    client as never,
    { consume: vi.fn().mockResolvedValue({ allowed: true }) } as never,
    { assertClosed: vi.fn(), recordSuccess: vi.fn(), recordFailure: vi.fn() } as never,
  );
  return { service, connections, client, database };
}
describe('read-only Clock configured room counts', () => {
  it('counts actual provider rooms and caches within one property only', async () => {
    const { service, client, database } = setup();
    const first = await service.roomCounts('tenant', 'one');
    expect(first).toMatchObject({ configuredRooms: 2, byRoomType: { local: 2 } });
    await service.roomCounts('tenant', 'one');
    expect(client.request).toHaveBeenCalledTimes(1);
    await service.roomCounts('tenant', 'two');
    expect(client.request).toHaveBeenCalledTimes(2);
    expect(database.withTenantTransaction).toHaveBeenLastCalledWith(
      { tenantId: 'tenant', propertyId: 'two' },
      expect.any(Function),
    );
  });
  it('rejects unreadable provider data instead of inventing capacity', async () => {
    const { service } = setup([1, 2]);
    await expect(service.roomCounts('tenant', 'p')).rejects.toThrow('could not be verified');
  });
  it('does not contact Clock for a standalone property', async () => {
    const { service, connections, client } = setup();
    connections.activePmsConnectionCredentials.mockResolvedValue(null as never);
    await expect(service.roomCounts('tenant', 'p')).rejects.toThrow('not connected');
    expect(client.request).not.toHaveBeenCalled();
  });
});
