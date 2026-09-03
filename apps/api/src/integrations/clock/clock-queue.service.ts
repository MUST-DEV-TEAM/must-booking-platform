import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, type JobsOptions, type RepeatOptions } from 'bullmq';
import IORedis from 'ioredis';

import {
  CLOCK_DEAD_LETTER_QUEUE_NAME,
  CLOCK_QUEUE_NAMES,
  CLOCK_QUEUE_PRIORITY,
  type ClockQueueName,
} from './clock-queue-names';

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: { age: 24 * 60 * 60 },
  removeOnFail: false, // kept so the dead-letter path (ClockWorkerService) can read attemptsMade/failedReason.
};

export interface DeadLetterJobData {
  originalQueue: string;
  originalJobName: string;
  data: unknown;
  reason: string;
}

/**
 * Owns the BullMQ Queue instances themselves (Task 9 — enqueue-only). Real
 * job processing is wired by ClockWorkerService and lands with the tasks
 * that actually need it (10: clock.critical.commands, 11: clock.webhooks).
 */
@Injectable()
export class ClockQueueService implements OnModuleInit, OnModuleDestroy {
  private connection!: IORedis;
  private readonly queues = new Map<string, Queue>();

  onModuleInit(): void {
    this.connection = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    for (const name of CLOCK_QUEUE_NAMES)
      this.queues.set(name, new Queue(name, { connection: this.connection }));
    this.queues.set(
      CLOCK_DEAD_LETTER_QUEUE_NAME,
      new Queue(CLOCK_DEAD_LETTER_QUEUE_NAME, { connection: this.connection }),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
    this.connection.disconnect();
  }

  async enqueue<T = unknown>(
    queueName: ClockQueueName,
    jobName: string,
    data: T,
    options: JobsOptions = {},
  ): Promise<void> {
    const queue = this.requireQueue(queueName);
    await queue.add(jobName, data, {
      ...DEFAULT_JOB_OPTIONS,
      priority: CLOCK_QUEUE_PRIORITY[queueName],
      ...options,
    });
  }

  async upsertScheduler<T = unknown>(
    queueName: ClockQueueName,
    schedulerId: string,
    jobName: string,
    data: T,
    repeat: Omit<RepeatOptions, 'key'>,
    options: JobsOptions = {},
  ): Promise<void> {
    const queue = this.requireQueue(queueName);
    await queue.upsertJobScheduler(schedulerId, repeat, {
      name: jobName,
      data,
      opts: {
        ...DEFAULT_JOB_OPTIONS,
        priority: CLOCK_QUEUE_PRIORITY[queueName],
        ...options,
      },
    });
  }

  async deadLetter(
    originalQueue: string,
    originalJobName: string,
    data: unknown,
    reason: string,
  ): Promise<void> {
    const dlq = this.requireQueue(CLOCK_DEAD_LETTER_QUEUE_NAME);
    const payload: DeadLetterJobData = { originalQueue, originalJobName, data, reason };
    await dlq.add(originalJobName, payload);
  }

  private requireQueue(name: string): Queue {
    const queue = this.queues.get(name);
    if (!queue) throw new Error(`Unknown Clock queue: ${name}`);
    return queue;
  }
}
