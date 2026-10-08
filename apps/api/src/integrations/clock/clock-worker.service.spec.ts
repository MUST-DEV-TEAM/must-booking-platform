import { describe, expect, it, vi } from 'vitest';

import { ClockWorkerService } from './clock-worker.service';

function fakeJob(id: string, name: string, data: unknown, token = 'token-A', attemptsStarted = 1) {
  return { id, name, data, token, attemptsStarted } as never;
}

function makeWorker(
  providerEventsRow: unknown,
  options: {
    stuckRows?: unknown[];
    executeRowCount?: number;
    reconcileJob?: (queueName: string, jobId: string) => Promise<string>;
    /** processingSnapshotSql's result for the job-recreation CAS read
     * (ADR-0031, fifth corrective round). Defaults to an unclaimed
     * (null-token) row, RECEIVED unless providerEventsRow says otherwise —
     * override to simulate ownership having already changed by the time
     * the snapshot is read (`null` simulates the row having vanished). */
    snapshotRow?: {
      status: string;
      processingToken: string | null;
      processingAttempt: number | null;
    } | null;
  } = {},
) {
  const snapshotRow =
    'snapshotRow' in options
      ? options.snapshotRow
      : {
          status: (providerEventsRow as { status?: string } | undefined)?.status ?? 'RECEIVED',
          processingToken: null,
          processingAttempt: null,
        };
  const transaction = {
    // Routed by SQL shape, not call order: the initial provider_events row
    // SELECT (processHydrateEvent, also reused by markHydrateEventFailed's
    // standalone eventRowId() lookup) and the job-recreation CAS snapshot
    // read (processingSnapshotSql, sweep/ingestion's 'missing' branch) both
    // go through this same mocked $queryRawUnsafe. Ownership validation
    // under a real row lock happens inside the hydration services' own
    // transactions, which are mocked entirely in this file — see
    // clock-webhook-recovery.e2e.spec.ts for the real, unmocked version.
    $queryRawUnsafe: vi.fn(async (sql: string) => {
      if (sql.includes('"processingToken"')) return snapshotRow ? [snapshotRow] : [];
      return providerEventsRow ? [providerEventsRow] : [];
    }),
    $executeRawUnsafe: vi.fn().mockResolvedValue(options.executeRowCount ?? 1),
  };
  const platformAdminTransaction = {
    $queryRawUnsafe: vi.fn().mockResolvedValue(options.stuckRows ?? []),
  };
  const database = {
    withTenantTransaction: vi.fn((_context, callback) => callback(transaction)),
    withPlatformAdminTransaction: vi.fn((_context, callback) => callback(platformAdminTransaction)),
  };
  const hydration = {
    hydrateBooking: vi.fn().mockResolvedValue({ outcome: 'created', bookingId: 'b1' }),
  };
  const folioHydration = {
    hydrateFolio: vi.fn().mockResolvedValue({ outcome: 'applied', bookingId: 'b1' }),
  };
  const queues = {
    enqueue: vi.fn().mockResolvedValue(undefined),
    reconcileJob: options.reconcileJob
      ? vi.fn(options.reconcileJob)
      : vi.fn().mockResolvedValue('missing'),
  };
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
  const manualReview = {
    record: vi.fn().mockResolvedValue(undefined),
    recordInTransaction: vi.fn().mockResolvedValue(undefined),
  };
  const worker = new ClockWorkerService(
    queues as never,
    database as never,
    hydration as never,
    folioHydration as never,
    connections as never,
    consistency as never,
    paymentReconciliation as never,
    manualReview as never,
  );
  return {
    worker,
    database,
    transaction,
    platformAdminTransaction,
    hydration,
    folioHydration,
    queues,
    connections,
    consistency,
    paymentReconciliation,
    manualReview,
  };
}

const jobData = {
  tenantId: 'tenant-1',
  propertyId: 'property-1',
  connectionId: 'connection-1',
  eventId: 'event-1',
};

/** Pulls the [tenantId, eventRowId, status, allowedFrom, ...rest] positional
 * arguments off an $executeRawUnsafe call for readable assertions. */
function writeArgs(call: unknown[]) {
  return { tenantId: call[1], eventRowId: call[2], status: call[3], rest: call.slice(4) };
}

describe('ClockWorkerService dispatch — clock.webhooks/hydrate-event', () => {
  it.each(['booking_new', 'booking_guests_update', 'booking_update', 'booking_canceled'])(
    'calls hydrateBooking for a real %s event',
    async (eventType) => {
      const { worker, hydration } = makeWorker({
        id: 'row-1',
        status: 'QUEUED',
        eventType,
        objectId: '12345',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (worker as any).process('clock.webhooks', fakeJob('j1', 'hydrate-event', jobData));
      expect(hydration.hydrateBooking).toHaveBeenCalledWith(
        jobData.tenantId,
        jobData.propertyId,
        jobData.connectionId,
        '12345',
        { eventRowId: 'row-1', token: 'token-A' },
      );
    },
  );

  it.each(['folio_update', 'folio_close'])(
    'calls hydrateFolio for a real %s event (Task C, docs/CLOCK_CERTIFICATION_GAPS_PLAN.md)',
    async (eventType) => {
      const { worker, hydration, folioHydration } = makeWorker({
        id: 'row-2',
        status: 'QUEUED',
        eventType,
        objectId: '76076600',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (worker as any).process('clock.webhooks', fakeJob('j2', 'hydrate-event', jobData));
      expect(folioHydration.hydrateFolio).toHaveBeenCalledWith(
        jobData.tenantId,
        jobData.propertyId,
        '76076600',
        { eventRowId: 'row-2', token: 'token-A' },
      );
      expect(hydration.hydrateBooking).not.toHaveBeenCalled();
    },
  );

  it('does not call hydrateBooking or hydrateFolio for an event type not yet applied', async () => {
    const { worker, hydration, folioHydration } = makeWorker({
      id: 'row-3',
      status: 'QUEUED',
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
    const { worker } = makeWorker({
      id: 'row-x',
      status: 'QUEUED',
      eventType: 'booking_new',
      objectId: '1',
    });
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (worker as any).process('clock.webhooks', fakeJob('j4', 'hydrate-event', { bogus: true })),
    ).rejects.toThrow(/malformed data/);
  });

  it('throws when the job carries no BullMQ processing token', async () => {
    const { worker } = makeWorker({
      id: 'row-x2',
      status: 'QUEUED',
      eventType: 'booking_new',
      objectId: '1',
    });
    const jobWithoutToken = { id: 'j4b', name: 'hydrate-event', data: jobData } as never;
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (worker as any).process('clock.webhooks', jobWithoutToken),
    ).rejects.toThrow(/no BullMQ processing token/);
  });

  it('leaves every other queue/job name on the existing skeleton no-op path', async () => {
    const { worker, hydration } = makeWorker({
      id: 'row-y',
      status: 'QUEUED',
      eventType: 'booking_new',
      objectId: '1',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (worker as any).process(
      'clock.catalog.sync',
      fakeJob('j5', 'full-sync', { anything: true }),
    );
    expect(hydration.hydrateBooking).not.toHaveBeenCalled();
  });

  it('never reprocesses a row already HYDRATED (duplicate/replayed job)', async () => {
    const { worker, hydration, transaction } = makeWorker({
      id: 'row-terminal',
      status: 'HYDRATED',
      eventType: 'booking_new',
      objectId: '12345',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (worker as any).process('clock.webhooks', fakeJob('j-dup', 'hydrate-event', jobData));
    expect(hydration.hydrateBooking).not.toHaveBeenCalled();
    expect(transaction.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('never reprocesses a row already IGNORED (duplicate/replayed job)', async () => {
    const { worker, folioHydration, transaction } = makeWorker({
      id: 'row-terminal-2',
      status: 'IGNORED',
      eventType: 'folio_update',
      objectId: '5',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (worker as any).process('clock.webhooks', fakeJob('j-dup2', 'hydrate-event', jobData));
    expect(folioHydration.hydrateFolio).not.toHaveBeenCalled();
    expect(transaction.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('never reprocesses a row already FAILED', async () => {
    const { worker, hydration, transaction } = makeWorker({
      id: 'row-terminal-3',
      status: 'FAILED',
      eventType: 'booking_new',
      objectId: '12345',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (worker as any).process('clock.webhooks', fakeJob('j-dup3', 'hydrate-event', jobData));
    expect(hydration.hydrateBooking).not.toHaveBeenCalled();
    expect(transaction.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('never reprocesses a row parked NEEDS_RECONCILIATION', async () => {
    const { worker, hydration, transaction } = makeWorker({
      id: 'row-terminal-4',
      status: 'NEEDS_RECONCILIATION',
      eventType: 'booking_new',
      objectId: '12345',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (worker as any).process('clock.webhooks', fakeJob('j-dup4', 'hydrate-event', jobData));
    expect(hydration.hydrateBooking).not.toHaveBeenCalled();
    expect(transaction.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('stops without doing hydration work when the QUEUED claim loses a concurrency race', async () => {
    const { worker, hydration } = makeWorker(
      { id: 'row-race', status: 'QUEUED', eventType: 'booking_new', objectId: '1' },
      { executeRowCount: 0 }, // guarded UPDATE affected 0 rows: another actor already moved it
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (worker as any).process('clock.webhooks', fakeJob('j-race', 'hydrate-event', jobData));
    expect(hydration.hydrateBooking).not.toHaveBeenCalled();
  });

  it('does nothing further (no throw, no extra write) when hydrateBooking reports it lost ownership before its transaction committed', async () => {
    // ADR-0031 (third correction): ownership is now fenced for real inside
    // hydrateBooking's own effect-applying transaction (a row lock held for
    // its lifetime), not a preceding check at this layer — this test proves
    // the worker correctly treats that outcome as "nothing to do", not an
    // error.
    const { worker, hydration, transaction } = makeWorker({
      id: 'row-lost-ownership',
      status: 'QUEUED',
      eventType: 'booking_new',
      objectId: '1',
    });
    hydration.hydrateBooking.mockResolvedValue({ outcome: 'ownership_lost' });

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (worker as any).process('clock.webhooks', fakeJob('j-lost', 'hydrate-event', jobData)),
    ).resolves.toBeUndefined();
    expect(hydration.hydrateBooking).toHaveBeenCalledOnce();
    // Only the claim write — no worker-level finalize for this outcome.
    expect(transaction.$executeRawUnsafe).toHaveBeenCalledOnce();
  });
});

describe('ClockWorkerService — provider_events durable status (ownership + explicit allowed-from)', () => {
  it('claims with this attempt token and its BullMQ attemptsStarted as a claim-ordering generation, allowedFrom RECEIVED/QUEUED', async () => {
    const { worker, hydration, transaction } = makeWorker({
      id: 'row-9',
      status: 'RECEIVED',
      eventType: 'booking_new',
      objectId: '5',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (worker as any).process(
      'clock.webhooks',
      fakeJob('j6', 'hydrate-event', jobData, 'token-A', 3),
    );

    // claimEventSql (not guardedTransitionSql) — status is hardcoded 'QUEUED'
    // in the SQL text, not a bound parameter, so params are
    // [tenantId, eventRowId, token, generation, allowedFrom].
    const calls = transaction.$executeRawUnsafe.mock.calls as unknown[][];
    expect(calls[0]![0]).toContain('attempts = attempts + 1');
    expect(calls[0]![0]).toContain('processing_token = $3, processing_attempt = $4');
    expect(calls[0]![0]).toContain(
      'processing_attempt IS NULL\n         OR processing_attempt < $4\n         OR (processing_attempt = $4 AND processing_token = $3)',
    );
    expect(calls[0]!.slice(1)).toEqual(['tenant-1', 'row-9', 'token-A', 3, ['RECEIVED', 'QUEUED']]);

    // Effect application and the terminal HYDRATED write both now happen
    // inside hydrateBooking's own transaction (fenced by a real row lock —
    // see test/clock-webhook-recovery.e2e.spec.ts for the unmocked proof);
    // the worker issues no further write itself for this outcome.
    expect(hydration.hydrateBooking).toHaveBeenCalledWith(
      'tenant-1',
      'property-1',
      'connection-1',
      '5',
      { eventRowId: 'row-9', token: 'token-A' },
    );
    expect(transaction.$executeRawUnsafe).toHaveBeenCalledOnce();
  });

  it('marks the row IGNORED for an event type that is acknowledged but not applied', async () => {
    const { worker, transaction } = makeWorker({
      id: 'row-10',
      status: 'RECEIVED',
      eventType: 'booking_task_update',
      objectId: '31482380',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (worker as any).process('clock.webhooks', fakeJob('j7', 'hydrate-event', jobData));

    const lastCall = transaction.$executeRawUnsafe.mock.calls.at(-1) as unknown[];
    expect(writeArgs(lastCall).status).toBe('IGNORED');
  });

  it('treats missing_room_type_mapping as fully handled by hydrateBooking (its own FAILED write + ManualReviewItem, already committed) — no further worker-level write', async () => {
    const { worker, hydration, transaction } = makeWorker({
      id: 'row-11',
      status: 'RECEIVED',
      eventType: 'booking_new',
      objectId: '999',
    });
    hydration.hydrateBooking.mockResolvedValue({ outcome: 'missing_room_type_mapping' });

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (worker as any).process('clock.webhooks', fakeJob('j8', 'hydrate-event', jobData)),
    ).resolves.toBeUndefined();
    expect(transaction.$executeRawUnsafe).toHaveBeenCalledOnce(); // only the claim
  });

  it('throws (lets BullMQ retry) a booking event on no_active_connection instead of certifying it done', async () => {
    const { worker, hydration } = makeWorker({
      id: 'row-12',
      status: 'RECEIVED',
      eventType: 'booking_new',
      objectId: '999',
    });
    hydration.hydrateBooking.mockResolvedValue({ outcome: 'no_active_connection' });

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (worker as any).process('clock.webhooks', fakeJob('j9', 'hydrate-event', jobData)),
    ).rejects.toThrow(/no active Clock connection/);
  });

  it('treats not_a_booking_folio as fully handled by hydrateFolio (its own IGNORED write, already committed) — no further worker-level write', async () => {
    const { worker, folioHydration, transaction } = makeWorker({
      id: 'row-13',
      status: 'RECEIVED',
      eventType: 'folio_update',
      objectId: '555',
    });
    folioHydration.hydrateFolio.mockResolvedValue({ outcome: 'not_a_booking_folio' });

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (worker as any).process('clock.webhooks', fakeJob('j10', 'hydrate-event', jobData)),
    ).resolves.toBeUndefined();
    expect(transaction.$executeRawUnsafe).toHaveBeenCalledOnce(); // only the claim
  });

  it('throws (lets BullMQ retry) a folio event on booking_not_found — the folio-before-booking race', async () => {
    const { worker, folioHydration } = makeWorker({
      id: 'row-14',
      status: 'RECEIVED',
      eventType: 'folio_update',
      objectId: '555',
    });
    folioHydration.hydrateFolio.mockResolvedValue({ outcome: 'booking_not_found' });

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (worker as any).process('clock.webhooks', fakeJob('j11', 'hydrate-event', jobData)),
    ).rejects.toThrow(/folio-before-booking race/);
  });

  it('finalizeEvent (still used for the no-object-id/unsupported-type IGNORED paths) logs and discards the outcome when ownership was lost before finalizing', async () => {
    // Exercises the worker's own finalizeEvent — still used for the two
    // paths that never call a hydration service at all (no object id, or
    // an unsupported event type) — rather than the ownership fencing now
    // inside hydrateBooking/hydrateFolio's transactions (covered above and
    // in the real e2e suite).
    const { worker, transaction } = makeWorker(
      { id: 'row-15', status: 'QUEUED', eventType: 'booking_task_update', objectId: '31482380' },
      { executeRowCount: 1 }, // claim succeeds...
    );
    // ...but the finalize write (2nd $executeRawUnsafe call) reports 0 rows
    // affected, simulating a newer attempt having taken over in between.
    transaction.$executeRawUnsafe.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (worker as any).process(
        'clock.webhooks',
        fakeJob('j-stale-finalize', 'hydrate-event', jobData),
      ),
    ).resolves.toBeUndefined();
  });

  it('markHydrateEventFailed requires status QUEUED and the failed attempt’s own token — never downgrades a newer attempt', async () => {
    const { worker, transaction } = makeWorker({ id: 'row-15b', status: 'QUEUED' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (worker as any).markHydrateEventFailed(jobData, 'token-stale');

    const lastCall = transaction.$executeRawUnsafe.mock.calls.at(-1) as unknown[];
    const args = writeArgs(lastCall);
    expect(args.status).toBe('FAILED');
    expect(args.rest).toEqual([['QUEUED'], 'token-stale']);
    expect(lastCall[0]).toContain('processing_token = NULL');
  });

  it('markHydrateEventFailed does nothing (no crash, no write) when the job carried no token', async () => {
    const { worker, transaction } = makeWorker({ id: 'row-15c', status: 'QUEUED' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (worker as any).markHydrateEventFailed(jobData, undefined);
    expect(transaction.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('markHydrateEventFailed does nothing (no crash) when the provider_events row is missing', async () => {
    const { worker, transaction } = makeWorker(undefined);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (worker as any).markHydrateEventFailed(jobData, 'token-A'),
    ).resolves.toBeUndefined();
    expect(transaction.$executeRawUnsafe).not.toHaveBeenCalled();
  });
});

describe('ClockWorkerService — provider_events recovery sweep (BullMQ job-state reconciliation)', () => {
  const stuckRow = {
    id: 'row-20',
    tenantId: 'tenant-1',
    propertyId: 'property-1',
    connectionId: 'connection-1',
    eventId: 'event-stuck-1',
  };

  it('creates a fresh job and marks QUEUED (allowedFrom RECEIVED/QUEUED, no token) when reconcileJob reports the job is missing', async () => {
    const { worker, queues, transaction } = makeWorker(undefined, {
      stuckRows: [stuckRow],
      reconcileJob: async () => 'missing',
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (worker as any).process('clock.webhooks', fakeJob('sweep-1', 'sweep-stuck-events', {}));

    expect(queues.reconcileJob).toHaveBeenCalledWith(
      'clock.webhooks',
      'clock-hydrate:connection-1:event-stuck-1',
    );
    expect(queues.enqueue).toHaveBeenCalledWith(
      'clock.webhooks',
      'hydrate-event',
      {
        tenantId: 'tenant-1',
        propertyId: 'property-1',
        connectionId: 'connection-1',
        eventId: 'event-stuck-1',
      },
      { jobId: 'clock-hydrate:connection-1:event-stuck-1' },
    );
    // The reset is a compare-and-swap against the pre-recreation snapshot
    // (ADR-0031, fifth corrective round), not an unconditional write —
    // guarded by allowedFrom plus the snapshotted token/generation, so a
    // claim landing concurrently (the newly created job's own worker) can
    // never be silently erased.
    const lastCall = transaction.$executeRawUnsafe.mock.calls.at(-1) as unknown[];
    expect(lastCall[0]).toContain("SET status = 'QUEUED'");
    expect(lastCall[0]).toContain('processing_token IS NOT DISTINCT FROM');
    expect(lastCall[0]).toContain('processing_attempt IS NOT DISTINCT FROM');
    expect(lastCall.slice(1, 3)).toEqual(['tenant-1', 'row-20']);
    expect(lastCall[3]).toEqual(['RECEIVED', 'QUEUED']);
    expect(lastCall[4]).toBeNull(); // snapshotted processing_token — unclaimed
    expect(lastCall[5]).toBeNull(); // snapshotted processing_attempt
  });

  it('does not re-enqueue and marks FAILED (allowedFrom RECEIVED/QUEUED) when reconcileJob reports the job already failed (exhausted attempts)', async () => {
    const { worker, queues, transaction } = makeWorker(undefined, {
      stuckRows: [stuckRow],
      reconcileJob: async () => 'failed',
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (worker as any).process('clock.webhooks', fakeJob('sweep-2', 'sweep-stuck-events', {}));

    expect(queues.enqueue).not.toHaveBeenCalled();
    const lastCall = transaction.$executeRawUnsafe.mock.calls.at(-1) as unknown[];
    const args = writeArgs(lastCall);
    expect(args.status).toBe('FAILED');
    expect(args.rest).toEqual([['RECEIVED', 'QUEUED']]);
  });

  it('does not re-enqueue or change status, but does touch updated_at, when the job is still in flight', async () => {
    const { worker, queues, transaction } = makeWorker(undefined, {
      stuckRows: [stuckRow],
      reconcileJob: async () => 'in-flight',
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (worker as any).process('clock.webhooks', fakeJob('sweep-3', 'sweep-stuck-events', {}));

    expect(queues.enqueue).not.toHaveBeenCalled();
    expect(transaction.$executeRawUnsafe).toHaveBeenCalledOnce();
    const call = transaction.$executeRawUnsafe.mock.calls[0] as unknown[];
    expect(call[0]).not.toContain('SET status');
    expect(call[0]).toContain('updated_at = CURRENT_TIMESTAMP');
  });

  it('parks NEEDS_RECONCILIATION and records a ManualReviewItem when the job already completed', async () => {
    const { worker, queues, transaction, manualReview } = makeWorker(undefined, {
      stuckRows: [stuckRow],
      reconcileJob: async () => 'completed',
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (worker as any).process('clock.webhooks', fakeJob('sweep-4', 'sweep-stuck-events', {}));

    expect(queues.enqueue).not.toHaveBeenCalled();
    const lastCall = transaction.$executeRawUnsafe.mock.calls.at(-1) as unknown[];
    const args = writeArgs(lastCall);
    expect(args.status).toBe('NEEDS_RECONCILIATION');
    expect(args.rest).toEqual([['RECEIVED', 'QUEUED']]);
    expect(manualReview.recordInTransaction).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        tenantId: 'tenant-1',
        propertyId: 'property-1',
        connectionId: 'connection-1',
        category: 'UNKNOWN_RESULT',
        referenceType: 'provider_event',
        referenceId: 'event-stuck-1',
      }),
    );
  });

  it('does not record a ManualReviewItem when the NEEDS_RECONCILIATION write itself loses the race', async () => {
    const { worker, manualReview } = makeWorker(undefined, {
      stuckRows: [stuckRow],
      reconcileJob: async () => 'completed',
      executeRowCount: 0,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (worker as any).process('clock.webhooks', fakeJob('sweep-4b', 'sweep-stuck-events', {}));
    expect(manualReview.recordInTransaction).not.toHaveBeenCalled();
  });

  it('fairness: touching examined rows rotates the oldest-N window so a later sweep reaches rows beyond the batch limit', async () => {
    const firstBatch = Array.from({ length: 200 }, (_, index) => ({
      id: `row-old-${index}`,
      tenantId: 'tenant-1',
      propertyId: 'property-1',
      connectionId: 'connection-1',
      eventId: `event-old-${index}`,
    }));
    const { worker, transaction } = makeWorker(undefined, {
      stuckRows: firstBatch,
      reconcileJob: async () => 'in-flight',
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (worker as any).process('clock.webhooks', fakeJob('sweep-5', 'sweep-stuck-events', {}));

    expect(transaction.$executeRawUnsafe).toHaveBeenCalledTimes(200);
    for (const call of transaction.$executeRawUnsafe.mock.calls) {
      expect((call as unknown[])[0]).toContain('updated_at = CURRENT_TIMESTAMP');
      expect((call as unknown[])[0]).not.toContain('SET status');
    }
  });

  it('does nothing when no rows are stuck', async () => {
    const { worker, queues } = makeWorker(undefined, { stuckRows: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (worker as any).process('clock.webhooks', fakeJob('sweep-6', 'sweep-stuck-events', {}));
    expect(queues.enqueue).not.toHaveBeenCalled();
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
