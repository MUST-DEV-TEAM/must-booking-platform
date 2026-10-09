import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';

import { TenantDatabaseService } from '../../tenancy/tenant-database.service';
import { IntegrationConnectionsService } from '../integration-connections.service';
import { ManualReviewService } from '../manual-review.service';
import {
  CLOCK_QUEUE_NAMES,
  clockHydrateEventJobId,
  type ClockQueueName,
} from './clock-queue-names';
import {
  claimEventSql,
  guardedTransitionSql,
  processingSnapshotSql,
  resetForJobRecreationSql,
  touchExaminedSql,
  type ProcessingSnapshot,
  type ProviderEventStatus,
} from './clock-provider-event-status';
import { ClockBookingConsistencyService } from './clock-booking-consistency.service';
import { ClockBookingHydrationService } from './clock-booking-hydration.service';
import { ClockFolioHydrationService } from './clock-folio-hydration.service';
import { ClockPaymentReconciliationService } from './clock-payment-reconciliation.service';
import {
  ClockQueueService,
  HYDRATE_EVENT_JOB_OPTIONS,
  type JobReconciliationState,
} from './clock-queue.service';
import { reportOperationalFailure } from '../../observability/error-tracking';

// ADR-0031: every automatic (non-operator) transition out of RECEIVED/QUEUED
// is explicit about which prior states it may fire from — FAILED and
// NEEDS_RECONCILIATION never appear here, so nothing automatic can
// resurrect either.
const NON_TERMINAL: ProviderEventStatus[] = ['RECEIVED', 'QUEUED'];

// Event types this worker actually applies (source brief's Fetch/Normalize/
// Apply steps) — see docs/CLOCK_WEBHOOK_FLOW.md for how this was confirmed
// against real captured events 2026-09-03. All four share one handler
// because ClockBookingHydrationService.hydrateBooking always re-fetches the
// booking's current full state from Clock rather than diffing the event
// itself — a cancellation, a date/room change, and a guest-count change are
// all just "something about this booking changed, go re-read it," including
// a booking_canceled correctly landing the local row as CANCELLED (the
// fetched detail's own status drives that, same code path as any other
// update). folio_update (and anything else Clock sends) is acknowledged but
// not yet applied — logged, not silently dropped, so a future task adding
// folio/payment sync has something to grep for.
const BOOKING_EVENT_TYPES = new Set([
  'booking_new',
  'booking_guests_update',
  'booking_update',
  'booking_canceled',
]);

// Clock certification gap Task C (docs/CLOCK_CERTIFICATION_GAPS_PLAN.md) —
// visibility-only folio sync, real captured event types confirmed
// 2026-09-03. Deliberately separate from BOOKING_EVENT_TYPES/hydrateBooking:
// folios are fetched from a different Clock API family and only ever
// updated (id/balance/closed-at), never used to create anything.
const FOLIO_EVENT_TYPES = new Set(['folio_update', 'folio_close']);

const RECONCILIATION_SCHEDULER_ID = 'daily-clock-booking-reconciliation';
const RECONCILIATION_SCHEDULE_JOB = 'schedule-reconciliation';
const RECONCILE_PROPERTY_JOB = 'reconcile-property';
const RECONCILE_PAYMENTS_JOB = 'reconcile-payments';
const RECONCILIATION_CRON = '0 3 * * *';

// Durable webhook recovery: provider_events rows stuck RECEIVED/QUEUED past
// a grace period never got a live BullMQ job (or the job's own hand-off
// completed but this process crashed before recording it) — the only way
// back into processing that doesn't depend on Clock ever redelivering the
// same event again. FAILED rows are deliberately excluded: those already
// exhausted BullMQ's own attempts and are on the dead-letter queue for
// operator action, not silently auto-retried forever.
const EVENT_SWEEP_SCHEDULER_ID = 'clock-provider-event-recovery-sweep';
const EVENT_SWEEP_SCHEDULE_JOB = 'sweep-stuck-events';
const EVENT_SWEEP_INTERVAL_MS = 5 * 60_000;
// Comfortably longer than the typical enqueue-to-terminal-attempt window (3
// attempts, exponential backoff starting at 2s, finishes well under a
// minute in the common case) — but this is a heuristic for *when to look*,
// not a correctness guarantee: a slow Clock API call, a busy worker pool, or
// backoff on a flaky attempt can legitimately take longer. The grace period
// alone does not prevent a race with an in-flight worker; `reconcileJob()`
// (real BullMQ job-state inspection) is what actually prevents duplicating
// work for a row the sweep selects too early — see reconcileStuckEvent.
const EVENT_SWEEP_GRACE_MS = 3 * 60_000;
const EVENT_SWEEP_BATCH_LIMIT = 200;

interface StuckProviderEventRow {
  id: string;
  tenantId: string;
  propertyId: string;
  connectionId: string;
  eventId: string;
}

interface HydrateEventJobData {
  tenantId: string;
  propertyId: string;
  connectionId: string;
  eventId: string;
}

interface ReconcilePropertyJobData {
  tenantId: string;
  propertyId: string;
  startsOn: string;
  endsOn: string;
}

interface ReconcilePaymentsJobData {
  tenantId: string;
  propertyId: string;
  since: string;
}

function isHydrateEventJobData(value: unknown): value is HydrateEventJobData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return (
    typeof data.tenantId === 'string' &&
    typeof data.propertyId === 'string' &&
    typeof data.connectionId === 'string' &&
    typeof data.eventId === 'string'
  );
}

function isReconcilePropertyJobData(value: unknown): value is ReconcilePropertyJobData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return (
    typeof data.tenantId === 'string' &&
    typeof data.propertyId === 'string' &&
    typeof data.startsOn === 'string' &&
    typeof data.endsOn === 'string'
  );
}

function isReconcilePaymentsJobData(value: unknown): value is ReconcilePaymentsJobData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return (
    typeof data.tenantId === 'string' &&
    typeof data.propertyId === 'string' &&
    typeof data.since === 'string'
  );
}

/**
 * Worker skeletons only (Task 9's explicit scope) — every queue gets a real
 * BullMQ Worker so the infrastructure is provably wired end-to-end, but the
 * processor just logs receipt. Real job logic replaces `process()`'s branches
 * as each consuming task lands: Task 10 for clock.critical.commands, Task 11
 * for clock.webhooks. A job that exhausts its configured attempts is copied
 * onto the shared dead-letter queue (source brief section 26) so an admin has
 * one place to look, rather than only BullMQ's internal failed-job set.
 */
@Injectable()
export class ClockWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClockWorkerService.name);
  private connection!: IORedis;
  private readonly workers: Worker[] = [];

  constructor(
    @Inject(ClockQueueService) private readonly queues: ClockQueueService,
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(ClockBookingHydrationService) private readonly hydration: ClockBookingHydrationService,
    @Inject(ClockFolioHydrationService) private readonly folioHydration: ClockFolioHydrationService,
    @Inject(IntegrationConnectionsService)
    private readonly connections: IntegrationConnectionsService,
    @Inject(ClockBookingConsistencyService)
    private readonly consistency: ClockBookingConsistencyService,
    @Inject(ClockPaymentReconciliationService)
    private readonly paymentReconciliation: ClockPaymentReconciliationService,
    @Inject(ManualReviewService) private readonly manualReview: ManualReviewService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.connection = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    for (const name of CLOCK_QUEUE_NAMES) {
      const worker = new Worker(name, (job) => this.process(name, job), {
        connection: this.connection,
      });
      worker.on('failed', (job, error) => {
        if (!job) return;
        const attempts = job.opts.attempts ?? 1;
        this.logger.warn(
          `Clock queue "${name}" job ${job.id} failed (attempt ${job.attemptsMade}/${attempts}): ${error.message}`,
        );
        if (job.attemptsMade >= attempts) {
          void this.queues.deadLetter(name, job.name, job.data, error.message);
          reportOperationalFailure(error, {
            component: 'clock',
            operation: job.name,
            queue: name,
            jobId: job.id,
          });
          if (
            name === 'clock.webhooks' &&
            job.name === 'hydrate-event' &&
            isHydrateEventJobData(job.data)
          )
            // job.token is this specific attempt's fencing token (ADR-0031)
            // — the guarded write only lands if it's still the current
            // owner, so a stale exhausted attempt can never mark FAILED
            // over a newer attempt that has since taken over and possibly
            // already succeeded.
            void this.markHydrateEventFailed(job.data, job.token);
        }
      });
      this.workers.push(worker);
    }
    // BullMQ 6 schedules repeated jobs through Job Schedulers. `upsert` makes
    // startup idempotent across restarts and concurrent API instances.
    await this.queues.upsertScheduler(
      'clock.reconciliation',
      RECONCILIATION_SCHEDULER_ID,
      RECONCILIATION_SCHEDULE_JOB,
      {},
      { pattern: RECONCILIATION_CRON, tz: 'UTC' },
    );
    await this.queues.upsertScheduler(
      'clock.webhooks',
      EVENT_SWEEP_SCHEDULER_ID,
      EVENT_SWEEP_SCHEDULE_JOB,
      {},
      { every: EVENT_SWEEP_INTERVAL_MS },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.close()));
    this.connection.disconnect();
  }

  private async process(queueName: ClockQueueName, job: Job): Promise<void> {
    if (queueName === 'clock.webhooks' && job.name === 'hydrate-event') {
      await this.processHydrateEvent(job);
      return;
    }
    if (queueName === 'clock.webhooks' && job.name === EVENT_SWEEP_SCHEDULE_JOB) {
      await this.processEventRecoverySweep();
      return;
    }
    if (queueName === 'clock.reconciliation' && job.name === RECONCILIATION_SCHEDULE_JOB) {
      await this.processReconciliationSchedule();
      return;
    }
    if (queueName === 'clock.reconciliation' && job.name === RECONCILE_PROPERTY_JOB) {
      await this.processReconcileProperty(job);
      return;
    }
    if (queueName === 'clock.reconciliation' && job.name === RECONCILE_PAYMENTS_JOB) {
      await this.processReconcilePayments(job);
      return;
    }
    this.logger.debug(
      `Clock queue "${queueName}" received job "${job.name}" (${job.id}) — no processor wired yet.`,
    );
  }

  private async processHydrateEvent(job: Job): Promise<void> {
    if (!isHydrateEventJobData(job.data)) {
      throw new Error(`hydrate-event job ${job.id} has malformed data.`);
    }
    const { tenantId, propertyId, connectionId, eventId } = job.data;
    const attemptToken = job.token;
    if (!attemptToken) {
      // Should not happen inside a real Worker processor (BullMQ always
      // assigns a lock token before invoking it) — fail loudly rather than
      // proceed without the ownership mechanism this design depends on.
      throw new Error(`hydrate-event job ${job.id} has no BullMQ processing token.`);
    }

    const event = await this.database.withTenantTransaction({ tenantId, propertyId }, (tx) =>
      tx.$queryRawUnsafe<
        Array<{
          id: string;
          eventType: string;
          objectId: string | null;
          status: ProviderEventStatus;
        }>
      >(
        `SELECT id, event_type AS "eventType", object_id AS "objectId", status::text AS status
         FROM provider_events
         WHERE tenant_id = $1::uuid AND connection_id = $2::uuid AND event_id = $3`,
        tenantId,
        connectionId,
        eventId,
      ),
    );
    const row = event[0];
    if (!row) {
      this.logger.warn(`hydrate-event job ${job.id}: no provider_events row for event ${eventId}.`);
      return;
    }
    if (row.status !== 'RECEIVED' && row.status !== 'QUEUED') {
      // A duplicate delivery's recovery path, a replayed job after
      // retention, or a job that lost the ownership race can hand the
      // worker a row another attempt already finished or that's parked for
      // an operator. Never redo real work for a non-processable row.
      this.logger.debug(
        `hydrate-event job ${job.id}: event ${eventId} already ${row.status} — skipping duplicate processing.`,
      );
      return;
    }

    // Claim ownership (ADR-0031): guarded write sets this attempt's BullMQ
    // lock token as the current owner, and records this attempt's dispatch
    // generation (`job.attemptsStarted` — see clock-provider-event-status.ts
    // for why this is the correct signal and not `job.attemptsMade`) as a
    // claim-ordering guard — a delayed/obsolete claim (one whose UPDATE
    // reaches Postgres late, after a fresher replacement attempt already
    // claimed) cannot steal ownership back purely because of network
    // timing, since the guard rejects a claim with a strictly older
    // generation. attempts increments here, not in a separate step, so a
    // crash immediately after this line still shows a real attempt was
    // made. Only proceeds if the write actually lands (no other actor has
    // already moved the row to FAILED/a terminal state, or holds a claim
    // from a later generation).
    const claimed = await this.claimEvent(
      tenantId,
      propertyId,
      row.id,
      attemptToken,
      job.attemptsStarted,
    );
    if (!claimed) {
      this.logger.debug(
        `hydrate-event job ${job.id}: event ${eventId} reached a non-processable state, or a newer attempt already claimed it, concurrently — skipping.`,
      );
      return;
    }

    // Ownership from here on is fenced for real inside the hydration
    // services' own effect-applying transaction (ADR-0031: a `SELECT ...
    // FOR UPDATE` held for that transaction's lifetime, not a preceding,
    // separately-committed check) — passing eventRowId/attemptToken lets
    // hydrateBooking/hydrateFolio validate ownership and write the event's
    // terminal status atomically with the local effect they apply.
    const ownership = { eventRowId: row.id, token: attemptToken };

    if (BOOKING_EVENT_TYPES.has(row.eventType)) {
      if (!row.objectId) {
        this.logger.warn(
          `hydrate-event job ${job.id}: event type "${row.eventType}" has no object id, cannot hydrate.`,
        );
        await this.finalizeEvent(tenantId, propertyId, row.id, attemptToken, 'IGNORED');
        return;
      }
      const outcome = await this.hydration.hydrateBooking(
        tenantId,
        propertyId,
        connectionId,
        row.objectId,
        ownership,
      );
      this.logger.log(
        `hydrate-event job ${job.id}: booking ${row.objectId} -> ${outcome.outcome}.`,
      );
      switch (outcome.outcome) {
        case 'created':
        case 'updated':
        case 'missing_room_type_mapping':
        case 'unknown_status':
          // Both the local effect (or its ManualReviewItem, for a missing
          // mapping or an unrecognised Clock status) and the event's terminal status already committed
          // together inside hydrateBooking's own transaction — nothing
          // left to do here.
          return;
        case 'ownership_lost':
          // A replacement attempt took over before this one's transaction
          // committed. No effect was applied by this attempt (the
          // transaction's ownership check ran before any write), and
          // nothing to finalize — the newer attempt owns the outcome.
          this.logger.debug(
            `hydrate-event job ${job.id}: lost processing ownership before its transaction could commit — no effect applied, discarding this attempt.`,
          );
          return;
        case 'no_active_connection':
          // Plausibly transient (a disabled/reconnecting Clock connection) —
          // let BullMQ's normal attempts/backoff/dead-letter apply, same as
          // any other retryable failure, rather than silently certifying an
          // unapplied event as IGNORED or HYDRATED.
          throw new Error(
            `hydrate-event job ${job.id}: no active Clock connection for property ${propertyId} — will retry.`,
          );
      }
      return;
    }

    if (FOLIO_EVENT_TYPES.has(row.eventType)) {
      if (!row.objectId) {
        this.logger.warn(
          `hydrate-event job ${job.id}: event type "${row.eventType}" has no object id, cannot hydrate.`,
        );
        await this.finalizeEvent(tenantId, propertyId, row.id, attemptToken, 'IGNORED');
        return;
      }
      const outcome = await this.folioHydration.hydrateFolio(
        tenantId,
        propertyId,
        row.objectId,
        ownership,
      );
      this.logger.log(`hydrate-event job ${job.id}: folio ${row.objectId} -> ${outcome.outcome}.`);
      switch (outcome.outcome) {
        case 'applied':
        case 'not_a_booking_folio':
          // Effect (or lack of one) and terminal status already committed
          // together inside hydrateFolio's own transaction.
          return;
        case 'ownership_lost':
          this.logger.debug(
            `hydrate-event job ${job.id}: lost processing ownership before its transaction could commit — no effect applied, discarding this attempt.`,
          );
          return;
        case 'booking_not_found':
          // The folio-before-booking race: Clock can deliver a folio event
          // before the booking_new event that creates the local shadow
          // booking it needs. Throwing preserves evidence (dead-letter
          // reason, provider_events FAILED once exhausted) and gives the
          // booking event a real chance to land first via BullMQ's
          // backoff — a genuine, if bounded, recovery path for this
          // temporary dependency without inventing new orchestration.
          throw new Error(
            `hydrate-event job ${job.id}: folio ${row.objectId} references a Clock booking with no local shadow booking yet (folio-before-booking race) — will retry.`,
          );
        case 'no_active_connection':
          throw new Error(
            `hydrate-event job ${job.id}: no active Clock connection for property ${propertyId} — will retry.`,
          );
      }
      return;
    }

    this.logger.debug(
      `hydrate-event job ${job.id}: event type "${row.eventType}" is acknowledged but not applied yet.`,
    );
    await this.finalizeEvent(tenantId, propertyId, row.id, attemptToken, 'IGNORED');
  }

  /** Claims ownership of a provider_events row for one processing attempt
   * — see `claimEventSql` for the combined status/token/generation guard.
   * Returns whether the claim actually landed. */
  private async claimEvent(
    tenantId: string,
    propertyId: string,
    eventRowId: string,
    token: string,
    generation: number,
  ): Promise<boolean> {
    const [sql, params] = claimEventSql({
      tenantId,
      eventRowId,
      allowedFrom: NON_TERMINAL,
      token,
      generation,
    });
    const affected = await this.database.withTenantTransaction({ tenantId, propertyId }, (tx) =>
      tx.$executeRawUnsafe(sql, ...params),
    );
    return affected > 0;
  }

  /**
   * Recreates a BullMQ job for a provider_events row whose previous job's
   * lineage has disappeared (ADR-0031, fifth corrective round). Recreation
   * is inherently racy — a concurrent ingestion request can be reacting to
   * the same "missing" state at the same time, and the freshly created
   * job's own worker can claim the row before this call finishes — so the
   * ownership reset is a real compare-and-swap against a snapshot taken
   * right before `queue.add()`, never a blind write. See
   * `resetForJobRecreationSql`'s doc comment for the full race analysis.
   */
  private async recreateMissingJob(
    tenantId: string,
    propertyId: string,
    eventRowId: string,
    jobId: string,
    jobData: HydrateEventJobData,
  ): Promise<void> {
    try {
      const snapshot = await this.readProcessingSnapshot(tenantId, propertyId, eventRowId);
      if (!snapshot || (snapshot.status !== 'RECEIVED' && snapshot.status !== 'QUEUED')) {
        // Another actor already finalized, parked, or otherwise moved this
        // row past recreation eligibility between the sweep's earlier read
        // and now — nothing to recreate.
        return;
      }
      await this.queues.enqueue('clock.webhooks', 'hydrate-event', jobData, {
        ...HYDRATE_EVENT_JOB_OPTIONS,
        jobId,
      });
      const reset = await this.resetForJobRecreation(tenantId, propertyId, eventRowId, snapshot);
      if (!reset)
        this.logger.debug(
          `Recovery sweep: provider_events row ${eventRowId}'s ownership changed concurrently with job recreation — leaving the newer state in place.`,
        );
    } catch (error) {
      this.logger.error(
        `Recovery sweep failed to recreate hydrate-event job for provider_events row ${eventRowId}: ${(error as Error).message}`,
      );
    }
  }

  private async readProcessingSnapshot(
    tenantId: string,
    propertyId: string,
    eventRowId: string,
  ): Promise<ProcessingSnapshot | undefined> {
    const [sql, params] = processingSnapshotSql(tenantId, eventRowId);
    const rows = await this.database.withTenantTransaction({ tenantId, propertyId }, (tx) =>
      tx.$queryRawUnsafe<ProcessingSnapshot[]>(sql, ...params),
    );
    return rows[0];
  }

  /** Compare-and-swap reset — see `resetForJobRecreationSql`. Returns
   * whether the reset actually landed; false means ownership changed
   * concurrently (a claim, a finalize, another recreator) and this call
   * correctly did nothing. */
  private async resetForJobRecreation(
    tenantId: string,
    propertyId: string,
    eventRowId: string,
    snapshot: ProcessingSnapshot,
  ): Promise<boolean> {
    const [sql, params] = resetForJobRecreationSql({
      tenantId,
      eventRowId,
      allowedFrom: NON_TERMINAL,
      expectedToken: snapshot.processingToken,
      expectedAttempt: snapshot.processingAttempt,
    });
    const affected = await this.database.withTenantTransaction({ tenantId, propertyId }, (tx) =>
      tx.$executeRawUnsafe(sql, ...params),
    );
    return affected > 0;
  }

  /**
   * Guarded provider_events status write — see clock-provider-event-status.ts
   * for the concurrency reasoning. Returns whether the write actually
   * happened (false means another actor already moved the row past the
   * guard); callers use that to stop doing further work rather than
   * proceeding as if their write had landed.
   */
  private async transitionEventStatus(
    tenantId: string,
    propertyId: string,
    eventRowId: string,
    status: ProviderEventStatus,
    options: {
      allowedFrom: ProviderEventStatus[];
      incrementAttempts?: boolean;
      requireToken?: string;
      clearToken?: boolean;
    },
  ): Promise<boolean> {
    const [sql, params] = guardedTransitionSql({
      tenantId,
      eventRowId,
      status,
      allowedFrom: options.allowedFrom,
      incrementAttempts: options.incrementAttempts,
      requireToken: options.requireToken,
      clearToken: options.clearToken,
    });
    const affected = await this.database.withTenantTransaction({ tenantId, propertyId }, (tx) =>
      tx.$executeRawUnsafe(sql, ...params),
    );
    return affected > 0;
  }

  /** Terminal write guarded by both status (only from QUEUED — the worker
   * only ever finalizes an event it itself claimed) and ownership token
   * (only if this attempt still owns it). A stale attempt that finishes
   * after a replacement has taken over always loses this comparison and
   * cannot finalize over the newer attempt's outcome (ADR-0031). Token is
   * cleared once terminal — no further ownership concept applies. */
  private async finalizeEvent(
    tenantId: string,
    propertyId: string,
    eventRowId: string,
    attemptToken: string,
    status: 'HYDRATED' | 'IGNORED' | 'FAILED',
  ): Promise<void> {
    const finalized = await this.transitionEventStatus(tenantId, propertyId, eventRowId, status, {
      allowedFrom: ['QUEUED'],
      requireToken: attemptToken,
      clearToken: true,
    });
    if (!finalized)
      this.logger.warn(
        `Event row ${eventRowId} computed outcome ${status} but ownership was lost before it could be finalized — discarded, a newer attempt already owns this event.`,
      );
  }

  /** Called once BullMQ has exhausted every attempt for a hydrate-event job
   * (already dead-lettered by the caller) — marks the row FAILED so it shows
   * up in a provider_events status query, not only the dead-letter queue.
   * Guarded by both status (never from a terminal/parked state) and this
   * attempt's own token: a stale exhausted attempt whose 'failed' listener
   * fires after a replacement attempt has already taken over (and possibly
   * already succeeded) must not finalize over it. */
  private async markHydrateEventFailed(
    data: HydrateEventJobData,
    attemptToken?: string,
  ): Promise<void> {
    if (!attemptToken) {
      this.logger.error(
        `Cannot mark provider_events FAILED for event ${data.eventId}: the failed job carried no processing token.`,
      );
      return;
    }
    try {
      const eventRowId = await this.eventRowId(data);
      await this.transitionEventStatus(data.tenantId, data.propertyId, eventRowId, 'FAILED', {
        allowedFrom: ['QUEUED'],
        requireToken: attemptToken,
        clearToken: true,
      });
    } catch (error) {
      this.logger.error(
        `Failed to mark provider_events FAILED for event ${data.eventId}: ${(error as Error).message}`,
      );
    }
  }

  private async eventRowId(data: HydrateEventJobData): Promise<string> {
    const rows = await this.database.withTenantTransaction(
      { tenantId: data.tenantId, propertyId: data.propertyId },
      (tx) =>
        tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM provider_events WHERE tenant_id = $1::uuid AND connection_id = $2::uuid AND event_id = $3`,
          data.tenantId,
          data.connectionId,
          data.eventId,
        ),
    );
    const id = rows[0]?.id;
    if (!id)
      throw new Error(
        `no provider_events row for connection ${data.connectionId} event ${data.eventId}`,
      );
    return id;
  }

  /**
   * Recovery path for a durably-persisted webhook event that never got a
   * live queue entry (enqueue failed after the DB commit, or the process
   * crashed before the enqueue ran), whose job disappeared without the row
   * being updated, or whose job exhausted its attempts without the
   * asynchronous 'failed' listener ever recording it (e.g. the process died
   * first). Reads cross-tenant under the platform_admin SELECT-only RLS
   * carve-out (provider_events_platform_admin_read — this is a system
   * recovery job, not a request scoped to one tenant, same pattern as
   * ClockWebhookHealthService.checkWebhookFreshness); every write it issues
   * still goes through the normal per-tenant provider_events_tenant_isolation
   * policy via withTenantTransaction, so no bypass-RLS write path is added.
   *
   * Every row examined has its updated_at touched (whether or not its status
   * changes) so the `ORDER BY updated_at ASC LIMIT` selection rotates
   * through the whole stuck set across ticks instead of a batch of
   * currently-unresolvable rows (e.g. genuinely still in-flight, or a
   * completed-but-unreconciled row) permanently starving every row past the
   * batch limit.
   */
  private async processEventRecoverySweep(): Promise<void> {
    const cutoff = new Date(Date.now() - EVENT_SWEEP_GRACE_MS);
    const rows = await this.database.withPlatformAdminTransaction(
      { role: 'platform_admin' },
      (tx) =>
        tx.$queryRawUnsafe<StuckProviderEventRow[]>(
          `SELECT id, tenant_id AS "tenantId", property_id AS "propertyId",
             connection_id AS "connectionId", event_id AS "eventId"
           FROM provider_events
           WHERE status IN ('RECEIVED', 'QUEUED') AND updated_at < $1::timestamptz
           ORDER BY updated_at ASC
           LIMIT $2`,
          cutoff,
          EVENT_SWEEP_BATCH_LIMIT,
        ),
    );

    if (rows.length === 0) return;
    this.logger.warn(
      `Clock provider-event recovery sweep: examining ${rows.length} stuck event(s).`,
    );

    for (const row of rows) await this.reconcileStuckEvent(row);
  }

  private async reconcileStuckEvent(row: StuckProviderEventRow): Promise<void> {
    const jobId = clockHydrateEventJobId(row.connectionId, row.eventId);
    let state: JobReconciliationState;
    try {
      state = await this.queues.reconcileJob('clock.webhooks', jobId);
    } catch (error) {
      this.logger.error(
        `Recovery sweep failed to inspect job state for provider_events row ${row.id}: ${(error as Error).message}`,
      );
      return;
    }

    switch (state) {
      case 'missing':
        await this.recreateMissingJob(row.tenantId, row.propertyId, row.id, jobId, {
          tenantId: row.tenantId,
          propertyId: row.propertyId,
          connectionId: row.connectionId,
          eventId: row.eventId,
        });
        return;
      case 'failed':
        // Reconciles the DB even if the in-process 'failed' listener never
        // ran for this job (process died before it fired). No token check
        // here (the sweep never held one) — safe because BullMQ has
        // definitively stopped processing a job it reports 'failed' for, so
        // no legitimately active attempt's ownership can be stomped.
        await this.transitionEventStatus(row.tenantId, row.propertyId, row.id, 'FAILED', {
          allowedFrom: NON_TERMINAL,
        });
        return;
      case 'in-flight':
        await this.touchExamined(row);
        return;
      case 'completed':
        // The job ran to completion but the row is still RECEIVED/QUEUED —
        // its status write likely raced or never happened (ADR-0031: now
        // confined to legacy rows / a residual race under the fencing-token
        // design). Not safe to silently infer HYDRATED/IGNORED without
        // redoing the real classification — park it durably instead.
        await this.parkNeedsReconciliation(row);
        return;
    }
  }

  /**
   * Atomic parking (ADR-0031, third correction): the guarded status write
   * and the ManualReviewItem it exists to justify must commit together or
   * not at all, in one tenant-scoped transaction — a prior version wrote
   * them as two separate transactions, so a failure recording the review
   * item (or a crash between the two) could leave a row silently parked
   * with no actionable trail. Only the actor whose guarded UPDATE actually
   * affects the row creates the item — if another actor already parked it
   * (or moved it further) concurrently, this call's UPDATE affects 0 rows,
   * the transaction has nothing else to do, and no duplicate item is ever
   * written. A failure inserting the review item rolls back the status
   * write too, leaving the row exactly as it was for a later sweep tick to
   * retry parking from scratch.
   */
  private async parkNeedsReconciliation(row: StuckProviderEventRow): Promise<void> {
    const [sql, params] = guardedTransitionSql({
      tenantId: row.tenantId,
      eventRowId: row.id,
      status: 'NEEDS_RECONCILIATION',
      allowedFrom: NON_TERMINAL,
    });
    const parked = await this.database.withTenantTransaction(
      { tenantId: row.tenantId, propertyId: row.propertyId },
      async (tx) => {
        const affected = await tx.$executeRawUnsafe(sql, ...params);
        if (affected === 0) return false; // another actor already moved it past this guard
        await this.manualReview.recordInTransaction(tx, {
          tenantId: row.tenantId,
          propertyId: row.propertyId,
          connectionId: row.connectionId,
          category: 'UNKNOWN_RESULT',
          referenceType: 'provider_event',
          referenceId: row.eventId,
          message: `Clock event ${row.eventId}'s BullMQ job completed, but its outcome was never recorded on provider_events (row ${row.id}). Verify directly against Clock whether the referenced resource was actually applied, then either mark this row HYDRATED (if confirmed applied) or reset it to RECEIVED (if not) so the next recovery sweep reprocesses it.`,
        });
        return true;
      },
    );
    if (parked)
      this.logger.warn(
        `Recovery sweep: provider_events row ${row.id} (event ${row.eventId}) parked NEEDS_RECONCILIATION — completed BullMQ job with no terminal status recorded.`,
      );
  }

  private async touchExamined(row: StuckProviderEventRow): Promise<void> {
    const [sql, params] = touchExaminedSql(row.tenantId, row.id);
    await this.database.withTenantTransaction(
      { tenantId: row.tenantId, propertyId: row.propertyId },
      (tx) => tx.$executeRawUnsafe(sql, ...params),
    );
  }

  private async processReconciliationSchedule(): Promise<void> {
    const properties = await this.connections.activeClockPmsProperties();
    const range = reconciliationRange(new Date());
    await Promise.all(
      properties.flatMap(({ tenantId, propertyId }) => [
        this.queues.enqueue(
          'clock.reconciliation',
          RECONCILE_PROPERTY_JOB,
          { tenantId, propertyId, ...range },
          { jobId: `clock-reconciliation-${tenantId}-${propertyId}-${range.startsOn}` },
        ),
        this.queues.enqueue(
          'clock.reconciliation',
          RECONCILE_PAYMENTS_JOB,
          { tenantId, propertyId, since: range.startsOn },
          { jobId: `clock-payment-reconciliation-${tenantId}-${propertyId}-${range.startsOn}` },
        ),
      ]),
    );
    this.logger.log(
      `Scheduled ${properties.length} Clock booking consistency check(s) and payment reconciliation check(s) for ${range.startsOn} to ${range.endsOn}.`,
    );
  }

  private async processReconcileProperty(job: Job): Promise<void> {
    if (!isReconcilePropertyJobData(job.data)) {
      throw new Error(`reconcile-property job ${job.id} has malformed data.`);
    }
    const { tenantId, propertyId, startsOn, endsOn } = job.data;
    await this.consistency.check(tenantId, propertyId, { startsOn, endsOn });
  }

  private async processReconcilePayments(job: Job): Promise<void> {
    if (!isReconcilePaymentsJobData(job.data)) {
      throw new Error(`reconcile-payments job ${job.id} has malformed data.`);
    }
    const { tenantId, propertyId, since } = job.data;
    await this.paymentReconciliation.check(tenantId, propertyId, new Date(`${since}T00:00:00Z`));
  }
}

function reconciliationRange(now: Date): Pick<ReconcilePropertyJobData, 'startsOn' | 'endsOn'> {
  const endsOn = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const startsOn = new Date(endsOn);
  startsOn.setUTCDate(startsOn.getUTCDate() - 31);
  return {
    startsOn: startsOn.toISOString().slice(0, 10),
    endsOn: endsOn.toISOString().slice(0, 10),
  };
}
