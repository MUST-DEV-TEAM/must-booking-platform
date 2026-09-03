import { describe, expect, it, vi } from 'vitest';

import { ClockWorkerService } from './clock-worker.service';

function fakeJob(id: string, name: string, data: unknown) {
  return { id, name, data } as never;
}

function makeWorker(providerEventsRow: unknown) {
  const transaction = {
    $queryRawUnsafe: vi.fn().mockResolvedValue(providerEventsRow ? [providerEventsRow] : []),
  };
  const database = { withTenantTransaction: vi.fn((_context, callback) => callback(transaction)) };
  const hydration = {
    hydrateBooking: vi.fn().mockResolvedValue({ outcome: 'created', bookingId: 'b1' }),
  };
  const queues = {};
  const worker = new ClockWorkerService(queues as never, database as never, hydration as never);
  return { worker, database, hydration };
}

const jobData = {
  tenantId: 'tenant-1',
  propertyId: 'property-1',
  connectionId: 'connection-1',
  eventId: 'event-1',
};

describe('ClockWorkerService dispatch — clock.webhooks/hydrate-event', () => {
  it.each(['booking_new', 'booking_guests_update', 'booking_update', 'booking_canceled'])(
    'calls hydrateBooking for a real %s event',
    async (eventType) => {
      const { worker, hydration } = makeWorker({ eventType, objectId: '12345' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (worker as any).process('clock.webhooks', fakeJob('j1', 'hydrate-event', jobData));
      expect(hydration.hydrateBooking).toHaveBeenCalledWith(
        jobData.tenantId,
        jobData.propertyId,
        jobData.connectionId,
        '12345',
      );
    },
  );

  it('does not call hydrateBooking for an event type not yet applied (e.g. folio_update)', async () => {
    const { worker, hydration } = makeWorker({ eventType: 'folio_update', objectId: '76076600' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (worker as any).process('clock.webhooks', fakeJob('j2', 'hydrate-event', jobData));
    expect(hydration.hydrateBooking).not.toHaveBeenCalled();
  });

  it('does not throw and does not call hydrateBooking when no provider_events row is found', async () => {
    const { worker, hydration } = makeWorker(undefined);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (worker as any).process('clock.webhooks', fakeJob('j3', 'hydrate-event', jobData)),
    ).resolves.toBeUndefined();
    expect(hydration.hydrateBooking).not.toHaveBeenCalled();
  });

  it('throws on malformed job data instead of silently ignoring it', async () => {
    const { worker } = makeWorker({ eventType: 'booking_new', objectId: '1' });
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (worker as any).process('clock.webhooks', fakeJob('j4', 'hydrate-event', { bogus: true })),
    ).rejects.toThrow(/malformed data/);
  });

  it('leaves every other queue/job name on the existing skeleton no-op path', async () => {
    const { worker, hydration } = makeWorker({ eventType: 'booking_new', objectId: '1' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (worker as any).process(
      'clock.catalog.sync',
      fakeJob('j5', 'full-sync', { anything: true }),
    );
    expect(hydration.hydrateBooking).not.toHaveBeenCalled();
  });
});
