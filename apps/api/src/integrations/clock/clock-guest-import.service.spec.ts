import { describe, expect, it, vi } from 'vitest';
import { ClockGuestImportService } from './clock-guest-import.service';
const credentials = {
  host: 'clock.example.test',
  accountId: '1',
  subscriptionId: '2',
  apiUser: 'u',
  apiKey: 'test',
};
function setup() {
  const tx = { $executeRaw: vi.fn().mockResolvedValue(1) };
  const db = { withTenantTransaction: vi.fn(async (_s, fn) => fn(tx)) };
  const connections = {
    activePmsConnectionCredentials: vi
      .fn()
      .mockResolvedValue({ provider: 'CLOCK_PMS', connectionId: 'c', credentials }),
  };
  const reader = {
    guestIds: vi.fn().mockResolvedValue(['6', '1', '2', '3', '4', '5']),
    guestDetail: vi.fn().mockImplementation(async (_c, id) => ({
      family_id: id,
      first_name: 'Guest',
      e_mail: null,
      phone_number: null,
      updated_at: '2026-10-21T00:00:00Z',
    })),
  };
  const audit = { record: vi.fn() };
  return {
    service: new ClockGuestImportService(
      db as never,
      connections as never,
      reader as never,
      audit as never,
    ),
    tx,
    reader,
    connections,
  };
}
const scope = { tenantId: 't', propertyId: 'p', userId: 'u' },
  range = { updatedFrom: '1970-01-01', updatedUntil: '2026-10-22' };
describe('Clock guest profile import', () => {
  it('retains missing email, batches five, resumes and caches the filtered index', async () => {
    const { service, tx, reader } = setup();
    const first = await service.batch(scope, range);
    expect(first).toMatchObject({ processed: 5, total: 6, cursor: '5', completed: false });
    expect(tx.$executeRaw.mock.calls[0].slice(1)).toContain(null);
    const second = await service.batch(scope, { ...range, cursor: first.cursor });
    expect(second.completed).toBe(true);
    expect(reader.guestIds).toHaveBeenCalledTimes(1);
    expect(reader.guestDetail).toHaveBeenCalledTimes(6);
  });
  it('never advances past an unreadable guest identity', async () => {
    const { service, reader } = setup();
    reader.guestDetail.mockResolvedValueOnce({ first_name: 'Missing identity' } as never);
    await expect(service.batch(scope, range)).rejects.toThrow('stable identity');
    expect(reader.guestDetail).toHaveBeenCalledTimes(1);
  });
  it('refuses a standalone hotel without reading Clock', async () => {
    const { service, reader, connections } = setup();
    connections.activePmsConnectionCredentials.mockResolvedValue(null as never);
    await expect(service.batch(scope, range)).rejects.toThrow('Connect Clock');
    expect(reader.guestIds).not.toHaveBeenCalled();
  });
});
