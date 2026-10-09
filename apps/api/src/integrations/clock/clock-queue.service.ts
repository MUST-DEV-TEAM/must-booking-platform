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

/**
 * hydrate-event retries must outlast the circuit breaker's 30s cooldown. With
 * the default 3 attempts (2s, 4s), an open breaker during a burst failed every
 * queued event within seconds: 843 Empire folio events went FAILED on
 * 2026-10-02. Ten attempts keep the quick first retries and then wait about
 * 17 minutes in total (2s doubling to 512s).
 */
export const HYDRATE_EVENT_JOB_OPTIONS: JobsOptions = {
  attempts: 10,
  backoff: { type: 'exponential', delay: 2_000 },
};

export interface DeadLetterJobData {
  originalQueue: string;
  originalJobName: string;
  data: unknown;
  reason: string;
}

/**
 * Ground truth about a specific job id, reconciled against BullMQ's actual
 * job states rather than assumed from `Queue.add()`'s return value alone —
 * `add()` with a jobId that already exists in Redis (waiting/active/delayed/
 * completed/failed, since this queue's default options never auto-remove a
 * failed job and only age out a completed one) does not create a new
 * attempt and does not restart a failed/completed one. Callers must branch
 * on this before deciding whether to (re)enqueue, retry, or leave alone.
 */
export type JobReconciliationState = 'missing' | 'in-flight' | 'completed' | 'failed';

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

  /**
   * Reconciles a deterministic job id against BullMQ's actual state instead
   * of assuming `add()` succeeded or would restart anything. `missing` means
   * no job exists in Redis at all (never created, or aged out of retention)
   * — the only state where creating a fresh job is meaningful. `completed`/
   * `failed` mean a real attempt already ran to a terminal BullMQ outcome;
   * the caller must reconcile provider_events against that fact rather than
   * silently re-adding (a no-op) or blindly trusting a stale DB status.
   */
  async reconcileJob(queueName: ClockQueueName, jobId: string): Promise<JobReconciliationState> {
    const queue = this.requireQueue(queueName);
    const job = await queue.getJob(jobId);
    if (!job) return 'missing';
    const state = await job.getState();
    if (state === 'completed') return 'completed';
    if (state === 'failed') return 'failed';
    // waiting, active, delayed, waiting-children, prioritized, unknown —
    // all mean "something is already in flight for this job id," so no
    // action should duplicate it.
    return 'in-flight';
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
