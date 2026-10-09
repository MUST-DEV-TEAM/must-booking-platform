import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import type { MailProvider, MailSendReceipt } from '@must/domain-contracts';

import { TenantDatabaseService, type TenantTransaction } from '../tenancy/tenant-database.service';
import { MailDeliveryError } from './mail-delivery-error';
import { describeMail, type QueuedMailCommands, type QueuedMailKind } from './mail-descriptors';
import { MAIL_PROVIDER } from './mail.provider';

export const MAIL_QUEUE_NAME = 'mail.transactional';
/** How long a failed email can still be sent again from the activity screen. */
export const RESEND_WINDOW_DAYS = 7;

/**
 * Where an email's log row lives. Booking mail is scoped to a hotel and property; staff invites
 * to a hotel account (`propertyId` null); account mail (verification, welcome, password reset) has
 * neither (`tenantId` null) and is reachable only by the platform admin.
 */
export interface MailDeliveryContext {
  tenantId: string | null;
  propertyId: string | null;
}

export interface DispatchOptions {
  /**
   * Make the first attempt before returning (as direct sending did), and use the queue only to
   * retry a transient failure. Used for account mail, which callers and tests expect to go out
   * immediately.
   */
  inlineFirst?: boolean;
}

export interface MailJobData {
  messageId: string;
  context: MailDeliveryContext;
  kind: QueuedMailKind;
  command: unknown;
}

export interface MailRetryPolicy {
  attempts: number;
  backoffMs: number;
}

/**
 * Durable, observable email sending (Milestone 22, Task 4).
 *
 * Every email gets an `email_messages` row first (QUEUED) and is then sent by a
 * BullMQ worker. Transient failures (network, timeouts, 429, 5xx) retry with
 * exponential backoff; permanent failures (other 4xx) and exhausted retries mark
 * the row FAILED with the error. Duplicates are prevented by the row's unique
 * (tenant, idempotency key) and by the provider-side idempotency key that every
 * retry reuses. Callers never fail because of email: `dispatch` swallows and logs.
 */
@Injectable()
export class MailDeliveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailDeliveryService.name);
  private connection: IORedis | null = null;
  private queue: Queue<MailJobData> | null = null;
  private worker: Worker<MailJobData> | null = null;

  /** Public so tests can shorten the backoff; production uses the defaults. */
  retryPolicy: MailRetryPolicy = { attempts: 5, backoffMs: 5_000 };

  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(MAIL_PROVIDER) private readonly mail: MailProvider,
  ) {}

  onModuleInit(): void {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      this.logger.warn('REDIS_URL is not set: emails will be sent inline without retries.');
      return;
    }
    this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue<MailJobData>(MAIL_QUEUE_NAME, { connection: this.connection });
    this.worker = new Worker<MailJobData>(MAIL_QUEUE_NAME, (job) => this.process(job), {
      connection: this.connection,
      concurrency: 5,
    });
    this.worker.on('error', (error) =>
      this.logger.error(`Mail worker error: ${error.message}`, error.stack),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.connection?.disconnect();
  }

  /**
   * Records and queues one email. Never throws: a logging or queueing problem must
   * not fail the booking/payment action that triggered the email.
   */
  async dispatch<K extends QueuedMailKind>(
    kind: K,
    command: QueuedMailCommands[K],
    context: MailDeliveryContext,
    options: DispatchOptions = {},
  ): Promise<void> {
    const descriptor = describeMail(kind, command);
    try {
      const messageId = await this.recordMessage(context, descriptor);
      if (!messageId) return; // already sent / failed / delivered: never re-send on a replay
      const data: MailJobData = { messageId, context, kind, command };
      if (!this.queue) {
        await this.attempt(data, true);
        return;
      }
      let remainingAttempts = this.retryPolicy.attempts;
      let delay = 0;
      if (options.inlineFirst) {
        try {
          await this.attempt(data, false);
          return; // sent, or failed for good: nothing left to queue
        } catch {
          // Transient failure (already recorded on the row): retry through the queue.
          remainingAttempts = Math.max(1, this.retryPolicy.attempts - 1);
          delay = this.retryPolicy.backoffMs;
        }
      }
      try {
        await this.enqueue(data, descriptor.sensitive, remainingAttempts, delay);
      } catch (error) {
        this.logger.error(
          `Could not queue email ${messageId} (${descriptor.eventType}); sending inline once.`,
          error instanceof Error ? error.stack : String(error),
        );
        await this.attempt(data, true);
      }
    } catch (error) {
      this.logger.error(
        `Unable to record/queue ${descriptor.eventType} email${descriptor.bookingId ? ` for booking ${descriptor.bookingId}` : ''}; continuing core action.`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Sends a FAILED email again ("send again" in the email activity screen). The email is
   * rebuilt from its finished queue job, which is kept for RESEND_WINDOW_DAYS; secret-link
   * emails are never kept, so they cannot be re-sent this way.
   */
  async resend(
    messageId: string,
    context: MailDeliveryContext,
  ): Promise<'queued' | 'not_failed' | 'unavailable'> {
    if (!this.queue) return 'unavailable';
    const job = await this.queue.getJob(messageId);
    if (!job || !['completed', 'failed'].includes(await job.getState())) return 'unavailable';
    const data = job.data;
    if (
      data.context.tenantId !== context.tenantId ||
      data.context.propertyId !== context.propertyId ||
      describeMail(data.kind, data.command as never).sensitive
    )
      return 'unavailable';
    const claimed = await this.withContext(
      context,
      (tx) => tx.$queryRaw<{ id: string }[]>`
        UPDATE email_messages SET status = 'QUEUED', last_error = NULL, updated_at = now()
        WHERE id = ${messageId}::uuid AND tenant_id IS NOT DISTINCT FROM ${context.tenantId}::uuid
          AND status = 'FAILED'
        RETURNING id
      `,
    );
    if (!claimed.length) return 'not_failed';
    try {
      await job.remove();
      await this.enqueue(data, false, this.retryPolicy.attempts, 0);
    } catch (error) {
      this.logger.error(
        `Could not queue the resend of email ${messageId}; sending inline once.`,
        error instanceof Error ? error.stack : String(error),
      );
      await this.attempt(data, true);
    }
    return 'queued';
  }

  private async enqueue(
    data: MailJobData,
    sensitive: boolean,
    attempts: number,
    delay: number,
  ): Promise<void> {
    const keep = RESEND_WINDOW_DAYS * 24 * 60 * 60;
    await this.queue!.add(data.kind, data, {
      jobId: data.messageId,
      attempts,
      delay,
      backoff: { type: 'exponential', delay: this.retryPolicy.backoffMs },
      // Secret links (verify / reset / invite) must not linger in Redis after they are done.
      // Other jobs are kept so a failed email can be sent again from the activity screen.
      removeOnComplete: sensitive ? true : { age: keep },
      removeOnFail: { age: sensitive ? 60 * 60 : keep },
    });
  }

  /**
   * Inserts the log row, or finds the existing one for this idempotency key. Returns the
   * row id only when it is still QUEUED (a fresh row, or a crash left it un-enqueued);
   * returns null when the email already reached a final state.
   */
  private async recordMessage(
    context: MailDeliveryContext,
    descriptor: ReturnType<typeof describeMail>,
  ): Promise<string | null> {
    return this.withContext(context, async (tx) => {
      const { tenantId, propertyId } = context;
      const inserted = tenantId
        ? await tx.$queryRaw<{ id: string }[]>`
            INSERT INTO email_messages
              (tenant_id, property_id, booking_id, event_type, recipient_email, subject, idempotency_key)
            VALUES (${tenantId}::uuid, ${propertyId}::uuid, ${descriptor.bookingId}::uuid,
              ${descriptor.eventType}, ${descriptor.recipient}, ${descriptor.subject}, ${descriptor.idempotencyKey})
            ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
            RETURNING id
          `
        : await tx.$queryRaw<{ id: string }[]>`
            INSERT INTO email_messages
              (tenant_id, property_id, booking_id, event_type, recipient_email, subject, idempotency_key)
            VALUES (NULL, NULL, NULL,
              ${descriptor.eventType}, ${descriptor.recipient}, ${descriptor.subject}, ${descriptor.idempotencyKey})
            ON CONFLICT (idempotency_key) WHERE tenant_id IS NULL DO NOTHING
            RETURNING id
          `;
      if (inserted[0]) return inserted[0].id;
      const existing = await tx.$queryRaw<{ id: string; status: string }[]>`
        SELECT id, status::text AS status FROM email_messages
        WHERE tenant_id IS NOT DISTINCT FROM ${tenantId}::uuid AND idempotency_key = ${descriptor.idempotencyKey}
      `;
      return existing[0]?.status === 'QUEUED' ? existing[0].id : null;
    });
  }

  /** Runs in the right database scope for this email: a hotel account, or none (account mail). */
  private withContext<T>(
    context: MailDeliveryContext,
    operation: (transaction: TenantTransaction) => Promise<T>,
  ): Promise<T> {
    return context.tenantId
      ? this.database.withTenantTransaction(
          { tenantId: context.tenantId, propertyId: context.propertyId ?? undefined },
          operation,
        )
      : this.database.withPlatformMailTransaction(operation);
  }

  private async process(job: Job<MailJobData>): Promise<void> {
    const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    await this.attempt(job.data, finalAttempt);
  }

  /**
   * One delivery attempt. Throws only when BullMQ should retry (transient failure on a
   * non-final attempt); otherwise records the outcome and returns.
   */
  private async attempt(data: MailJobData, finalAttempt: boolean): Promise<void> {
    const { messageId, context } = data;
    const claimed = await this.withContext(
      context,
      (tx) =>
        tx.$queryRaw<{ id: string }[]>`
        UPDATE email_messages SET attempt_count = attempt_count + 1, updated_at = now()
        WHERE id = ${messageId}::uuid AND tenant_id IS NOT DISTINCT FROM ${context.tenantId}::uuid AND status = 'QUEUED'
        RETURNING id
      `,
    );
    if (claimed.length === 0) return; // already sent or failed: a retry/replay must not re-send

    let receipt: MailSendReceipt | void;
    try {
      receipt = await this.invoke(data);
    } catch (error) {
      const retryable = error instanceof MailDeliveryError ? error.retryable : true;
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
      if (retryable && !finalAttempt) {
        await this.updateMessage(
          data,
          `last_error = ${message}`,
          async (tx) => tx.$executeRaw`
          UPDATE email_messages SET last_error = ${message}, updated_at = now()
          WHERE id = ${messageId}::uuid AND tenant_id IS NOT DISTINCT FROM ${context.tenantId}::uuid AND status = 'QUEUED'
        `,
        );
        throw error instanceof Error ? error : new Error(message); // BullMQ schedules the retry
      }
      this.logger.error(
        `Email ${messageId} (${data.kind}) failed${retryable ? ' after all retries' : ' permanently'}: ${message}`,
      );
      await this.updateMessage(
        data,
        'FAILED',
        async (tx) => tx.$executeRaw`
        UPDATE email_messages SET status = 'FAILED', last_error = ${message}, updated_at = now()
        WHERE id = ${messageId}::uuid AND tenant_id IS NOT DISTINCT FROM ${context.tenantId}::uuid AND status = 'QUEUED'
      `,
      );
      return;
    }

    const providerMessageId = (receipt && receipt.providerMessageId) || null;
    await this.updateMessage(
      data,
      'SENT',
      async (tx) => tx.$executeRaw`
      UPDATE email_messages
      SET status = 'SENT', provider = 'resend', provider_message_id = ${providerMessageId},
          sent_at = now(), last_error = NULL, updated_at = now()
      WHERE id = ${messageId}::uuid AND tenant_id IS NOT DISTINCT FROM ${context.tenantId}::uuid AND status = 'QUEUED'
    `,
    );
  }

  private async updateMessage(
    data: MailJobData,
    what: string,
    write: (tx: TenantTransaction) => Promise<unknown>,
  ): Promise<void> {
    try {
      await this.withContext(data.context, write);
    } catch (error) {
      // The email itself is already sent (or already failed); a bookkeeping error must not
      // trigger a duplicate send through a BullMQ retry.
      this.logger.error(
        `Could not record "${what}" for email ${data.messageId}.`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private invoke(data: MailJobData): Promise<MailSendReceipt | void> {
    const command = data.command as never;
    switch (data.kind) {
      case 'paymentConfirmation':
        return this.mail.sendPaymentConfirmationEmail(command);
      case 'newBookingStaff':
        return this.mail.sendNewBookingStaffNotification(command);
      case 'refundConfirmation':
        return this.mail.sendRefundConfirmationEmail(command);
      case 'bookingCancelled':
        return this.mail.sendBookingCancelledEmail(command);
      case 'bookingCancelledStaff':
        return this.mail.sendBookingCancelledStaffNotification(command);
      case 'verification':
        return this.mail.sendVerificationEmail(command);
      case 'welcome':
        return this.mail.sendWelcomeEmail(command);
      case 'passwordReset':
        return this.mail.sendPasswordResetEmail(command);
      case 'staffInvitation':
        return this.mail.sendStaffInvitationEmail(command);
      case 'rendered':
        return this.mail.sendRenderedEmail(command);
      default:
        return Promise.reject(
          new MailDeliveryError(`Unknown mail kind: ${String(data.kind)}`, false),
        );
    }
  }
}
