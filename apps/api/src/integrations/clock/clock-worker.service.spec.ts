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
  const folioHydration = {
    hydrateFolio: vi.fn().mockResolvedValue({ outcome: 'applied', bookingId: 'b1' }),
  };
  const queues = { enqueue: vi.fn().mockResolvedValue(undefined) };
  const connections = {
    activeClockPmsProperties: vi.fn().mockResolvedValue([
      { tenantId: 'tenant-1', propertyId: 'property-1' },
      { tenantId: 'tenant-2', propertyId: 'property-2' },
    ]),
  };
  const consistency = { check: vi.fn().mockResolvedValue({ findings: [] }) };
  const paymentReconciliation = {
    check: vi.fn().mockResolvedValue({ bookingsChecked: 0, findings: [] }),
  };
  const worker = new ClockWorkerService(
    queues as never,
    database as never,
    hydration as never,
    folioHydration as never,
    connections as never,
    consistency as never,
    paymentReconciliation as never,
  );
  return {
    worker,
    database,
    hydration,
    folioHydration,
    queues,
    connections,
    consistency,
    paymentReconciliation,
  };
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

  it.each(['folio_update', 'folio_close'])(
    'calls hydrateFolio for a real %s event (Task C, docs/CLOCK_CERTIFICATION_GAPS_PLAN.md)',
    async (eventType) => {
      const { worker, hydration, folioHydration } = makeWorker({
        eventType,
        objectId: '76076600',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (worker as any).process('clock.webhooks', fakeJob('j2', 'hydrate-event', jobData));
      expect(folioHydration.hydrateFolio).toHaveBeenCalledWith(
        jobData.tenantId,
        jobData.propertyId,
        '76076600',
      );
      expect(hydration.hydrateBooking).not.toHaveBeenCalled();
    },
  );

  it('does not call hydrateBooking or hydrateFolio for an event type not yet applied', async () => {
    const { worker, hydration, folioHydration } = makeWorker({
      eventType: 'booking_task_update',
      objectId: '31482380',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (worker as any).process('clock.webhooks', fakeJob('j2b', 'hydrate-event', jobData));
    expect(hydration.hydrateBooking).not.toHaveBeenCalled();
    expect(folioHydration.hydrateFolio).not.toHaveBeenCalled();
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

describe('ClockWorkerService dispatch — clock.reconciliation', () => {
  it('fans a scheduled run out to every active Clock property over a 31-day rolling window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-03T12:00:00.000Z'));
    try {
      const { worker, connections, queues } = makeWorker(undefined);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (worker as any).process(
        'clock.reconciliation',
        fakeJob('reconcile-schedule', 'schedule-reconciliation', {}),
      );

      expect(connections.activeClockPmsProperties).toHaveBeenCalledOnce();
      expect(queues.enqueue).toHaveBeenCalledTimes(4);
      expect(queues.enqueue).toHaveBeenNthCalledWith(
        1,
        'clock.reconciliation',
        'reconcile-property',
        {
          tenantId: 'tenant-1',
          propertyId: 'property-1',
          startsOn: '2026-08-04',
          endsOn: '2026-09-04',
        },
        { jobId: 'clock-reconciliation-tenant-1-property-1-2026-08-04' },
      );
      expect(queues.enqueue).toHaveBeenNthCalledWith(
        2,
        'clock.reconciliation',
        'reconcile-payments',
        { tenantId: 'tenant-1', propertyId: 'property-1', since: '2026-08-04' },
        { jobId: 'clock-payment-reconciliation-tenant-1-property-1-2026-08-04' },
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs the existing consistency checker without duplicating its alerting', async () => {
    const { worker, consistency } = makeWorker(undefined);
    const data = {
      tenantId: 'tenant-1',
      propertyId: 'property-1',
      startsOn: '2026-08-04',
      endsOn: '2026-09-04',
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (worker as any).process(
      'clock.reconciliation',
      fakeJob('reconcile-property', 'reconcile-property', data),
    );

    expect(consistency.check).toHaveBeenCalledWith('tenant-1', 'property-1', {
      startsOn: '2026-08-04',
      endsOn: '2026-09-04',
    });
  });

  it('runs the payment reconciliation checker on reconcile-payments jobs', async () => {
    const { worker, paymentReconciliation } = makeWorker(undefined);
    const data = { tenantId: 'tenant-1', propertyId: 'property-1', since: '2026-08-04' };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (worker as any).process(
      'clock.reconciliation',
      fakeJob('reconcile-payments', 'reconcile-payments', data),
    );

    expect(paymentReconciliation.check).toHaveBeenCalledWith(
      'tenant-1',
      'property-1',
      new Date('2026-08-04T00:00:00Z'),
    );
  });

  it('rejects malformed payment-reconciliation jobs', async () => {
    const { worker } = makeWorker(undefined);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (worker as any).process(
        'clock.reconciliation',
        fakeJob('malformed-reconcile-payments', 'reconcile-payments', { tenantId: 'tenant-1' }),
      ),
    ).rejects.toThrow(/malformed data/);
  });

  it('rejects malformed reconciliation jobs', async () => {
    const { worker } = makeWorker(undefined);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (worker as any).process(
        'clock.reconciliation',
        fakeJob('malformed-reconcile-property', 'reconcile-property', { tenantId: 'tenant-1' }),
      ),
    ).rejects.toThrow(/malformed data/);
  });
});
