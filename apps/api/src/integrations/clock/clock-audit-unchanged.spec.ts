import { describe, expect, it, vi } from 'vitest';
import { ClockCatalogSyncService } from './clock-catalog-sync.service';
import { ClockGuestImportService } from './clock-guest-import.service';

// Milestone 38, task 3: a sync or import batch that changes nothing must not add an audit row.
const credentials = {
  provider: 'CLOCK_PMS',
  connectionId: 'connection',
  credentials: {
    host: 'example.test',
    accountId: '1',
    subscriptionId: '2',
    apiUser: 'test',
    apiKey: 'test',
  },
};
const connections = { activePmsConnectionCredentials: vi.fn().mockResolvedValue(credentials) };

function catalogFixture(results: Array<'inserted' | 'updated' | 'unchanged'>) {
  const audit = { recordInTransaction: vi.fn() };
  const service = new ClockCatalogSyncService(
    { withTenantTransaction: vi.fn((_scope, callback) => callback({})) } as never,
    connections as never,
    audit as never,
    {
      request: vi.fn(async (_c, request: { path: string }) => ({
        status: 200,
        body:
          request.path === '/room_types'
            ? [{ id: 1, name: 'Suite' }]
            : [{ id: 10, name: '101', room_type_id: 1 }],
      })),
    } as never,
    { consume: vi.fn().mockResolvedValue({ allowed: true }) } as never,
    { assertClosed: vi.fn(), recordSuccess: vi.fn(), recordFailure: vi.fn() } as never,
  );
  const queue = [...results];
  vi.spyOn(service as never, 'upsertMapping').mockImplementation((async () =>
    queue.shift()) as never);
  return { service, audit };
}

function guestFixture(changed: boolean[], guestIds: string[]) {
  const audit = { record: vi.fn() };
  const queue = [...changed];
  const service = new ClockGuestImportService(
    { withTenantTransaction: vi.fn(async () => [{ changed: queue.shift() ?? false }]) } as never,
    connections as never,
    {
      guestIds: vi.fn().mockResolvedValue(guestIds),
      guestDetail: vi.fn(async (_c, id: string) => ({ family_id: id, first_name: 'Ana' })),
    } as never,
    audit as never,
  );
  return { service, audit };
}

const scope = { tenantId: 'tenant', propertyId: 'property', userId: null };
const range = { updatedFrom: '2026-01-01', updatedUntil: '2026-02-01' };

describe('audit rows only for real changes', () => {
  it('writes no catalogue audit row when nothing changed', async () => {
    const f = catalogFixture(['unchanged', 'unchanged']);
    expect(await f.service.sync('tenant', 'property', null)).toMatchObject({
      proposed: 0,
      updated: 0,
    });
    expect(f.audit.recordInTransaction).not.toHaveBeenCalled();
  });

  it('writes one catalogue audit row when a name changed', async () => {
    const f = catalogFixture(['unchanged', 'updated']);
    await f.service.sync('tenant', 'property', null);
    expect(f.audit.recordInTransaction).toHaveBeenCalledTimes(1);
    expect(f.audit.recordInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ details: expect.objectContaining({ proposed: 0, updated: 1 }) }),
    );
  });

  it('skips the audit row for an unchanged guest batch that is not the last one', async () => {
    const ids = ['1', '2', '3', '4', '5', '6', '7'];
    const f = guestFixture([false, false, false, false, false], ids);
    const result = await f.service.batch(scope, { ...range, cursor: '0' });
    expect(result).toMatchObject({ processed: 5, completed: false });
    expect(f.audit.record).not.toHaveBeenCalled();
  });

  it('records a guest batch that changed a guest, with the count', async () => {
    const f = guestFixture([false, true, false, false, false], ['1', '2', '3', '4', '5', '6']);
    await f.service.batch(scope, { ...range, cursor: '0' });
    expect(f.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'clock.guest_import_batch',
        details: expect.objectContaining({ changed: 1, processed: 5 }),
      }),
    );
  });

  it('keeps one summary row when the run finishes, even if nothing changed', async () => {
    const f = guestFixture([false, false], ['1', '2']);
    await f.service.batch(scope, { ...range, cursor: '0' });
    expect(f.audit.record).toHaveBeenCalledTimes(1);
    expect(f.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({ completed: true, total: 2, changed: 0 }),
      }),
    );
  });
});
