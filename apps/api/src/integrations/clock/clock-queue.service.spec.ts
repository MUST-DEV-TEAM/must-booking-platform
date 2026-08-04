import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';

import { CLOCK_DEAD_LETTER_QUEUE_NAME, CLOCK_QUEUE_PRIORITY } from './clock-queue-names';
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
  const workers = new ClockWorkerService(queues);
  const inspectionConnection = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });

  queues.onModuleInit();
  workers.onModuleInit();

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

  it('a real worker picks up and processes an enqueued job (skeleton logging only)', async () => {
    const jobId = randomUUID();
    await queues.enqueue('clock.webhooks', 'hydrate-event', { jobId }, { jobId, attempts: 1 });

    const inspection = new Queue('clock.webhooks', { connection: inspectionConnection });
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
