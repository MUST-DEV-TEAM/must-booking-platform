import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';

import { TenantDatabaseService } from '../../tenancy/tenant-database.service';
import { IntegrationConnectionsService } from '../integration-connections.service';
import { CLOCK_QUEUE_NAMES, type ClockQueueName } from './clock-queue-names';
import { ClockBookingConsistencyService } from './clock-booking-consistency.service';
import { ClockBookingHydrationService } from './clock-booking-hydration.service';
import { ClockFolioHydrationService } from './clock-folio-hydration.service';
import { ClockPaymentReconciliationService } from './clock-payment-reconciliation.service';
import { ClockQueueService } from './clock-queue.service';
import { reportOperationalFailure } from '../../observability/error-tracking';

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
        if (job.attemptsMade >= attempts)
          void this.queues.deadLetter(name, job.name, job.data, error.message);
        if (job.attemptsMade >= attempts)
          reportOperationalFailure(error, {
            component: 'clock',
            operation: job.name,
            queue: name,
            jobId: job.id,
          });
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

    const event = await this.database.withTenantTransaction({ tenantId, propertyId }, (tx) =>
      tx.$queryRawUnsafe<Array<{ eventType: string; objectId: string | null }>>(
        `SELECT event_type AS "eventType", object_id AS "objectId" FROM provider_events
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

    if (BOOKING_EVENT_TYPES.has(row.eventType)) {
      if (!row.objectId) {
        this.logger.warn(
          `hydrate-event job ${job.id}: event type "${row.eventType}" has no object id, cannot hydrate.`,
        );
        return;
      }
      const outcome = await this.hydration.hydrateBooking(
        tenantId,
        propertyId,
        connectionId,
        row.objectId,
      );
      this.logger.log(
        `hydrate-event job ${job.id}: booking ${row.objectId} -> ${outcome.outcome}.`,
      );
      return;
    }

    if (FOLIO_EVENT_TYPES.has(row.eventType)) {
      if (!row.objectId) {
        this.logger.warn(
          `hydrate-event job ${job.id}: event type "${row.eventType}" has no object id, cannot hydrate.`,
        );
        return;
      }
      const outcome = await this.folioHydration.hydrateFolio(tenantId, propertyId, row.objectId);
      this.logger.log(`hydrate-event job ${job.id}: folio ${row.objectId} -> ${outcome.outcome}.`);
      return;
    }

    this.logger.debug(
      `hydrate-event job ${job.id}: event type "${row.eventType}" is acknowledged but not applied yet.`,
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
