import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';

import { CLOCK_QUEUE_NAMES, type ClockQueueName } from './clock-queue-names';
import { ClockQueueService } from './clock-queue.service';

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

  constructor(@Inject(ClockQueueService) private readonly queues: ClockQueueService) {}

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
      });
      this.workers.push(worker);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.close()));
    this.connection.disconnect();
  }

  private async process(queueName: ClockQueueName, job: Job): Promise<void> {
    this.logger.debug(
      `Clock queue "${queueName}" received job "${job.name}" (${job.id}) — no processor wired yet.`,
    );
  }
}
