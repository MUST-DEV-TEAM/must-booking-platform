import { ClockBookingReadError } from './clock-booking-consistency.service';
import { describe, expect, it, vi } from 'vitest';
import { ClockImportService } from './clock-import.service';
const scope = { tenantId: 't', propertyId: 'p', userId: 'u' };
const credentials = {
  host: 'clock.example.test',
  accountId: '1',
  subscriptionId: '2',
  apiUser: 'u',
  apiKey: 'test',
};
function setup(ids = ['1', '2', '3', '4', '5', '6']) {
  const connections = {
    activePmsConnectionCredentials: vi
      .fn()
      .mockResolvedValue({ provider: 'CLOCK_PMS', connectionId: 'c', credentials }),
  };
  const reader = { listBookingIds: vi.fn().mockResolvedValue(ids) };
  const hydration = { hydrateBooking: vi.fn().mockResolvedValue({ outcome: 'created' }) };
  const audit = { record: vi.fn() };
  return {
    service: new ClockImportService(
      connections as never,
      reader as never,
      hydration as never,
      audit as never,
    ),
    connections,
    reader,
    hydration,
    audit,
  };
}
describe('bounded Clock import', () => {
  it('processes five records and resumes without skipping or repeating earlier IDs', async () => {
    const { service, hydration } = setup(['6', '1', '2', '3', '4', '5', '6']);
    const range = { startsOn: '2027-01-01', endsOn: '2027-02-01' };
    const first = await service.batch(scope, range);
    expect(first.completed).toBe(false);
    expect(first.next.cursor).toBe('5');
    expect(hydration.hydrateBooking).toHaveBeenCalledTimes(5);
    const second = await service.batch(scope, { ...range, ...first.next });
    expect(second.completed).toBe(true);
    expect(hydration.hydrateBooking).toHaveBeenCalledTimes(6);
    expect(hydration.hydrateBooking).toHaveBeenLastCalledWith('t', 'p', 'c', '6', undefined, {
      notify: false,
    });
  });
  it('pauses on a missing mapping and retries the same batch', async () => {
    const { service, hydration } = setup();
    hydration.hydrateBooking.mockResolvedValueOnce({ outcome: 'missing_room_type_mapping' });
    const result = await service.batch(scope, { startsOn: '2027-01-01', endsOn: '2027-02-01' });
    expect(result.blocked).toBe(true);
    expect(result.next).toEqual({ windowStart: '2027-01-01', cursor: '0' });
    expect(hydration.hydrateBooking).toHaveBeenCalledTimes(1);
  });
  it('moves an empty month forward with a bounded 31-day list query', async () => {
    const { service, reader } = setup([]);
    const result = await service.batch(scope, { startsOn: '2027-01-01', endsOn: '2027-04-01' });
    expect(reader.listBookingIds).toHaveBeenCalledWith(credentials, {
      startsOn: '2027-01-01',
      endsOn: '2027-02-01',
    });
    expect(result.next.windowStart).toBe('2027-02-01');
    expect(result.completed).toBe(false);
  });
  it('refuses local properties without requesting Clock data', async () => {
    const { service, connections, reader } = setup();
    connections.activePmsConnectionCredentials.mockResolvedValue(null as never);
    await expect(
      service.batch(scope, { startsOn: '2027-01-01', endsOn: '2027-02-01' }),
    ).rejects.toThrow('only for a connected Clock');
    expect(reader.listBookingIds).not.toHaveBeenCalled();
  });
  it('pauses safely after a read interruption without claiming completion or skipping records', async () => {
    const { service, hydration, audit } = setup();
    hydration.hydrateBooking.mockRejectedValueOnce(
      new ClockBookingReadError({
        category: 'rate_limited',
        code: 'clock_rate_limited',
        message: 'private upstream detail',
        retryable: true,
      }),
    );
    await expect(
      service.batch(scope, { startsOn: '2027-01-01', endsOn: '2027-02-01' }),
    ).rejects.toThrow('Your progress is saved');
    expect(hydration.hydrateBooking).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'clock.import_read_failed',
        details: { category: 'rate_limited', code: 'clock_rate_limited' },
      }),
    );
  });
  it('rejects invalid dates, excessive ranges, and cursors outside the range', async () => {
    const { service, reader } = setup();
    for (const body of [
      { startsOn: '2027-02-30', endsOn: '2027-03-01' },
      { startsOn: '2027-01-01', endsOn: '2029-01-01' },
      { startsOn: '2027-01-01', endsOn: '2027-02-01', windowStart: '2026-12-01' },
      { startsOn: '2027-01-01', endsOn: '2027-02-01', cursor: 'bad' },
    ])
      await expect(service.batch(scope, body)).rejects.toThrow('valid import range');
    expect(reader.listBookingIds).not.toHaveBeenCalled();
  });
});
