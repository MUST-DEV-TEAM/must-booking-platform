import { describe, expect, it, vi } from 'vitest';

import { ClockWebhookService } from './clock-webhook.service';
import type { SnsEnvelope } from './clock-webhook-signature';

const CONNECTION = {
  tenantId: 'tenant-1',
  connectionId: 'connection-1',
  provider: 'CLOCK_PMS',
  encryptedCredentials: 'encrypted',
};

function envelope(overrides: Partial<SnsEnvelope> = {}): SnsEnvelope {
  return {
    Type: 'Notification',
    MessageId: 'event-1',
    TopicArn: 'arn:aws:sns:eu-west-1:123456789012:clock-topic',
    Subject: 'booking_new',
    Message: JSON.stringify({ booking_id: 12345 }),
    Timestamp: new Date().toISOString(),
    SignatureVersion: '1',
    Signature: 'sig',
    SigningCertURL: 'https://sns.eu-west-1.amazonaws.com/cert.pem',
    ...overrides,
  };
}

/**
 * `insertedRow` simulates a fresh INSERT ... RETURNING id (the first
 * delivery of this event). `existingRow` simulates the ON CONFLICT
 * read-back a duplicate delivery falls through to. Only one of the two
 * queries actually runs per storeEvent() call, driven by whichever mock
 * returns data first in the transaction's own two-query sequence.
 * `reconcileJob` simulates ClockQueueService's real-BullMQ-state lookup —
 * defaults to 'missing' (no job exists yet), matching a fresh event.
 */
function makeService(options: {
  insertedRow?: { id: string } | undefined;
  existingRow?: { id: string; status: string } | undefined;
  enqueueError?: Error;
  reconcileJob?: string;
  reconcileJobError?: Error;
  /** Overrides every $executeRawUnsafe call's affected-row count (default
   * 1). Used to simulate a guarded write losing a race (0 rows). */
  executeRowCount?: number;
  /** processingSnapshotSql's result for the job-recreation CAS read
   * (ADR-0031, fifth corrective round). Defaults to a snapshot consistent
   * with insertedRow/existingRow's status and an unclaimed (null) token —
   * override to simulate ownership having already changed by the time the
   * snapshot is read (`undefined` simulates the row having vanished). */
  snapshotRow?: {
    status: string;
    processingToken: string | null;
    processingAttempt: number | null;
  };
}) {
  const insertedRow = options.insertedRow;
  const existingRow = options.existingRow;
  const snapshotRow =
    'snapshotRow' in options
      ? options.snapshotRow
      : {
          status: insertedRow ? 'RECEIVED' : (existingRow?.status ?? 'RECEIVED'),
          processingToken: null,
          processingAttempt: null,
        };

  const tenantTx = {
    $executeRawUnsafe: vi.fn().mockResolvedValue(options.executeRowCount ?? 1),
    // Routed by SQL shape rather than call order — the job-recreation CAS
    // read (processingSnapshotSql) runs in its own withTenantTransaction
    // call, interleaved with storeEvent's insert/conflict-read depending on
    // which branch a given test takes, so a fixed once-per-call sequence
    // can't represent every path a single test exercises.
    $queryRawUnsafe: vi.fn(async (sql: string) => {
      if (sql.includes('INSERT INTO provider_events')) return insertedRow ? [insertedRow] : [];
      if (sql.includes('"processingToken"')) return snapshotRow ? [snapshotRow] : [];
      return existingRow ? [existingRow] : [];
    }),
  };
  const webhookGatewayTx = {
    $queryRaw: vi.fn().mockResolvedValue([CONNECTION]),
  };

  const database = {
    withTenantTransaction: vi.fn((_context, callback) => callback(tenantTx)),
    withWebhookGatewayLookup: vi.fn((callback) => callback(webhookGatewayTx)),
  };
  const cipher = {
    decrypt: vi
      .fn()
      .mockReturnValue({ snsTopicArn: CONNECTION.tenantId ? envelope().TopicArn : '' }),
  };
  const verification = {
    verify: vi.fn().mockResolvedValue({ ok: true }),
    confirmSubscription: vi.fn().mockResolvedValue(undefined),
  };
  const queues = {
    enqueue: options.enqueueError
      ? vi.fn().mockRejectedValue(options.enqueueError)
      : vi.fn().mockResolvedValue(undefined),
    reconcileJob: options.reconcileJobError
      ? vi.fn().mockRejectedValue(options.reconcileJobError)
      : vi.fn().mockResolvedValue(options.reconcileJob ?? 'missing'),
  };
  const manualReview = {
    record: vi.fn().mockResolvedValue(undefined),
    recordInTransaction: vi.fn().mockResolvedValue(undefined),
  };

  const service = new ClockWebhookService(
    database as never,
    cipher as never,
    verification as never,
    queues as never,
    manualReview as never,
  );

  // property_integration_connections lookup (second withWebhookGatewayLookup call).
  webhookGatewayTx.$queryRaw
    // First call: findConnection.
    .mockResolvedValueOnce([CONNECTION])
    // Second call: propertyForConnection.
    .mockResolvedValueOnce([{ propertyId: 'property-1' }]);

  return { service, database, cipher, verification, queues, manualReview, tenantTx };
}

/** markConnectionSeen() always issues one $executeRawUnsafe against
 * integration_connections regardless of outcome — filter it out so
 * assertions about provider_events writes aren't polluted by it. */
function providerEventWrites(tenantTx: { $executeRawUnsafe: { mock: { calls: unknown[][] } } }) {
  return tenantTx.$executeRawUnsafe.mock.calls.filter((call) =>
    String(call[0]).includes('provider_events'),
  );
}

describe('ClockWebhookService — durable event storage and BullMQ-state-aware enqueue', () => {
  it('enqueues a brand-new event with a deterministic jobId and marks it QUEUED', async () => {
    const { service, queues, tenantTx } = makeService({
      insertedRow: { id: 'row-1' },
      reconcileJob: 'missing',
    });

    const result = await service.handle('webhook-1', envelope(), 100);

    expect(result).toEqual({ status: 200 });
    expect(queues.reconcileJob).toHaveBeenCalledWith(
      'clock.webhooks',
      'clock-hydrate:connection-1:event-1',
    );
    expect(queues.enqueue).toHaveBeenCalledWith(
      'clock.webhooks',
      'hydrate-event',
      {
        tenantId: 'tenant-1',
        propertyId: 'property-1',
        connectionId: 'connection-1',
        eventId: 'event-1',
      },
      { jobId: 'clock-hydrate:connection-1:event-1' },
    );
    // The reset is a compare-and-swap against the pre-recreation snapshot
    // (ADR-0031, fifth corrective round) — not an unconditional write —
    // guarded by both allowedFrom and the snapshotted token/generation, so
    // a claim that lands concurrently can never be silently erased.
    const queuedCall = tenantTx.$executeRawUnsafe.mock.calls.at(-1) as unknown[];
    expect(queuedCall[0]).toContain("SET status = 'QUEUED'");
    expect(queuedCall[0]).toContain('processing_token IS NOT DISTINCT FROM');
    expect(queuedCall[0]).toContain('processing_attempt IS NOT DISTINCT FROM');
    expect(queuedCall.slice(1, 3)).toEqual(['tenant-1', 'row-1']);
    expect(queuedCall[3]).toEqual(['RECEIVED', 'QUEUED']);
    expect(queuedCall[4]).toBeNull(); // snapshotted processing_token — unclaimed
    expect(queuedCall[5]).toBeNull(); // snapshotted processing_attempt
  });

  it('re-enqueues a duplicate delivery whose earlier row is RECEIVED when no live job exists', async () => {
    const { service, queues } = makeService({
      insertedRow: undefined,
      existingRow: { id: 'row-2', status: 'RECEIVED' },
      reconcileJob: 'missing',
    });

    await service.handle('webhook-1', envelope(), 100);

    expect(queues.enqueue).toHaveBeenCalledWith(
      'clock.webhooks',
      'hydrate-event',
      expect.objectContaining({ eventId: 'event-1' }),
      { jobId: 'clock-hydrate:connection-1:event-1' },
    );
  });

  it('does not re-enqueue when the job is already in flight (waiting/active/delayed) — avoids duplicating work', async () => {
    const { service, queues, tenantTx } = makeService({
      insertedRow: undefined,
      existingRow: { id: 'row-2b', status: 'QUEUED' },
      reconcileJob: 'in-flight',
    });

    const result = await service.handle('webhook-1', envelope(), 100);

    expect(result).toEqual({ status: 200 });
    expect(queues.enqueue).not.toHaveBeenCalled();
    // No status write either — the row is already correctly QUEUED and an
    // in-flight job will settle its own status.
    expect(providerEventWrites(tenantTx)).toHaveLength(0);
  });

  it('marks the row FAILED (does not re-enqueue) when reconcileJob reports the job already exhausted its attempts', async () => {
    const { service, queues, tenantTx } = makeService({
      insertedRow: undefined,
      existingRow: { id: 'row-2c', status: 'QUEUED' },
      reconcileJob: 'failed',
    });

    await service.handle('webhook-1', envelope(), 100);

    expect(queues.enqueue).not.toHaveBeenCalled();
    const lastCall = tenantTx.$executeRawUnsafe.mock.calls.at(-1) as unknown[];
    expect(lastCall[3]).toBe('FAILED');
  });

  it('parks NEEDS_RECONCILIATION and records a ManualReviewItem when reconcileJob reports the job already completed', async () => {
    const { service, queues, manualReview, tenantTx } = makeService({
      insertedRow: undefined,
      existingRow: { id: 'row-2d', status: 'QUEUED' },
      reconcileJob: 'completed',
    });

    const result = await service.handle('webhook-1', envelope(), 100);

    expect(result).toEqual({ status: 200 });
    expect(queues.enqueue).not.toHaveBeenCalled();
    const writes = providerEventWrites(tenantTx);
    expect(writes).toHaveLength(1);
    expect(writes[0]![3]).toBe('NEEDS_RECONCILIATION');
    expect(writes[0]![4] as string[]).toEqual(['RECEIVED', 'QUEUED']); // never allowed from FAILED
    expect(manualReview.recordInTransaction).toHaveBeenCalledWith(
      tenantTx,
      expect.objectContaining({
        tenantId: 'tenant-1',
        propertyId: 'property-1',
        category: 'UNKNOWN_RESULT',
        referenceType: 'provider_event',
        referenceId: 'event-1',
      }),
    );
  });

  it('atomic parking: does not record a ManualReviewItem when the NEEDS_RECONCILIATION write itself loses the race', async () => {
    // Simulates another actor having already moved the row past the guard
    // between reconcileJob reporting 'completed' and this write landing —
    // the guarded UPDATE affects 0 rows, so no item must ever be created,
    // proving "only the actor that successfully parks the row creates it."
    const { service, manualReview } = makeService({
      insertedRow: undefined,
      existingRow: { id: 'row-2f', status: 'QUEUED' },
      reconcileJob: 'completed',
      executeRowCount: 0,
    });

    await service.handle('webhook-1', envelope(), 100);

    expect(manualReview.recordInTransaction).not.toHaveBeenCalled();
  });

  it('a duplicate delivery whose row is already NEEDS_RECONCILIATION is not auto-retried', async () => {
    const { service, queues, manualReview } = makeService({
      insertedRow: undefined,
      existingRow: { id: 'row-2e', status: 'NEEDS_RECONCILIATION' },
    });

    const result = await service.handle('webhook-1', envelope(), 100);

    expect(result).toEqual({ status: 200 });
    expect(queues.reconcileJob).not.toHaveBeenCalled();
    expect(queues.enqueue).not.toHaveBeenCalled();
    expect(manualReview.record).not.toHaveBeenCalled();
    expect(manualReview.recordInTransaction).not.toHaveBeenCalled();
  });

  it('every automatic QUEUED/FAILED write from ingestion explicitly excludes FAILED from allowedFrom (never resurrects it)', async () => {
    // Unit-level proof of the SQL parameters passed for both branches that
    // can fire from ingestion; the real enforcement (a stale write actually
    // rejected by Postgres) is proven against a real database in
    // test/clock-webhook-recovery.e2e.spec.ts.
    const missingCase = makeService({
      insertedRow: undefined,
      existingRow: { id: 'row-8', status: 'QUEUED' },
      reconcileJob: 'missing',
    });
    await missingCase.service.handle('webhook-1', envelope(), 100);
    const missingWrite = providerEventWrites(missingCase.tenantTx).at(-1)!;
    expect(String(missingWrite[0])).toContain("SET status = 'QUEUED'");
    expect(missingWrite[3] as string[]).toEqual(['RECEIVED', 'QUEUED']);

    const failedCase = makeService({
      insertedRow: undefined,
      existingRow: { id: 'row-9', status: 'QUEUED' },
      reconcileJob: 'failed',
    });
    await failedCase.service.handle('webhook-1', envelope(), 100);
    const failedWrite = providerEventWrites(failedCase.tenantTx).at(-1)!;
    expect(failedWrite[3]).toBe('FAILED');
    expect(failedWrite[4] as string[]).toEqual(['RECEIVED', 'QUEUED']);
  });

  it('does not auto-retry a duplicate delivery whose earlier row already FAILED — operator-controlled policy', async () => {
    // A flood of duplicate SNS deliveries must not silently convert a
    // deliberate "3 attempts then stop" exhaustion into unlimited retries
    // through the ingestion side channel. Reconciliation against a live
    // BullMQ job is only even attempted for RECEIVED/QUEUED rows.
    const { service, queues, tenantTx } = makeService({
      insertedRow: undefined,
      existingRow: { id: 'row-3', status: 'FAILED' },
    });

    const result = await service.handle('webhook-1', envelope(), 100);

    expect(result).toEqual({ status: 200 });
    expect(queues.reconcileJob).not.toHaveBeenCalled();
    expect(queues.enqueue).not.toHaveBeenCalled();
    expect(providerEventWrites(tenantTx)).toHaveLength(0);
  });

  it('does not re-enqueue a duplicate delivery whose earlier row already HYDRATED', async () => {
    const { service, queues } = makeService({
      insertedRow: undefined,
      existingRow: { id: 'row-4', status: 'HYDRATED' },
    });

    const result = await service.handle('webhook-1', envelope(), 100);

    expect(result).toEqual({ status: 200 });
    expect(queues.enqueue).not.toHaveBeenCalled();
    expect(queues.reconcileJob).not.toHaveBeenCalled();
  });

  it('does not re-enqueue a duplicate delivery whose earlier row was IGNORED', async () => {
    const { service, queues } = makeService({
      insertedRow: undefined,
      existingRow: { id: 'row-5', status: 'IGNORED' },
    });

    await service.handle('webhook-1', envelope(), 100);

    expect(queues.enqueue).not.toHaveBeenCalled();
    expect(queues.reconcileJob).not.toHaveBeenCalled();
  });

  it('still returns 200 and does not mark the row QUEUED when the enqueue call itself fails', async () => {
    const { service, queues, tenantTx } = makeService({
      insertedRow: { id: 'row-6' },
      reconcileJob: 'missing',
      enqueueError: new Error('Redis unavailable'),
    });

    const result = await service.handle('webhook-1', envelope(), 100);

    expect(result).toEqual({ status: 200 });
    expect(queues.enqueue).toHaveBeenCalledOnce();
    const statusUpdateCalls = tenantTx.$executeRawUnsafe.mock.calls.filter((call: unknown[]) =>
      String(call[0]).includes('provider_events'),
    );
    expect(statusUpdateCalls).toHaveLength(0);
  });

  it('still returns 200 and does not enqueue when reconcileJob itself fails (Redis unavailable)', async () => {
    const { service, queues, tenantTx } = makeService({
      insertedRow: { id: 'row-7' },
      reconcileJobError: new Error('Redis unavailable'),
    });

    const result = await service.handle('webhook-1', envelope(), 100);

    expect(result).toEqual({ status: 200 });
    expect(queues.enqueue).not.toHaveBeenCalled();
    expect(providerEventWrites(tenantTx)).toHaveLength(0);
  });
});
