import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { TenantDatabaseService } from '../../tenancy/tenant-database.service';
import { CLOCK_DEAD_LETTER_QUEUE_NAME, CLOCK_QUEUE_PRIORITY } from './clock-queue-names';
import type { ClockBookingHydrationService } from './clock-booking-hydration.service';
import type { ClockFolioHydrationService } from './clock-folio-hydration.service';
import type { ClockBookingConsistencyService } from './clock-booking-consistency.service';
import type { ClockPaymentReconciliationService } from './clock-payment-reconciliation.service';
import { ClockQueueService } from './clock-queue.service';
import { ClockWorkerService } from './clock-worker.service';

process.env.REDIS_URL ??= 'redis://localhost:6379';

async function waitFor(check: () => Promise<boolean> | boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for condition.');
}

describe('ClockQueueService + ClockWorkerService (real Redis)', () => {
  const queues = new ClockQueueService();
  // Neither generic worker-mechanics test below exercises hydrate-event
  // (moved to clock-worker.service.spec.ts), so these never get called.
  const workers = new ClockWorkerService(
    queues,
    {} as TenantDatabaseService,
    {} as ClockBookingHydrationService,
    {} as ClockFolioHydrationService,
    { activeClockPmsProperties: async () => [] } as never,
    {} as ClockBookingConsistencyService,
    {} as ClockPaymentReconciliationService,
  );
  const inspectionConnection = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });

  beforeAll(async () => {
    queues.onModuleInit();
    await workers.onModuleInit();
  });

  afterAll(async () => {
    await workers.onModuleDestroy();
    await queues.onModuleDestroy();
    inspectionConnection.disconnect();
  });

  it('enqueues a job on the requested named queue with that queue’s documented priority', async () => {
    const jobId = randomUUID();
    await queues.enqueue('clock.critical.commands', 'confirm-booking', { jobId }, { jobId });

    const inspection = new Queue('clock.critical.commands', { connection: inspectionConnection });
    const job = await inspection.getJob(jobId);
    expect(job?.opts.priority).toBe(CLOCK_QUEUE_PRIORITY['clock.critical.commands']);
  });

  it('registers the daily reconciliation scheduler in real Redis', async () => {
    const inspection = new Queue('clock.reconciliation', { connection: inspectionConnection });
    const scheduler = await inspection.getJobScheduler('daily-clock-booking-reconciliation');
    // BullMQ's real JobSchedulerJson shape (confirmed against the installed
    // bullmq@6 typings, not assumed): the scheduler's own identifier comes
    // back as `key`, not `id` — `id` is a separate, unrelated optional field
    // (a per-job id template) that upsertJobScheduler was never given one of.
    expect(scheduler).toMatchObject({
      key: 'daily-clock-booking-reconciliation',
      name: 'schedule-reconciliation',
      pattern: '0 3 * * *',
      tz: 'UTC',
    });
  });

  it('a real worker picks up and processes an enqueued job (skeleton logging only)', async () => {
    // clock.webhooks/hydrate-event now has real processing logic (Task
    // 16/17, 2026-09-03) with its own coverage in clock-worker.service.spec.ts
    // — this test only needs a queue/job pair that's still skeleton-only, to
    // keep testing generic worker mechanics (pickup, completion) in isolation.
    const jobId = randomUUID();
    await queues.enqueue('clock.catalog.sync', 'full-sync', { jobId }, { jobId, attempts: 1 });

    const inspection = new Queue('clock.catalog.sync', { connection: inspectionConnection });
    await waitFor(async () => (await (await inspection.getJob(jobId))?.isCompleted()) ?? false);
  });

  it('moves a job to the dead-letter queue once it exhausts its attempts', async () => {
    // ClockWorkerService's skeleton processor always succeeds, so exercise
    // the dead-letter path directly against ClockQueueService.deadLetter
    // rather than forcing a real multi-attempt failure through the worker.
    await queues.deadLetter('clock.reconciliation', 'reconcile-stay', { some: 'payload' }, 'boom');

    const dlq = new Queue(CLOCK_DEAD_LETTER_QUEUE_NAME, { connection: inspectionConnection });
    await waitFor(async () => (await dlq.getJobCounts()).waiting >= 1);
  });
});
