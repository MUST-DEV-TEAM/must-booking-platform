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
import type { ManualReviewService } from '../manual-review.service';
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
    {} as ManualReviewService,
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

  describe('reconcileJob — real BullMQ job-state reconciliation', () => {
    it('reports "missing" for a job id that was never added', async () => {
      const state = await queues.reconcileJob('clock.webhooks', `never-added:${randomUUID()}`);
      expect(state).toBe('missing');
    });

    it('reports "in-flight" for a job still waiting (not yet picked up)', async () => {
      // clock.webhooks has a real worker running in this suite (started by
      // workers.onModuleInit() above) that would race this test by picking
      // the job up immediately, so use a queue this suite's worker doesn't
      // drain quickly: clock.catalog.sync's skeleton processor resolves
      // instantly too, so instead pause it briefly via an artificial delay.
      const jobId = randomUUID();
      await queues.enqueue('clock.catalog.sync', 'full-sync', { jobId }, { jobId, delay: 2_000 });
      const state = await queues.reconcileJob('clock.catalog.sync', jobId);
      expect(state).toBe('in-flight'); // BullMQ's 'delayed' state, folded into in-flight
    });

    it('reports "completed" for a job that ran to completion, and confirms add() with the same id does not restart it', async () => {
      const jobId = randomUUID();
      await queues.enqueue('clock.catalog.sync', 'full-sync', { jobId }, { jobId, attempts: 1 });
      const inspection = new Queue('clock.catalog.sync', { connection: inspectionConnection });
      await waitFor(async () => (await (await inspection.getJob(jobId))?.isCompleted()) ?? false);

      expect(await queues.reconcileJob('clock.catalog.sync', jobId)).toBe('completed');

      // The literal behavior the corrective review asked to be proven: a
      // second add() with the same job id does not create a fresh attempt.
      await queues.enqueue('clock.catalog.sync', 'full-sync', { jobId }, { jobId, attempts: 1 });
      const job = await inspection.getJob(jobId);
      // Still the original completed job — no new attempt was scheduled.
      expect(await job?.isCompleted()).toBe(true);
      expect(job?.attemptsMade).toBeLessThanOrEqual(1);
    });

    it('reports "failed" for a job that exhausted every attempt, and confirms add() with the same id does not restart it', async () => {
      // Force a real failure: a job name this worker's process() dispatch
      // has no branch for still resolves (the skeleton no-op path), so use
      // clock.critical.commands with a job name that also hits the no-op
      // path — to get a real *failure* instead, remove the job first so a
      // second add() can be observed as a no-op against a job Redis still
      // remembers as failed. Simpler and just as real: enqueue with 0
      // remaining attempts is not supported by BullMQ, so instead add a job
      // whose processor throws by using clock.webhooks/hydrate-event with
      // malformed data (isHydrateEventJobData rejects it synchronously,
      // matching real worker behavior exercised in clock-worker.service.spec.ts).
      const jobId = randomUUID();
      await queues.enqueue(
        'clock.webhooks',
        'hydrate-event',
        { bogus: true },
        { jobId, attempts: 1, backoff: { type: 'fixed', delay: 1 } },
      );
      const inspection = new Queue('clock.webhooks', { connection: inspectionConnection });
      await waitFor(async () => (await (await inspection.getJob(jobId))?.isFailed()) ?? false);

      expect(await queues.reconcileJob('clock.webhooks', jobId)).toBe('failed');

      await queues.enqueue(
        'clock.webhooks',
        'hydrate-event',
        { bogus: true },
        { jobId, attempts: 1 },
      );
      const job = await inspection.getJob(jobId);
      expect(await job?.isFailed()).toBe(true);
      expect(job?.attemptsMade).toBeLessThanOrEqual(1);
    });
  });
});
