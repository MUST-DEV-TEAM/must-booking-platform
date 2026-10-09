import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { ClockBookingHydrationService } from '../src/integrations/clock/clock-booking-hydration.service';
import { ClockHttpClient } from '../src/integrations/clock/clock-http-client';
import { ClockQueueService } from '../src/integrations/clock/clock-queue.service';
import { clockHydrateEventJobId } from '../src/integrations/clock/clock-queue-names';
import { claimEventSql } from '../src/integrations/clock/clock-provider-event-status';
import { ClockWebhookService } from '../src/integrations/clock/clock-webhook.service';
import { ManualReviewService } from '../src/integrations/manual-review.service';
import { ClockWorkerService } from '../src/integrations/clock/clock-worker.service';
import { ClockBookingConsistencyService } from '../src/integrations/clock/clock-booking-consistency.service';
import { ClockFolioHydrationService } from '../src/integrations/clock/clock-folio-hydration.service';
import { ClockPaymentReconciliationService } from '../src/integrations/clock/clock-payment-reconciliation.service';
import { IntegrationConnectionsService } from '../src/integrations/integration-connections.service';
import { TenantDatabaseService } from '../src/tenancy/tenant-database.service';
import { cleanupTenant } from './helpers/cleanup-tenant';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';

/**
 * Real Milestone 21 Task 22 corrective-review evidence: a genuine local
 * Postgres (with RLS applied via the real `must_booking_app` runtime role,
 * not a superuser bypass) and a genuine local Redis/BullMQ, driven through
 * the actual application services — not mocked transaction callbacks. Only
 * ClockHttpClient is stubbed (same established pattern as
 * clock-booking-hydration.e2e.spec.ts), so the outbound call to Clock itself
 * is the sole simulated boundary; persistence, RLS, queueing, worker
 * dispatch and the recovery sweep all run for real.
 */

function realBookingDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 38144004,
    number: '364',
    arrival: '2026-09-23',
    departure: '2026-09-24',
    status: 'expected',
    adults: 1,
    children: 1,
    arrival_room_type_id: 42023,
    arrival_room_id: 606441,
    current_room_id: 606441,
    total_booking_value: { cents: 45000, currency: 'EUR' },
    rate_calculation: [{ date: '2026-09-23', cents: 45000, currency: 'EUR' }],
    guest_e_mail: '',
    guest_first_name: '',
    guest_last_name: '',
    ...overrides,
  };
}

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

async function waitFor(check: () => Promise<boolean> | boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for condition.');
}

interface TestTenant {
  tenantId: string;
  propertyId: string;
  userId: string;
  connectionId: string;
  roomTypeId: string;
  cookie: string;
}

interface StuckEventRow {
  id: string;
  tenantId: string;
  propertyId: string;
  connectionId: string;
  eventId: string;
}

interface QueuedClockResponse {
  status: number;
  body: unknown;
  /** When present, the stub awaits this promise before returning — used to
   * hold a specific call's Clock fetch open while another attempt runs to
   * completion, proving real ownership fencing under a deterministic
   * barrier rather than assumed timing. */
  gate?: Promise<void>;
}

describe('Clock webhook durable recovery (real Postgres RLS + real Redis/BullMQ)', () => {
  let app: INestApplication | undefined;
  let pmsPlanId: string;
  let tenantA: TestTenant;
  let tenantB: TestTenant;
  let queuedResponses: QueuedClockResponse[] = [];
  const httpClientStub: Pick<ClockHttpClient, 'request'> = {
    request: async <T = unknown>(_credentials: unknown, options: { path: string }) => {
      // Reserved in call order, so which attempt's fetch is gated is
      // determined by which one calls request() first, not by which one
      // happens to resolve first. A booking fetch only takes a response for
      // the same booking id: hydrate-event jobs retry for minutes, so a job
      // left over from an earlier test can still be retrying and must not
      // consume a later test's response.
      const bookingId = /\/bookings\/(\d+)$/.exec(options.path)?.[1];
      const index = queuedResponses.findIndex((candidate) => {
        const responseId = (candidate.body as { id?: unknown } | null)?.id;
        return !bookingId || responseId === undefined || String(responseId) === bookingId;
      });
      if (index < 0) throw new Error('No stubbed Clock response queued.');
      const [next] = queuedResponses.splice(index, 1) as [QueuedClockResponse];
      if (next.gate) await next.gate;
      return { status: next.status, body: next.body } as { status: number; body: T };
    },
  };
  const mail: MailProvider = {
    async sendVerificationEmail(command) {
      verificationTokens.set(
        command.to,
        new URL(command.verificationUrl).searchParams.get('token')!,
      );
    },
    async sendWelcomeEmail() {},
    async sendPasswordResetEmail() {},
    async sendStaffInvitationEmail() {},
    async sendPaymentConfirmationEmail() {},
    async sendNewBookingStaffNotification() {},
    async sendRefundConfirmationEmail() {},
    async sendBookingCancelledEmail() {},
    async sendBookingCancelledStaffNotification() {},
    async sendRenderedEmail() {},
  };
  const verificationTokens = new Map<string, string>();

  async function createTenant(label: string): Promise<TestTenant> {
    const email = `clock-recovery-${label}-${randomUUID()}@example.test`;
    const signup = await request(app!.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: `Clock Recovery Hotel ${label}`,
        propertyName: 'Main Property',
        propertyAddress: '1 Main Street',
        propertyTimezone: 'Europe/Tirane',
        email,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);
    const tenantId = signup.body.organization.id;
    const propertyId = signup.body.property.id;
    const userId = signup.body.user.id;
    const cookie = signup.headers['set-cookie'][0];
    await request(app!.getHttpServer())
      .post('/auth/email-verification/confirm')
      .send({ token: verificationTokens.get(email) })
      .expect(204);

    await admin.$executeRaw`UPDATE organizations SET plan_id = ${pmsPlanId}::uuid WHERE id = ${tenantId}::uuid`;

    const connection = await request(app!.getHttpServer())
      .post(`/tenants/${tenantId}/integration-connections`)
      .set('Cookie', cookie)
      .send({
        kind: 'PMS',
        provider: 'CLOCK_PMS',
        name: `Recovery Test Clock ${label}`,
        credentials: { host: 'h', accountId: '1', subscriptionId: '2', apiUser: 'u', apiKey: 'k' },
      })
      .expect(201);
    const connectionId = connection.body.id;
    await request(app!.getHttpServer())
      .patch(
        `/tenants/${tenantId}/properties/${propertyId}/integration-connections/${connectionId}`,
      )
      .set('Cookie', cookie)
      .send({ enabled: true })
      .expect(200);

    const roomTypeId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO room_types (id, tenant_id, property_id, name, max_occupancy)
      VALUES (${roomTypeId}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, 'Standard Rooms', 2)
    `;
    await admin.$executeRaw`
      INSERT INTO clock_catalog_mappings
        (tenant_id, property_id, connection_id, entity_type, external_entity_id, external_name, sync_status, local_entity_id)
      VALUES (${tenantId}::uuid, ${propertyId}::uuid, ${connectionId}::uuid, 'ROOM_TYPE'::"ClockCatalogEntityType",
        '42023', 'Standard Rooms', 'CONFIRMED'::"ClockSyncStatus", ${roomTypeId}::uuid)
    `;

    return { tenantId, propertyId, userId, connectionId, roomTypeId, cookie };
  }

  /** Directly inserts a provider_events row the way ClockWebhookService's
   * storeEvent() does — bypassing the HTTP layer so tests can control
   * status/updated_at precisely (simulating a delivery that committed but
   * never got enqueued, or one stuck past the sweep's grace period). */
  async function insertStuckEvent(
    tenant: TestTenant,
    eventId: string,
    eventType: string,
    objectId: string,
    status: 'RECEIVED' | 'QUEUED',
    ageMs: number,
  ): Promise<string> {
    const updatedAt = new Date(Date.now() - ageMs);
    const rows = await admin.$queryRaw<Array<{ id: string }>>`
      INSERT INTO provider_events (
        tenant_id, property_id, connection_id, provider, event_id, event_type, object_id,
        payload_hash, raw_payload, status, updated_at
      ) VALUES (
        ${tenant.tenantId}::uuid, ${tenant.propertyId}::uuid, ${tenant.connectionId}::uuid, 'CLOCK_PMS'::"IntegrationProvider",
        ${eventId}, ${eventType}, ${objectId}, 'test-hash', '{}'::jsonb, ${status}::"ProviderEventStatus", ${updatedAt}::timestamptz
      ) RETURNING id
    `;
    return rows[0]!.id;
  }

  async function eventStatus(tenant: TestTenant, eventId: string): Promise<string | undefined> {
    const rows = await admin.$queryRaw<Array<{ status: string }>>`
      SELECT status FROM provider_events
      WHERE tenant_id = ${tenant.tenantId}::uuid AND connection_id = ${tenant.connectionId}::uuid AND event_id = ${eventId}
    `;
    return rows[0]?.status;
  }

  beforeAll(async () => {
    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL =
      'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.WEB_APP_URL = 'http://localhost:3001';
    await clearSignupRateLimits();
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_PROVIDER)
      .useValue(mail)
      .overrideProvider(ClockHttpClient)
      .useValue(httpClientStub)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    pmsPlanId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO plans (id, name, max_properties, max_staff_seats, pms_enabled, max_pms_connections_per_property)
      VALUES (${pmsPlanId}::uuid, ${'Clock Recovery Test Plan ' + pmsPlanId}, 10, 10, true, 5)
    `;

    tenantA = await createTenant('a');
    tenantB = await createTenant('b');
  }, 60_000);

  afterAll(async () => {
    if (tenantA?.tenantId) await cleanupTenant(admin, tenantA.tenantId);
    if (tenantA?.userId)
      await admin.$executeRaw`DELETE FROM users WHERE id = ${tenantA.userId}::uuid`;
    if (tenantB?.tenantId) await cleanupTenant(admin, tenantB.tenantId);
    if (tenantB?.userId)
      await admin.$executeRaw`DELETE FROM users WHERE id = ${tenantB.userId}::uuid`;
    if (pmsPlanId) await admin.$executeRaw`DELETE FROM plans WHERE id = ${pmsPlanId}::uuid`;
    if (app) await app.close();
    await admin.$disconnect();
  }, 30_000);

  it('recovers a durably-persisted event that never got enqueued, without any SNS redelivery', async () => {
    // Simulates the exact bug this task fixed: a row committed to
    // provider_events but the enqueue that was supposed to follow it never
    // happened (Redis outage, process crash between commit and enqueue).
    // No webhook is redelivered in this test — recovery must come from the
    // scheduled sweep alone, reading real Postgres, finding this row, and
    // driving it through a real BullMQ job and real hydration.
    const eventId = `recovery-${randomUUID()}`;
    await insertStuckEvent(tenantA, eventId, 'booking_new', '38144004', 'RECEIVED', 10 * 60_000);
    queuedResponses = [{ status: 200, body: realBookingDetail() }];

    const worker = app!.get(ClockWorkerService);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (worker as any).processEventRecoverySweep();

    await waitFor(async () => (await eventStatus(tenantA, eventId)) === 'HYDRATED');

    const booking = await admin.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM bookings WHERE tenant_id = ${tenantA.tenantId}::uuid AND external_booking_id = '38144004'
    `;
    expect(booking).toHaveLength(1);
  });

  it('recovers the same way after the worker and queue service are torn down and reconstructed with fresh Redis connections', async () => {
    // Scope note (corrected after review): this is NOT a real process
    // restart — no new OS process is spawned, and TenantDatabaseService /
    // the hydration/reconciliation services are reused as-is, since they
    // are stateless DB/HTTP-client wrappers a real restart would
    // reconstruct identically. What genuinely gets torn down and rebuilt
    // from scratch is the one thing that actually carries per-process
    // runtime state relevant to this task: both BullMQ-facing services
    // (ClockQueueService's Queue objects and ClockWorkerService's Worker
    // objects), each with a brand-new IORedis connection, exactly as a real
    // restart would reconnect. This is the strongest simulation available
    // without spawning a second Node process, and it directly proves
    // durability does not depend on any of that connection/Worker-instance
    // state surviving — only Redis/Postgres content does.
    const eventId = `restart-recovery-${randomUUID()}`;
    await insertStuckEvent(tenantA, eventId, 'booking_new', '38144005', 'RECEIVED', 10 * 60_000);
    queuedResponses = [{ status: 200, body: realBookingDetail({ id: 38144005, number: '365' }) }];

    const originalWorker = app!.get(ClockWorkerService);
    const originalQueues = app!.get(ClockQueueService);
    await originalWorker.onModuleDestroy();
    await originalQueues.onModuleDestroy();

    const freshQueues = new ClockQueueService();
    freshQueues.onModuleInit();
    const freshWorker = new ClockWorkerService(
      freshQueues,
      app!.get(TenantDatabaseService),
      app!.get(ClockBookingHydrationService),
      app!.get(ClockFolioHydrationService),
      app!.get(IntegrationConnectionsService),
      app!.get(ClockBookingConsistencyService),
      app!.get(ClockPaymentReconciliationService),
      app!.get(ManualReviewService),
    );
    await freshWorker.onModuleInit();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (freshWorker as any).processEventRecoverySweep();
      await waitFor(async () => (await eventStatus(tenantA, eventId)) === 'HYDRATED');
    } finally {
      await freshWorker.onModuleDestroy();
      await freshQueues.onModuleDestroy();
      // Restore real instances so later tests in this file keep working
      // against the app's normal DI-managed worker/queues.
      const restoredQueues = app!.get(ClockQueueService);
      restoredQueues.onModuleInit();
      await app!.get(ClockWorkerService).onModuleInit();
    }
  });

  it('guards a terminal outcome against a later stale write (sequential proof — see the genuinely overlapping-transaction test below for real concurrency)', async () => {
    // Two real, separately-committed transactions target the same row: one
    // commits HYDRATED first, the other (simulating a stale ingestion
    // QUEUED write landing after it) attempts QUEUED afterward. The guarded
    // UPDATE must report 0 rows affected for the stale write. This proves
    // the guard's WHERE clause is correctly enforced by real Postgres
    // against real committed state — it does not by itself prove
    // concurrent-transaction serialization, which the next test covers.
    const eventId = `race-${randomUUID()}`;
    const rowId = await insertStuckEvent(tenantA, eventId, 'booking_new', '38144004', 'QUEUED', 0);

    const database = app!.get(TenantDatabaseService);
    await database.withTenantTransaction(
      { tenantId: tenantA.tenantId, propertyId: tenantA.propertyId },
      (tx) =>
        tx.$executeRawUnsafe(
          `UPDATE provider_events SET status = 'HYDRATED'::"ProviderEventStatus", updated_at = CURRENT_TIMESTAMP
           WHERE tenant_id = $1::uuid AND id = $2::uuid AND status <> ALL($3::"ProviderEventStatus"[])`,
          tenantA.tenantId,
          rowId,
          ['HYDRATED', 'IGNORED'],
        ),
    );

    const staleAffected = await database.withTenantTransaction(
      { tenantId: tenantA.tenantId, propertyId: tenantA.propertyId },
      (tx) =>
        tx.$executeRawUnsafe(
          `UPDATE provider_events SET status = 'QUEUED'::"ProviderEventStatus", updated_at = CURRENT_TIMESTAMP
           WHERE tenant_id = $1::uuid AND id = $2::uuid AND status <> ALL($3::"ProviderEventStatus"[])`,
          tenantA.tenantId,
          rowId,
          ['HYDRATED', 'IGNORED'],
        ),
    );

    expect(staleAffected).toBe(0);
    expect(await eventStatus(tenantA, eventId)).toBe('HYDRATED');
  });

  it('a genuinely overlapping transaction race: a slower stale UPDATE blocks on the row lock and is correctly rejected once the faster terminal write commits first', async () => {
    // Real concurrency, not two sequential awaits: the "terminal" write
    // holds its transaction open (pg_sleep before commit) after issuing its
    // UPDATE, so the "stale" write's UPDATE — started while the first
    // transaction is still uncommitted — genuinely blocks on Postgres's row
    // lock. Once the first transaction commits, the blocked UPDATE resumes,
    // re-evaluates its WHERE clause against the row Postgres just
    // committed, and correctly affects 0 rows.
    const eventId = `overlap-${randomUUID()}`;
    const rowId = await insertStuckEvent(tenantA, eventId, 'booking_new', '1', 'QUEUED', 0);
    const database = app!.get(TenantDatabaseService);

    const terminalPromise = database.withTenantTransaction(
      { tenantId: tenantA.tenantId, propertyId: tenantA.propertyId },
      async (tx) => {
        await tx.$executeRawUnsafe(
          `UPDATE provider_events SET status = 'HYDRATED'::"ProviderEventStatus", updated_at = CURRENT_TIMESTAMP
           WHERE tenant_id = $1::uuid AND id = $2::uuid AND status <> ALL($3::"ProviderEventStatus"[])`,
          tenantA.tenantId,
          rowId,
          ['HYDRATED', 'IGNORED'],
        );
        await tx.$executeRawUnsafe('SELECT pg_sleep(1)');
      },
    );

    // Brief head start so the terminal transaction's UPDATE acquires the
    // row lock before the stale one attempts to.
    await new Promise((resolve) => setTimeout(resolve, 150));

    const stalePromise = database.withTenantTransaction(
      { tenantId: tenantA.tenantId, propertyId: tenantA.propertyId },
      (tx) =>
        tx.$executeRawUnsafe(
          `UPDATE provider_events SET status = 'QUEUED'::"ProviderEventStatus", updated_at = CURRENT_TIMESTAMP
           WHERE tenant_id = $1::uuid AND id = $2::uuid AND status <> ALL($3::"ProviderEventStatus"[])`,
          tenantA.tenantId,
          rowId,
          ['HYDRATED', 'IGNORED'],
        ),
    );

    const [, staleAffected] = await Promise.all([terminalPromise, stalePromise]);
    expect(staleAffected).toBe(0);
    expect(await eventStatus(tenantA, eventId)).toBe('HYDRATED');
  }, 15_000);

  it('real ownership fencing at the effect-application layer: an old attempt paused mid-Clock-fetch cannot overwrite a newer attempt’s already-committed result', async () => {
    // Exercises the actual processing/application path (ClockBookingHydrationService.hydrateBooking with
    // real ownership params), not hand-orchestrated status-only helper calls, with a
    // deterministic barrier controlling real timing:
    //   1. A passes its initial claim and starts its Clock fetch, then pauses there (gated).
    //   2. B takes ownership (claims, overwriting A's token) and applies a
    //      distinguishable newer result to completion.
    //   3. A resumes with its own (older, now-stale) fetched result and
    //      opens its effect-applying transaction.
    //   4. Assert A cannot overwrite booking fields or increment version a
    //      second time, create ancillary effects (no duplicate row), or
    //      change B's terminal outcome.
    const eventId = `ownership-${randomUUID()}`;
    const externalBookingId = '38144099';
    const rowId = await insertStuckEvent(
      tenantA,
      eventId,
      'booking_new',
      externalBookingId,
      'RECEIVED',
      0,
    );
    const database = app!.get(TenantDatabaseService);
    const hydrationService = app!.get(ClockBookingHydrationService);

    async function claim(token: string, generation: number): Promise<boolean> {
      const [sql, params] = claimEventSql({
        tenantId: tenantA.tenantId,
        eventRowId: rowId,
        allowedFrom: ['RECEIVED', 'QUEUED'],
        token,
        generation,
      });
      const affected = await database.withTenantTransaction(
        { tenantId: tenantA.tenantId, propertyId: tenantA.propertyId },
        (tx) => tx.$executeRawUnsafe(sql, ...params),
      );
      return affected > 0;
    }

    const tokenA = 'token-attempt-A-stalled';
    const tokenB = 'token-attempt-B-replacement';
    expect(await claim(tokenA, 1)).toBe(true);

    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    // A's distinguishable (stale) fetched result — must never reach the row.
    queuedResponses = [
      {
        status: 200,
        body: realBookingDetail({
          id: Number(externalBookingId),
          number: 'A-STALE',
          total_booking_value: { cents: 10_000, currency: 'EUR' },
        }),
        gate: gateA,
      },
    ];
    const promiseA = hydrationService.hydrateBooking(
      tenantA.tenantId,
      tenantA.propertyId,
      tenantA.connectionId,
      externalBookingId,
      { eventRowId: rowId, token: tokenA },
    );

    // Let A's call actually start and reserve (shift) its gated response
    // before B's claim/fetch happens — proves ordering is by call order,
    // not resolution order.
    await new Promise((resolve) => setTimeout(resolve, 100));

    // BullMQ reassigns to a replacement attempt B — its claim overwrites A's token.
    expect(await claim(tokenB, 2)).toBe(true);

    // B's distinguishable (winning) result, ungated — runs to completion first.
    queuedResponses.push({
      status: 200,
      body: realBookingDetail({
        id: Number(externalBookingId),
        number: 'B-WINNER',
        total_booking_value: { cents: 20_000, currency: 'EUR' },
      }),
    });
    const outcomeB = await hydrationService.hydrateBooking(
      tenantA.tenantId,
      tenantA.propertyId,
      tenantA.connectionId,
      externalBookingId,
      { eventRowId: rowId, token: tokenB },
    );
    expect(outcomeB.outcome).toBe('created');
    expect(await eventStatus(tenantA, eventId)).toBe('HYDRATED');

    // Now release A's stale fetch — it resumes, opens its own
    // effect-applying transaction, and must detect (under a real row lock)
    // that it no longer owns the row.
    releaseA();
    const outcomeA = await promiseA;
    expect(outcomeA.outcome).toBe('ownership_lost');

    // Business effects, not just status: still HYDRATED, exactly one
    // booking row, reflecting only B's data — version is exactly 1
    // (the table default on a fresh INSERT), proving the ON CONFLICT DO
    // UPDATE path (which would set version = version + 1) never ran a
    // second time. If A's stale write had leaked through, this would show
    // version 2 and/or A's "A-STALE" / 100.00 values instead.
    expect(await eventStatus(tenantA, eventId)).toBe('HYDRATED');
    const bookings = await admin.$queryRaw<
      Array<{ externalReference: string; totalAmount: string; version: number }>
    >`
      SELECT external_reference AS "externalReference", total_amount::text AS "totalAmount", version
      FROM bookings WHERE tenant_id = ${tenantA.tenantId}::uuid AND external_booking_id = ${externalBookingId}
    `;
    expect(bookings).toHaveLength(1);
    expect(bookings[0]!.externalReference).toBe('CLOCK-B-WINNER');
    expect(bookings[0]!.totalAmount).toBe('200.00');
    expect(bookings[0]!.version).toBe(1);
  });

  it('real BullMQ stalled-job reassignment: an old attempt genuinely stalled and reassigned cannot replace the newer attempt’s token or apply effects', async () => {
    // Exercises actual BullMQ stalled-job detection — no attempt numbers
    // are manually assigned. Attempt A's real Worker is force-closed while
    // paused mid-fetch (stopping BullMQ's own lock-renewal timer, exactly
    // how a genuinely crashed worker process would stop renewing), its
    // lock is left to expire for real, and BullMQ's real
    // moveStalledJobsToWait() is driven twice (its own documented
    // two-tick protocol: tick 1 marks an active job "potentially
    // stalled," tick 2 — after the lock is actually gone — reassigns it)
    // to genuinely reassign the job to attempt B. Verified directly
    // against the installed bullmq@6 source before writing this test:
    // `prepareJobForProcessing.lua`'s `HINCRBY jobKey "ats" 1` on every
    // real activation is what makes `job.attemptsStarted` increase here.
    const eventId = `real-stall-${randomUUID()}`;
    const externalBookingId = '38144299';
    const jobId = clockHydrateEventJobId(tenantA.connectionId, eventId);
    await insertStuckEvent(tenantA, eventId, 'booking_new', externalBookingId, 'RECEIVED', 0);

    const workerService = app!.get(ClockWorkerService) as unknown as {
      processHydrateEvent: (job: unknown) => Promise<void>;
    };

    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    queuedResponses = [
      {
        status: 200,
        body: realBookingDetail({
          id: Number(externalBookingId),
          number: 'REAL-STALLED-A',
          total_booking_value: { cents: 10_000, currency: 'EUR' },
        }),
        gate: gateA,
      },
      {
        status: 200,
        body: realBookingDetail({
          id: Number(externalBookingId),
          number: 'REAL-REASSIGNED-B',
          total_booking_value: { cents: 30_000, currency: 'EUR' },
        }),
      },
    ];

    const seenTokens: string[] = [];
    const finishedTokens: string[] = [];
    let attemptAStarted!: () => void;
    const attemptAStartedPromise = new Promise<void>((resolve) => {
      attemptAStarted = resolve;
    });

    // The app's own ClockWorkerService keeps a live internal Worker
    // listening on this same queue (see the "restart" test above for the
    // same teardown pattern) — left running, it would race workerA/workerB
    // for the job below and this test's hand-driven stalled-reassignment
    // sequence would be nondeterministic (or just hang, if the app's
    // worker wins the race and finishes the job before workerA ever sees
    // it). Stop it for the duration of this test and restore it after.
    await app!.get(ClockWorkerService).onModuleDestroy();

    const connectionA = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    const workerA = new Worker(
      'clock.webhooks',
      async (job) => {
        if (job.name !== 'hydrate-event') return;
        // Capture the token now — after workerA is force-closed below,
        // BullMQ mutates job.token on the live job object, so reading
        // job.token again later (once the gated fetch resumes) would
        // observe the wrong value and this attempt's finish would never be
        // recognized by finishedTokens.includes(tokenA) below.
        const capturedToken = job.token!;
        seenTokens.push(capturedToken);
        attemptAStarted();
        try {
          await workerService.processHydrateEvent(job);
        } finally {
          finishedTokens.push(capturedToken);
        }
      },
      { connection: connectionA, lockDuration: 500, stalledInterval: 50, maxStalledCount: 1 },
    );

    await app!.get(ClockQueueService).enqueue(
      'clock.webhooks',
      'hydrate-event',
      {
        tenantId: tenantA.tenantId,
        propertyId: tenantA.propertyId,
        connectionId: tenantA.connectionId,
        eventId,
      },
      { jobId, attempts: 3 },
    );

    // Wait for A to actually pick the job up and claim it for real (its
    // Clock fetch is gated, so it's now genuinely paused there).
    await attemptAStartedPromise;
    await waitFor(async () => (await eventStatus(tenantA, eventId)) === 'QUEUED');
    const tokenA = seenTokens[0]!;

    // Simulate A's process crashing: force-close stops its lock-renewal
    // timer without resolving the gate. The lock (500ms TTL) is now left
    // to expire for real — nothing is renewing it anymore.
    await workerA.close(true);
    await new Promise((resolve) => setTimeout(resolve, 700));

    // A second, real Worker — this is what BullMQ actually reassigns the
    // stalled job to.
    const connectionB = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    const workerB = new Worker(
      'clock.webhooks',
      async (job) => {
        if (job.name !== 'hydrate-event') return;
        seenTokens.push(job.token!);
        await workerService.processHydrateEvent(job);
        finishedTokens.push(job.token!);
      },
      { connection: connectionB, lockDuration: 30_000, stalledInterval: 50, maxStalledCount: 1 },
    );

    try {
      // The app's own worker (torn down above) ran its own periodic
      // moveStalledJobsToWait() with a much longer default stalledInterval
      // while it was alive across the earlier tests in this file — that
      // sets a "stalled-check" rate-limit key (PX = that call's own
      // maxCheckTime) shared per queue name in Redis, and
      // moveStalledJobsToWait no-ops entirely (returns before touching
      // anything) while that key still exists. Clear it so our manual
      // calls below, with their much shorter stalledInterval, aren't
      // silently swallowed by a leftover lock from before this test.
      await connectionB.del(workerB.toKey('stalled-check'));

      // BullMQ's own documented two-tick stalled protocol: the first call
      // marks the still-active job as "potentially stalled" (nothing
      // happens yet); the second call, once the lock is genuinely gone,
      // actually moves it back to wait for real reassignment. The
      // `stalledInterval`-based rate-limit key requires a short real wait
      // between calls.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (workerB as any).moveStalledJobsToWait();
      await new Promise((resolve) => setTimeout(resolve, 100));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (workerB as any).moveStalledJobsToWait();

      // Wait for the real reassignment to actually dispatch to B and for
      // B's claim to land (still gated on nothing — B's response is
      // ungated, so it runs straight through).
      await waitFor(async () => (await eventStatus(tenantA, eventId)) === 'HYDRATED', 15_000);

      expect(seenTokens.length).toBe(2);
      const tokenB = seenTokens[1]!;
      expect(tokenB).not.toBe(tokenA); // genuinely distinct real BullMQ tokens, not assigned by the test

      // Now release A's stale, gated fetch — its resumed execution must
      // fail to replace B's token or apply its own (stale) effect.
      releaseA();
      await waitFor(() => finishedTokens.includes(tokenA), 5_000);

      const row = await admin.$queryRaw<Array<{ processingToken: string | null }>>`
        SELECT processing_token AS "processingToken" FROM provider_events
        WHERE tenant_id = ${tenantA.tenantId}::uuid AND connection_id = ${tenantA.connectionId}::uuid AND event_id = ${eventId}
      `;
      // Token was cleared by B's successful finalize — A never got to set
      // its own stale token over it.
      expect(row[0]!.processingToken).toBeNull();
      expect(await eventStatus(tenantA, eventId)).toBe('HYDRATED');

      const bookings = await admin.$queryRaw<
        Array<{ externalReference: string; totalAmount: string; version: number }>
      >`
        SELECT external_reference AS "externalReference", total_amount::text AS "totalAmount", version
        FROM bookings WHERE tenant_id = ${tenantA.tenantId}::uuid AND external_booking_id = ${externalBookingId}
      `;
      expect(bookings).toHaveLength(1);
      expect(bookings[0]!.externalReference).toBe('CLOCK-REAL-REASSIGNED-B');
      expect(bookings[0]!.totalAmount).toBe('300.00');
      expect(bookings[0]!.version).toBe(1);
    } finally {
      await workerB.close(true);
      // Restore the app's normal DI-managed worker so later tests in this
      // file keep working against it.
      await app!.get(ClockWorkerService).onModuleInit();
    }
  }, 30_000);

  it('claimEventSql guard, direct SQL-level proof: generation ordering, and same-generation same/different token — real Postgres, deterministic inputs', async () => {
    // Deliberately not routed through real BullMQ dispatch (see the
    // "real BullMQ stalled-job reassignment" test below for that) — this
    // proves the guard's exact WHERE-clause semantics with fully
    // deterministic generation/token combinations, including the two cases
    // that are impractical to force reliably through real BullMQ timing:
    // an exact tie broken by token identity.
    const database = app!.get(TenantDatabaseService);
    async function claim(rowId: string, token: string, generation: number): Promise<boolean> {
      const [sql, params] = claimEventSql({
        tenantId: tenantA.tenantId,
        eventRowId: rowId,
        allowedFrom: ['RECEIVED', 'QUEUED'],
        token,
        generation,
      });
      const affected = await database.withTenantTransaction(
        { tenantId: tenantA.tenantId, propertyId: tenantA.propertyId },
        (tx) => tx.$executeRawUnsafe(sql, ...params),
      );
      return affected > 0;
    }
    async function currentClaim(rowId: string) {
      const rows = await admin.$queryRaw<
        Array<{ processingToken: string | null; processingAttempt: number | null }>
      >`SELECT processing_token AS "processingToken", processing_attempt AS "processingAttempt"
        FROM provider_events WHERE id = ${rowId}::uuid`;
      return rows[0]!;
    }

    // Case 1: a strictly newer generation overwrites; a strictly older,
    // later-arriving generation is rejected.
    const rowId1 = await insertStuckEvent(
      tenantA,
      `claim-order-${randomUUID()}`,
      'booking_new',
      '1',
      'RECEIVED',
      0,
    );
    expect(await claim(rowId1, 'token-B-fresh', 2)).toBe(true);
    expect(await claim(rowId1, 'token-A-obsolete', 1)).toBe(false);
    expect((await currentClaim(rowId1)).processingToken).toBe('token-B-fresh');

    // Case 2: same generation, same token — idempotent re-claim allowed
    // (the same attempt issuing the write twice, e.g. after a transient
    // DB error retried the claim call).
    const rowId2 = await insertStuckEvent(
      tenantA,
      `claim-idem-${randomUUID()}`,
      'booking_new',
      '1',
      'RECEIVED',
      0,
    );
    expect(await claim(rowId2, 'token-same', 5)).toBe(true);
    expect(await claim(rowId2, 'token-same', 5)).toBe(true);
    const afterIdempotent = await currentClaim(rowId2);
    expect(afterIdempotent.processingToken).toBe('token-same');
    expect(afterIdempotent.processingAttempt).toBe(5);

    // Case 3: same generation, different token — rejected. Two distinct
    // dispatches should never legitimately tie, but if they did, neither
    // may silently replace the other.
    const rowId3 = await insertStuckEvent(
      tenantA,
      `claim-tie-${randomUUID()}`,
      'booking_new',
      '1',
      'RECEIVED',
      0,
    );
    expect(await claim(rowId3, 'token-first', 7)).toBe(true);
    expect(await claim(rowId3, 'token-second-different', 7)).toBe(false);
    expect((await currentClaim(rowId3)).processingToken).toBe('token-first');
  });

  it('missing-job recreation via the real sweep path: a fresh BullMQ job for a row whose old job disappeared can claim even though a stale higher generation was left behind', async () => {
    // Proves the reset-on-recreation path (resetForJobRecreationSql, a real
    // compare-and-swap — ADR-0031, fifth corrective round) prevents the
    // exact failure mode the reviewer flagged: an old job's high-water
    // generation permanently blocking a brand-new job's first claim. Driven
    // through the real sweep production path (reconcileStuckEvent), not
    // hand-assembled SQL, so the whole chain — recreate, claim, hydrate,
    // finalize — is proven end to end.
    const eventId = `recreate-${randomUUID()}`;
    const rowId = await insertStuckEvent(
      tenantA,
      eventId,
      'booking_new',
      '38144200',
      'QUEUED',
      10 * 60_000,
    );
    const database = app!.get(TenantDatabaseService);

    // Simulate an old job that reached a high generation before its lineage
    // disappeared (e.g. several real stalled reassignments happened, then
    // the job aged out of BullMQ retention entirely).
    const [oldClaimSql, oldClaimParams] = claimEventSql({
      tenantId: tenantA.tenantId,
      eventRowId: rowId,
      allowedFrom: ['RECEIVED', 'QUEUED'],
      token: 'old-lineage-token',
      generation: 9,
    });
    await database.withTenantTransaction(
      { tenantId: tenantA.tenantId, propertyId: tenantA.propertyId },
      (tx) => tx.$executeRawUnsafe(oldClaimSql, ...oldClaimParams),
    );

    // reconcileJob reports 'missing' for this row's deterministic jobId (no
    // real job exists) — the real sweep path recreates it and resets the
    // stale claim state via a genuine CAS against the snapshot it reads,
    // then the new job's real worker claims and hydrates it.
    queuedResponses = [
      { status: 200, body: realBookingDetail({ id: 38144200, number: 'RECREATE-OK' }) },
    ];
    const worker = app!.get(ClockWorkerService) as unknown as {
      reconcileStuckEvent: (row: StuckEventRow) => Promise<void>;
    };
    await worker.reconcileStuckEvent({
      id: rowId,
      tenantId: tenantA.tenantId,
      propertyId: tenantA.propertyId,
      connectionId: tenantA.connectionId,
      eventId,
    });

    // The new job's first-ever claim (generation 1, well below the old
    // lineage's 9) must succeed now that the reset cleared the stale
    // high-water mark — without it, `claimEventSql`'s generation guard
    // would reject generation 1 against the stale recorded 9 forever.
    await waitFor(async () => (await eventStatus(tenantA, eventId)) === 'HYDRATED');
    const bookings = await admin.$queryRaw<Array<{ externalReference: string }>>`
      SELECT external_reference AS "externalReference" FROM bookings
      WHERE tenant_id = ${tenantA.tenantId}::uuid AND external_booking_id = '38144200'
    `;
    expect(bookings).toHaveLength(1);
    expect(bookings[0]!.externalReference).toBe('CLOCK-RECREATE-OK');
  });

  it("recreation reset cannot erase ownership the new job's own worker already claimed (forced interleaving through the real recreation methods)", async () => {
    // Fifth corrective review: a blind reset after enqueue could arrive
    // *after* the freshly created job's own worker had already claimed the
    // row, silently wiping that legitimate claim back to NULL. This forces
    // exactly that interleaving — real snapshot read, real enqueue, a real
    // worker claim landing, THEN the (now-stale) reset call — through the
    // actual production methods (readProcessingSnapshot/
    // resetForJobRecreation), not a reimplementation of their SQL.
    const eventId = `recreate-claim-race-${randomUUID()}`;
    const rowId = await insertStuckEvent(
      tenantA,
      eventId,
      'booking_new',
      '38144210',
      'RECEIVED',
      0,
    );
    const jobId = clockHydrateEventJobId(tenantA.connectionId, eventId);

    const worker = app!.get(ClockWorkerService) as unknown as {
      readProcessingSnapshot: (
        tenantId: string,
        propertyId: string,
        eventRowId: string,
      ) => Promise<
        | { status: string; processingToken: string | null; processingAttempt: number | null }
        | undefined
      >;
      resetForJobRecreation: (
        tenantId: string,
        propertyId: string,
        eventRowId: string,
        snapshot: {
          status: string;
          processingToken: string | null;
          processingAttempt: number | null;
        },
      ) => Promise<boolean>;
    };
    const queues = app!.get(ClockQueueService);

    // Step 1: the recreator's snapshot — exactly what recreateMissingJob
    // reads immediately before creating the replacement job.
    const snapshot = await worker.readProcessingSnapshot(
      tenantA.tenantId,
      tenantA.propertyId,
      rowId,
    );
    expect(snapshot).toEqual({
      status: 'RECEIVED',
      processingToken: null,
      processingAttempt: null,
    });

    // Step 2: the recreator creates the replacement job — the same call
    // recreateMissingJob makes. The app's own live ClockWorkerService
    // worker picks it up for real and claims it, gated so its Clock fetch
    // stays paused right after claiming.
    let releaseHydration!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseHydration = resolve;
    });
    queuedResponses = [
      { status: 200, body: realBookingDetail({ id: 38144210, number: 'RACE-WINNER' }), gate },
    ];
    await queues.enqueue(
      'clock.webhooks',
      'hydrate-event',
      {
        tenantId: tenantA.tenantId,
        propertyId: tenantA.propertyId,
        connectionId: tenantA.connectionId,
        eventId,
      },
      { jobId },
    );
    await waitFor(async () => (await eventStatus(tenantA, eventId)) === 'QUEUED');
    const claimedRow = await admin.$queryRaw<Array<{ processingToken: string | null }>>`
      SELECT processing_token AS "processingToken" FROM provider_events WHERE id = ${rowId}::uuid
    `;
    const realClaimToken = claimedRow[0]!.processingToken;
    expect(realClaimToken).not.toBeNull();

    // Step 3: the recreator's reset, arriving late — the exact race the
    // fifth corrective review flagged. It must NOT erase the ownership the
    // new job's worker legitimately just acquired.
    const reset = await worker.resetForJobRecreation(
      tenantA.tenantId,
      tenantA.propertyId,
      rowId,
      snapshot!,
    );
    expect(reset).toBe(false);

    const afterReset = await admin.$queryRaw<
      Array<{ processingToken: string | null; status: string }>
    >`
      SELECT processing_token AS "processingToken", status FROM provider_events WHERE id = ${rowId}::uuid
    `;
    expect(afterReset[0]!.processingToken).toBe(realClaimToken);
    expect(afterReset[0]!.status).toBe('QUEUED');

    // Step 4: release the gated fetch — the transactional hydration
    // fencing and finalize must still complete correctly, proving the
    // CAS-protected reset didn't corrupt the row it correctly declined to
    // touch.
    releaseHydration();
    await waitFor(async () => (await eventStatus(tenantA, eventId)) === 'HYDRATED');
    const bookings = await admin.$queryRaw<Array<{ externalReference: string }>>`
      SELECT external_reference AS "externalReference" FROM bookings
      WHERE tenant_id = ${tenantA.tenantId}::uuid AND external_booking_id = '38144210'
    `;
    expect(bookings).toHaveLength(1);
    expect(bookings[0]!.externalReference).toBe('CLOCK-RACE-WINNER');
  });

  it('concurrent ingestion and sweep recreation requests for the same missing job coordinate durably — exactly one job, no corrupted ownership, exactly one booking applied', async () => {
    // Fifth corrective review: two independent actors (a duplicate SNS
    // delivery reacting through ingestion, and a sweep tick) can both
    // genuinely observe the same row's job as 'missing' and both attempt
    // recreation concurrently. Drives both through their real production
    // entry points at the same time and proves the outcome is never
    // corrupted, regardless of how the real interleaving lands.
    const eventId = `recreate-concurrent-${randomUUID()}`;
    const rowId = await insertStuckEvent(
      tenantA,
      eventId,
      'booking_new',
      '38144211',
      'RECEIVED',
      0,
    );
    const jobId = clockHydrateEventJobId(tenantA.connectionId, eventId);

    let releaseHydration!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseHydration = resolve;
    });
    queuedResponses = [
      {
        status: 200,
        body: realBookingDetail({ id: 38144211, number: 'CONCURRENT-RECREATE' }),
        gate,
      },
    ];

    const worker = app!.get(ClockWorkerService) as unknown as {
      reconcileStuckEvent: (row: StuckEventRow) => Promise<void>;
    };
    const webhook = app!.get(ClockWebhookService) as unknown as {
      recreateMissingJob: (
        connection: { tenantId: string; connectionId: string },
        propertyId: string,
        eventRowId: string,
        eventId: string,
        jobId: string,
      ) => Promise<void>;
    };

    await Promise.all([
      webhook.recreateMissingJob(
        { tenantId: tenantA.tenantId, connectionId: tenantA.connectionId },
        tenantA.propertyId,
        rowId,
        eventId,
        jobId,
      ),
      worker.reconcileStuckEvent({
        id: rowId,
        tenantId: tenantA.tenantId,
        propertyId: tenantA.propertyId,
        connectionId: tenantA.connectionId,
        eventId,
      }),
    ]);

    // BullMQ's own jobId dedup (verified against the installed
    // addStandardJob Lua script — concurrent add() calls for the same
    // jobId serialize inside one atomic script and only the first actually
    // creates a job) guarantees exactly one job exists no matter how many
    // recreators raced to create it. The app's live worker claims it for
    // real; wait for that claim to land rather than asserting immediately,
    // since neither recreator awaits the worker's own dispatch.
    await waitFor(async () => {
      const row = await admin.$queryRaw<Array<{ processingToken: string | null }>>`
        SELECT processing_token AS "processingToken" FROM provider_events WHERE id = ${rowId}::uuid
      `;
      return row[0]?.processingToken != null;
    });

    const row = await admin.$queryRaw<Array<{ processingToken: string | null; status: string }>>`
      SELECT processing_token AS "processingToken", status FROM provider_events WHERE id = ${rowId}::uuid
    `;
    expect(row[0]!.status).toBe('QUEUED');
    expect(row[0]!.processingToken).not.toBeNull(); // a real claim landed and neither recreator erased it

    const state = await app!.get(ClockQueueService).reconcileJob('clock.webhooks', jobId);
    expect(state).toBe('in-flight'); // exactly one job, still gated mid-hydration — no duplicate dispatch

    releaseHydration();
    await waitFor(async () => (await eventStatus(tenantA, eventId)) === 'HYDRATED');
    const bookings = await admin.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM bookings WHERE tenant_id = ${tenantA.tenantId}::uuid AND external_booking_id = '38144211'
    `;
    expect(bookings).toHaveLength(1); // exactly one booking — no duplicate/racing effect
  });

  it('operator-retry path: resetting a FAILED row to RECEIVED per the documented runbook lets the next sweep tick recover it', async () => {
    const eventId = `operator-retry-${randomUUID()}`;
    const rowId = await insertStuckEvent(
      tenantA,
      eventId,
      'booking_new',
      '38144201',
      'RECEIVED',
      10 * 60_000,
    );
    const database = app!.get(TenantDatabaseService);
    const worker = app!.get(ClockWorkerService) as unknown as {
      transitionEventStatus: (
        tenantId: string,
        propertyId: string,
        eventRowId: string,
        status: string,
        options: Record<string, unknown>,
      ) => Promise<boolean>;
    };

    // The event exhausts (simulated directly, matching the documented
    // FAILED semantics) — an operator would see this via the dead-letter
    // queue / a provider_events status query.
    await worker.transitionEventStatus(tenantA.tenantId, tenantA.propertyId, rowId, 'FAILED', {
      allowedFrom: ['RECEIVED', 'QUEUED'],
    });
    expect(await eventStatus(tenantA, eventId)).toBe('FAILED');

    // Operator applies the exact documented recovery procedure (see
    // docs/integrations/clock/webhooks-and-reconciliation.md).
    await database.withTenantTransaction(
      { tenantId: tenantA.tenantId, propertyId: tenantA.propertyId },
      (tx) =>
        tx.$executeRawUnsafe(
          `UPDATE provider_events SET status = 'RECEIVED'::"ProviderEventStatus", processing_token = NULL,
             processing_attempt = NULL, updated_at = now() - interval '10 minutes'
           WHERE tenant_id = $1::uuid AND id = $2::uuid`,
          tenantA.tenantId,
          rowId,
        ),
    );
    expect(await eventStatus(tenantA, eventId)).toBe('RECEIVED');

    // The next real sweep tick picks it up and recovers it normally, with
    // no leftover state from the FAILED attempt blocking the new claim.
    queuedResponses = [
      { status: 200, body: realBookingDetail({ id: 38144201, number: 'RETRY-OK' }) },
    ];
    const worker2 = app!.get(ClockWorkerService) as unknown as {
      processEventRecoverySweep: () => Promise<void>;
    };
    await worker2.processEventRecoverySweep();
    await waitFor(async () => (await eventStatus(tenantA, eventId)) === 'HYDRATED');
  });

  it('a stale sweep snapshot does not resurrect a row that became FAILED between the sweep’s SELECT and its per-row write', async () => {
    const eventId = `stale-sweep-${randomUUID()}`;
    const rowId = await insertStuckEvent(
      tenantA,
      eventId,
      'booking_new',
      '1',
      'RECEIVED',
      10 * 60_000,
    );
    const worker = app!.get(ClockWorkerService) as unknown as {
      transitionEventStatus: (
        tenantId: string,
        propertyId: string,
        eventRowId: string,
        status: string,
        options: Record<string, unknown>,
      ) => Promise<boolean>;
      reconcileStuckEvent: (row: {
        id: string;
        tenantId: string;
        propertyId: string;
        connectionId: string;
        eventId: string;
      }) => Promise<void>;
    };

    // Simulate: the sweep's SELECT already captured this row while it was
    // RECEIVED (this is that stale snapshot); before the sweep gets to
    // process it, another actor (e.g. the async 'failed' listener) marks it
    // FAILED for real.
    await worker.transitionEventStatus(tenantA.tenantId, tenantA.propertyId, rowId, 'FAILED', {
      allowedFrom: ['RECEIVED', 'QUEUED'],
    });
    expect(await eventStatus(tenantA, eventId)).toBe('FAILED');

    await worker.reconcileStuckEvent({
      id: rowId,
      tenantId: tenantA.tenantId,
      propertyId: tenantA.propertyId,
      connectionId: tenantA.connectionId,
      eventId,
    });

    expect(await eventStatus(tenantA, eventId)).toBe('FAILED');
  });

  it('the worker’s own claim never resurrects an already-QUEUED job whose event another actor has since marked FAILED', async () => {
    const eventId = `late-claim-${randomUUID()}`;
    const rowId = await insertStuckEvent(tenantA, eventId, 'booking_new', '1', 'QUEUED', 0);
    const worker = app!.get(ClockWorkerService) as unknown as {
      transitionEventStatus: (
        tenantId: string,
        propertyId: string,
        eventRowId: string,
        status: string,
        options: Record<string, unknown>,
      ) => Promise<boolean>;
    };
    await worker.transitionEventStatus(tenantA.tenantId, tenantA.propertyId, rowId, 'FAILED', {
      allowedFrom: ['RECEIVED', 'QUEUED'],
    });

    // A real hydrate-event job for this same event is now processed by the
    // real, already-running app worker (a late-arriving job whose queue
    // entry predates the FAILED write).
    const queues = app!.get(ClockQueueService);
    const jobId = clockHydrateEventJobId(tenantA.connectionId, eventId);
    const responsesBefore = queuedResponses.length;
    queuedResponses = [{ status: 200, body: realBookingDetail({ id: 1 }) }];
    await queues.enqueue(
      'clock.webhooks',
      'hydrate-event',
      {
        tenantId: tenantA.tenantId,
        propertyId: tenantA.propertyId,
        connectionId: tenantA.connectionId,
        eventId,
      },
      { jobId },
    );

    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await eventStatus(tenantA, eventId)).toBe('FAILED');
    // The stubbed Clock response was never consumed — hydrateBooking was
    // never called, proving the claim guard stopped it before the effect.
    expect(queuedResponses.length).toBe(responsesBefore + 1);
  });

  it('parks a completed-but-unreconciled job as NEEDS_RECONCILIATION with a real ManualReviewItem, and the sweep never selects it again even after the underlying BullMQ job later ages out', async () => {
    const eventId = `unreconciled-${randomUUID()}`;
    const rowId = await insertStuckEvent(
      tenantA,
      eventId,
      'booking_new',
      '1',
      'QUEUED',
      10 * 60_000,
    );
    const jobId = clockHydrateEventJobId(tenantA.connectionId, eventId);
    const queues = app!.get(ClockQueueService);

    // A real job under this exact deterministic id that completes for real
    // without ever touching provider_events — reproduces "the BullMQ job
    // genuinely completed, but its status write never landed" using a real
    // completed job rather than a simulated one. The real running worker's
    // dispatcher falls through to its no-op debug branch for an
    // unrecognized job name and resolves immediately.
    await queues.enqueue('clock.webhooks', 'noop-completed-probe', {}, { jobId });
    await waitFor(async () => (await queues.reconcileJob('clock.webhooks', jobId)) === 'completed');

    const worker = app!.get(ClockWorkerService) as unknown as {
      processEventRecoverySweep: () => Promise<void>;
    };
    await worker.processEventRecoverySweep();

    await waitFor(async () => (await eventStatus(tenantA, eventId)) === 'NEEDS_RECONCILIATION');

    const reviewItems = await admin.$queryRaw<Array<{ category: string; referenceId: string }>>`
      SELECT category::text AS category, reference_id AS "referenceId" FROM manual_review_items
      WHERE tenant_id = ${tenantA.tenantId}::uuid AND reference_type = 'provider_event' AND reference_id = ${eventId}
    `;
    expect(reviewItems.length).toBeGreaterThanOrEqual(1);
    expect(reviewItems[0]!.category).toBe('UNKNOWN_RESULT');

    // Retention-expiry proof: remove the underlying job (as BullMQ's own
    // removeOnComplete retention eventually would) so reconcileJob would
    // now report 'missing' instead of 'completed' — the row must stay
    // parked regardless, because the sweep's own SELECT excludes anything
    // that isn't RECEIVED/QUEUED, so a parked row is never even a candidate
    // for the sweep's per-row reconciliation logic to run on again.
    const rawQueue = new Queue('clock.webhooks', {
      connection: new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null }),
    });
    const job = await rawQueue.getJob(jobId);
    await job?.remove();
    await worker.processEventRecoverySweep();
    expect(await eventStatus(tenantA, eventId)).toBe('NEEDS_RECONCILIATION');
    void rowId;
  });

  it('atomic parking: concurrent parking attempts on the same row create exactly one ManualReviewItem', async () => {
    const eventId = `concurrent-park-${randomUUID()}`;
    const rowId = await insertStuckEvent(tenantA, eventId, 'booking_new', '1', 'QUEUED', 0);
    const row: StuckEventRow = {
      id: rowId,
      tenantId: tenantA.tenantId,
      propertyId: tenantA.propertyId,
      connectionId: tenantA.connectionId,
      eventId,
    };
    const worker = app!.get(ClockWorkerService) as unknown as {
      parkNeedsReconciliation: (row: StuckEventRow) => Promise<void>;
    };

    // Real concurrent attempts to park the same row — the guarded UPDATE's
    // row lock serializes them; only the actor whose write actually lands
    // creates the item.
    await Promise.all([worker.parkNeedsReconciliation(row), worker.parkNeedsReconciliation(row)]);

    expect(await eventStatus(tenantA, eventId)).toBe('NEEDS_RECONCILIATION');
    const items = await admin.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM manual_review_items
      WHERE tenant_id = ${tenantA.tenantId}::uuid AND reference_type = 'provider_event' AND reference_id = ${eventId}
    `;
    expect(items).toHaveLength(1);
  });

  it('atomic parking: a failure inserting the ManualReviewItem rolls back the status write too, and a later attempt then succeeds cleanly', async () => {
    const eventId = `park-rollback-${randomUUID()}`;
    const rowId = await insertStuckEvent(tenantA, eventId, 'booking_new', '1', 'QUEUED', 0);
    const row: StuckEventRow = {
      id: rowId,
      tenantId: tenantA.tenantId,
      propertyId: tenantA.propertyId,
      connectionId: tenantA.connectionId,
      eventId,
    };

    const failingReview = {
      recordInTransaction: vi
        .fn()
        .mockRejectedValue(new Error('simulated ManualReviewItem insert failure')),
    };
    const brokenWorker = new ClockWorkerService(
      app!.get(ClockQueueService),
      app!.get(TenantDatabaseService),
      app!.get(ClockBookingHydrationService),
      app!.get(ClockFolioHydrationService),
      app!.get(IntegrationConnectionsService),
      app!.get(ClockBookingConsistencyService),
      app!.get(ClockPaymentReconciliationService),
      failingReview as never,
    ) as unknown as { parkNeedsReconciliation: (row: StuckEventRow) => Promise<void> };

    await expect(brokenWorker.parkNeedsReconciliation(row)).rejects.toThrow(
      /simulated ManualReviewItem insert failure/,
    );
    // Neither change committed: still QUEUED, not NEEDS_RECONCILIATION.
    expect(await eventStatus(tenantA, eventId)).toBe('QUEUED');
    const itemsAfterFailure = await admin.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM manual_review_items
      WHERE tenant_id = ${tenantA.tenantId}::uuid AND reference_type = 'provider_event' AND reference_id = ${eventId}
    `;
    expect(itemsAfterFailure).toHaveLength(0);

    // A later attempt (the real worker, real ManualReviewService) succeeds
    // cleanly from the rolled-back state — nothing was left half-applied.
    const worker = app!.get(ClockWorkerService) as unknown as {
      parkNeedsReconciliation: (row: StuckEventRow) => Promise<void>;
    };
    await worker.parkNeedsReconciliation(row);
    expect(await eventStatus(tenantA, eventId)).toBe('NEEDS_RECONCILIATION');
    const itemsAfterRetry = await admin.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM manual_review_items
      WHERE tenant_id = ${tenantA.tenantId}::uuid AND reference_type = 'provider_event' AND reference_id = ${eventId}
    `;
    expect(itemsAfterRetry).toHaveLength(1);
  });

  it('rollback effect: dropping the platform_admin policy disables the sweep’s cross-tenant reads entirely (not just other tenants’), while tenant-scoped writes remain unaffected', async () => {
    const eventId = `rollback-${randomUUID()}`;
    await insertStuckEvent(tenantA, eventId, 'booking_new', '1', 'RECEIVED', 10 * 60_000);

    await admin.$executeRawUnsafe(
      `DROP POLICY "provider_events_platform_admin_read" ON "provider_events"`,
    );
    try {
      const database = app!.get(TenantDatabaseService);
      // Read as platform_admin — with the policy gone, app.tenant_id is
      // never set by withPlatformAdminTransaction, so this returns nothing
      // for ANY tenant's rows, not merely other tenants'.
      const crossTenantRows = await database.withPlatformAdminTransaction(
        { role: 'platform_admin' },
        (tx) =>
          tx.$queryRawUnsafe<Array<{ id: string }>>(
            `SELECT id FROM provider_events WHERE status = 'RECEIVED' AND event_id = $1`,
            eventId,
          ),
      );
      expect(crossTenantRows).toHaveLength(0);

      // Per-tenant webhook ingestion/processing is completely unaffected —
      // it never relied on this policy.
      const affected = await database.withTenantTransaction(
        { tenantId: tenantA.tenantId, propertyId: tenantA.propertyId },
        (tx) =>
          tx.$executeRawUnsafe(
            `UPDATE provider_events SET status = 'IGNORED'::"ProviderEventStatus", updated_at = CURRENT_TIMESTAMP
             WHERE tenant_id = $1::uuid AND connection_id = $2::uuid AND event_id = $3
               AND status <> ALL($4::"ProviderEventStatus"[])`,
            tenantA.tenantId,
            tenantA.connectionId,
            eventId,
            ['HYDRATED', 'IGNORED'],
          ),
      );
      expect(affected).toBe(1);
    } finally {
      // Restore for the remaining tests in this file / suite integrity.
      await admin.$executeRawUnsafe(`
        CREATE POLICY "provider_events_platform_admin_read" ON "provider_events"
          FOR SELECT
          USING (
            "tenant_id" = "app_current_tenant_id"()
            OR current_setting('app.role', true) = 'platform_admin'
          )
      `);
    }
  });

  it('the recovery sweep reads across tenants (platform_admin carve-out), but a tenant-scoped write can never touch another tenant’s row', async () => {
    const eventIdA = `cross-tenant-a-${randomUUID()}`;
    const eventIdB = `cross-tenant-b-${randomUUID()}`;
    await insertStuckEvent(
      tenantA,
      eventIdA,
      'unsupported_event_type',
      'x',
      'RECEIVED',
      10 * 60_000,
    );
    const rowIdB = await insertStuckEvent(
      tenantB,
      eventIdB,
      'unsupported_event_type',
      'x',
      'RECEIVED',
      10 * 60_000,
    );

    const database = app!.get(TenantDatabaseService);
    const crossTenantRows = await database.withPlatformAdminTransaction(
      { role: 'platform_admin' },
      (tx) =>
        tx.$queryRawUnsafe<Array<{ id: string; tenantId: string }>>(
          `SELECT id, tenant_id AS "tenantId" FROM provider_events
           WHERE status = 'RECEIVED' AND event_id = ANY($1::text[])`,
          [eventIdA, eventIdB],
        ),
    );
    expect(crossTenantRows.map((row) => row.tenantId).sort()).toEqual(
      [tenantA.tenantId, tenantB.tenantId].sort(),
    );

    // A write scoped to tenant A must never affect tenant B's row, even
    // when given B's row id directly — RLS denies it, not just app logic.
    const deniedAffected = await database.withTenantTransaction(
      { tenantId: tenantA.tenantId, propertyId: tenantA.propertyId },
      (tx) =>
        tx.$executeRawUnsafe(
          `UPDATE provider_events SET status = 'FAILED'::"ProviderEventStatus" WHERE id = $1::uuid`,
          rowIdB,
        ),
    );
    expect(deniedAffected).toBe(0);
    expect(await eventStatus(tenantB, eventIdB)).toBe('RECEIVED');
  });

  it('sweep fairness: rotates past the 200-row batch limit across ticks instead of re-selecting the same oldest rows', async () => {
    const prefix = `fairness-${randomUUID()}`;
    const total = 205;
    for (let index = 0; index < total; index += 1) {
      await insertStuckEvent(
        tenantA,
        `${prefix}-${index}`,
        'unsupported_event_type',
        String(index),
        'RECEIVED',
        20 * 60_000 - index, // strictly increasing age -> deterministic ORDER BY updated_at ASC
      );
    }

    const worker = app!.get(ClockWorkerService);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (worker as any).processEventRecoverySweep();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (worker as any).processEventRecoverySweep();

    // unsupported_event_type is neither a booking nor folio event type, so
    // real hydration classifies it IGNORED once actually processed — after
    // two ticks (400 row-examinations against 205 real rows), every single
    // one must have progressed past RECEIVED, proving the batch limit did
    // not permanently strand any of them behind an unmovable head-of-queue.
    await waitFor(async () => {
      const remaining = await admin.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*)::bigint AS count FROM provider_events
        WHERE tenant_id = ${tenantA.tenantId}::uuid AND event_id LIKE ${prefix + '%'} AND status = 'RECEIVED'
      `;
      return remaining[0]!.count === 0n;
    }, 20_000);
  }, 30_000);

  it('the durable-recovery migration is safe to re-run (idempotent additive RLS policy)', async () => {
    // prisma migrate deploy already ran this migration once during this
    // suite's environment setup; re-applying its exact SQL here proves the
    // DROP POLICY IF EXISTS / CREATE POLICY pair tolerates being re-run
    // without erroring or duplicating policies — the same guarantee
    // `prisma migrate deploy` relies on when it's run twice against an
    // already-migrated database (also verified directly: a second real
    // `prisma migrate deploy` in this session reported "No pending
    // migrations to apply").
    await admin.$executeRawUnsafe(
      `DROP POLICY IF EXISTS "provider_events_platform_admin_read" ON "provider_events"`,
    );
    await admin.$executeRawUnsafe(`
      CREATE POLICY "provider_events_platform_admin_read" ON "provider_events"
        FOR SELECT
        USING (
          "tenant_id" = "app_current_tenant_id"()
          OR current_setting('app.role', true) = 'platform_admin'
        )
    `);
    const policies = await admin.$queryRaw<Array<{ policyname: string }>>`
      SELECT policyname FROM pg_policies
      WHERE tablename = 'provider_events' AND policyname = 'provider_events_platform_admin_read'
    `;
    expect(policies).toHaveLength(1);
  });
});
