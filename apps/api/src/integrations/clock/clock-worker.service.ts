import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';

import { TenantDatabaseService } from '../../tenancy/tenant-database.service';
import { CLOCK_QUEUE_NAMES, type ClockQueueName } from './clock-queue-names';
import { ClockBookingHydrationService } from './clock-booking-hydration.service';
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

interface HydrateEventJobData {
  tenantId: string;
  propertyId: string;
  connectionId: string;
  eventId: string;
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
  ) {}

  onModuleInit(): void {
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

    if (!BOOKING_EVENT_TYPES.has(row.eventType)) {
      this.logger.debug(
        `hydrate-event job ${job.id}: event type "${row.eventType}" is acknowledged but not applied yet.`,
      );
      return;
    }
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
    this.logger.log(`hydrate-event job ${job.id}: booking ${row.objectId} -> ${outcome.outcome}.`);
  }
}
