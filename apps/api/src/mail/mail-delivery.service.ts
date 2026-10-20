import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import type { MailProvider, MailSendReceipt } from '@must/domain-contracts';

import { TenantDatabaseService, type TenantTransaction } from '../tenancy/tenant-database.service';
import { isReservedEmail, propertyEmailHourlyCap } from './email-safety';
import { withMailAttempt } from './mail-attempt-context';
import { MailDeliveryError } from './mail-delivery-error';
import { describeMail, type QueuedMailCommands, type QueuedMailKind } from './mail-descriptors';
import { MAIL_PROVIDER } from './mail.provider';
import { SenderVerificationStore } from './sender-verification-store';
import { TransportAttemptBusyError } from './email-transport-journal';
import { EmailTransportFailures } from './email-transport-failures';

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
  /** A controlled test already persisted its approved identity with the send intention. */
  preserveIdentity?: boolean;
  /**
   * Make the first attempt before returning (as direct sending did), and use the queue only to
   * retry a transient failure. Used for account mail, which callers and tests expect to go out
   * immediately.
   */
  inlineFirst?: boolean;
}

export interface MailJobData {
  messageId: string;
  idempotencyKeyOverride?: string;
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
  /** Tests use an isolated queue; production retains the established queue name. */
  queueName = MAIL_QUEUE_NAME;
  retryPolicy: MailRetryPolicy = { attempts: 5, backoffMs: 5_000 };

  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(MAIL_PROVIDER) private readonly mail: MailProvider,
    @Optional()
    @Inject(SenderVerificationStore)
    private readonly senderProofs?: SenderVerificationStore,
    @Optional()
    @Inject(EmailTransportFailures)
    private readonly senderFailures?: EmailTransportFailures,
  ) {}

  onModuleInit(): void {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      this.logger.warn('REDIS_URL is not set: emails will be sent inline without retries.');
      return;
    }
    this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue<MailJobData>(this.queueName, { connection: this.connection });
    this.worker = new Worker<MailJobData>(this.queueName, (job) => this.process(job), {
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
    try {
      if (!options.preserveIdentity && context.tenantId && context.propertyId) {
        const overrides = await this.database.withTenantTransaction(
          { tenantId: context.tenantId, propertyId: context.propertyId },
          (tx) => tx.$queryRaw<{ fromName: string | null; replyTo: string | null }[]>`
        SELECT email_sender_name AS "fromName",email_reply_to AS "replyTo" FROM properties WHERE tenant_id=${context.tenantId}::uuid AND id=${context.propertyId}::uuid
      `,
        );
        const override = overrides[0];
        if (override?.fromName || override?.replyTo) {
          command = {
            ...command,
            ...(override.fromName ? { fromName: override.fromName } : {}),
            ...(override.replyTo ? { replyTo: override.replyTo } : {}),
            ...('brand' in command
              ? {
                  brand: {
                    ...command.brand,
                    ...(override.fromName ? { senderName: override.fromName } : {}),
                    ...(override.replyTo ? { replyTo: override.replyTo } : {}),
                  },
                }
              : {}),
          };
        }
      }
      const descriptor = describeMail(kind, command);
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
        `Unable to record/queue ${kind} email; continuing core action.`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async retainedCommand(
    messageId: string,
    context: MailDeliveryContext,
  ): Promise<MailJobData | null> {
    if (!(await this.transportRetryAllowed(messageId, context))) return null;
    const job = await this.queue?.getJob(messageId);
    if (
      !job ||
      !['completed', 'failed'].includes(await job.getState()) ||
      job.data.context.tenantId !== context.tenantId ||
      job.data.context.propertyId !== context.propertyId ||
      describeMail(job.data.kind, job.data.command as never).sensitive
    )
      return null;
    return job.data;
  }

  /** A retry intent has committed first. Stable queue IDs make a lost enqueue response safe to repeat. */
  async enqueueApproved(data: MailJobData, version: number, fresh = false): Promise<void> {
    if (!this.queue) throw new Error('The email retry queue is unavailable.');
    await this.queue.add(data.kind, data, {
      jobId: fresh ? data.messageId : `${data.messageId}-retry-${version}`,
      attempts: this.retryPolicy.attempts,
      backoff: { type: 'exponential', delay: this.retryPolicy.backoffMs },
      removeOnComplete: { age: RESEND_WINDOW_DAYS * 86400 },
      removeOnFail: { age: RESEND_WINDOW_DAYS * 86400 },
    });
  }

  /** True only when the original non-sensitive approved command is still retained. */
  async canResend(messageId: string, context: MailDeliveryContext): Promise<boolean> {
    if (!(await this.transportRetryAllowed(messageId, context))) return false;
    const job = await this.queue?.getJob(messageId);
    return Boolean(
      job &&
      ['completed', 'failed'].includes(await job.getState()) &&
      job.data.context.tenantId === context.tenantId &&
      job.data.context.propertyId === context.propertyId &&
      !describeMail(job.data.kind, job.data.command as never).sensitive,
    );
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
    if (!(await this.transportRetryAllowed(messageId, context))) return 'unavailable';
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
        UPDATE email_messages SET status = 'QUEUED', last_error = NULL, workspace_version=workspace_version+1, updated_at = now()
        WHERE id = ${messageId}::uuid AND tenant_id IS NOT DISTINCT FROM ${context.tenantId}::uuid
          AND property_id IS NOT DISTINCT FROM ${context.propertyId}::uuid AND status = 'FAILED'
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
        WHERE tenant_id IS NOT DISTINCT FROM ${tenantId}::uuid AND property_id IS NOT DISTINCT FROM ${propertyId}::uuid AND idempotency_key = ${descriptor.idempotencyKey}
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
    const descriptor = describeMail(data.kind, data.command as never);
    if (process.env.NODE_ENV === 'production' && isReservedEmail(descriptor.recipient)) {
      await this.withContext(
        context,
        (tx) =>
          tx.$executeRaw`UPDATE email_messages SET status='SUPPRESSED',last_error='Suppressed: reserved test address in production',workspace_version=workspace_version+1,updated_at=now() WHERE id=${messageId}::uuid AND tenant_id IS NOT DISTINCT FROM ${context.tenantId}::uuid AND property_id IS NOT DISTINCT FROM ${context.propertyId}::uuid AND status='QUEUED'`,
      );
      return;
    }
    if (descriptor.eventType === 'owner.email_transport_failure') {
      const eligible =
        context.tenantId &&
        context.propertyId &&
        data.kind === 'rendered' &&
        (await this.senderFailures?.allowed(
          { tenantId: context.tenantId, propertyId: context.propertyId },
          data.command as QueuedMailCommands['rendered'],
        ));
      if (!eligible) {
        await this.withContext(
          context,
          (tx) => tx.$executeRaw`
            UPDATE email_messages SET status='SUPPRESSED',last_error='Owner alert proof expired or recipient no longer qualifies.',workspace_version=workspace_version+1,updated_at=clock_timestamp()
            WHERE tenant_id IS NOT DISTINCT FROM ${context.tenantId}::uuid AND property_id IS NOT DISTINCT FROM ${context.propertyId}::uuid AND id=${messageId}::uuid AND status='QUEUED'
          `,
        );
        return;
      }
    }
    if (context.tenantId && context.propertyId) {
      const blocked = await this.database.withTenantTransaction(
        { tenantId: context.tenantId, propertyId: context.propertyId },
        async (tx) => {
          const descriptor = describeMail(data.kind, data.command as never);
          const rows = await tx.$queryRaw<
            { reason: string }[]
          >`SELECT reason FROM email_suppressions WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND recipient=${descriptor.recipient.toLowerCase()} AND active`;
          if (!rows[0]) return false;
          await tx.$executeRaw`UPDATE email_messages SET status='SUPPRESSED',last_error=${'Suppressed: ' + rows[0].reason},workspace_version=workspace_version+1,updated_at=now() WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND id=${messageId}::uuid AND status='QUEUED'`;
          return true;
        },
      );
      if (blocked) return;
    }
    const claimed = await this.withContext(
      context,
      (tx) =>
        tx.$queryRaw<{ id: string }[]>`
        UPDATE email_messages SET attempt_count = attempt_count + 1, updated_at = now()
        WHERE id = ${messageId}::uuid AND tenant_id IS NOT DISTINCT FROM ${context.tenantId}::uuid AND property_id IS NOT DISTINCT FROM ${context.propertyId}::uuid AND status = 'QUEUED'
        RETURNING id
      `,
    );
    if (claimed.length === 0) return; // already sent or failed: a retry/replay must not re-send

    let receipt: MailSendReceipt | void;
    try {
      if (context.tenantId && context.propertyId) {
        const allowed = await this.database.withTenantTransaction(
          { tenantId: context.tenantId, propertyId: context.propertyId },
          async (tx) => {
            await tx.$queryRaw`SELECT id FROM properties WHERE tenant_id=${context.tenantId}::uuid AND id=${context.propertyId}::uuid FOR UPDATE`;
            await tx.$executeRaw`DELETE FROM email_delivery_slots WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND created_at<now()-interval '25 hours'`;
            const slots = await tx.$queryRaw<
              { own: boolean; count: number }[]
            >`SELECT EXISTS(SELECT 1 FROM email_delivery_slots WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND message_id=${messageId}::uuid) AS own,(SELECT count(*)::int FROM email_delivery_slots WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND created_at>now()-interval '1 hour') AS count`;
            if (slots[0]!.own) return true;
            if (slots[0]!.count >= propertyEmailHourlyCap()) return false;
            await tx.$executeRaw`INSERT INTO email_delivery_slots(tenant_id,property_id,message_id) VALUES(${context.tenantId}::uuid,${context.propertyId}::uuid,${messageId}::uuid) ON CONFLICT DO NOTHING`;
            return true;
          },
        );
        if (!allowed)
          throw new MailDeliveryError(
            'Property hourly email cap reached. Retry after the rolling hour clears.',
            true,
            429,
          );
      }
      receipt = await withMailAttempt(
        {
          ...context,
          messageId,
          sensitive: describeMail(data.kind, data.command as never).sensitive,
          idempotencyKeyOverride: data.idempotencyKeyOverride,
          finalAttempt,
          guestTransactional:
            descriptor.eventType.startsWith('guest.') ||
            ['booking.confirmed', 'booking.cancelled', 'booking.refund_processed'].includes(
              descriptor.eventType,
            ),
          forceDefault:
            descriptor.sensitive || descriptor.eventType === 'owner.email_transport_failure',
        },
        () => this.invoke(data),
      );
    } catch (error) {
      if (error instanceof TransportAttemptBusyError) throw error;
      const retryable = error instanceof MailDeliveryError ? error.retryable : true;
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
      if (retryable && !finalAttempt) {
        await this.updateMessage(
          data,
          `last_error = ${message}`,
          async (tx) => tx.$executeRaw`
          UPDATE email_messages SET last_error = ${message}, updated_at = now()
          WHERE id = ${messageId}::uuid AND tenant_id IS NOT DISTINCT FROM ${context.tenantId}::uuid AND property_id IS NOT DISTINCT FROM ${context.propertyId}::uuid AND status = 'QUEUED'
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
        WHERE id = ${messageId}::uuid AND tenant_id IS NOT DISTINCT FROM ${context.tenantId}::uuid AND property_id IS NOT DISTINCT FROM ${context.propertyId}::uuid AND status = 'QUEUED'
      `,
      );
      await this.alertSenderFailure(data);
      return;
    }

    const providerMessageId = (receipt && receipt.providerMessageId) || null;
    const provider = (receipt && receipt.provider) || 'resend';
    await this.updateMessage(
      data,
      'SENT',
      async (tx) => tx.$executeRaw`
      UPDATE email_messages
      SET status = 'SENT', provider = ${provider}, provider_message_id = ${providerMessageId},
          sent_at = now(), last_error = NULL, updated_at = now()
      WHERE id = ${messageId}::uuid AND tenant_id IS NOT DISTINCT FROM ${context.tenantId}::uuid AND property_id IS NOT DISTINCT FROM ${context.propertyId}::uuid
        AND (status='QUEUED' OR (status='FAILED' AND EXISTS(SELECT 1 FROM email_transport_attempts a WHERE a.tenant_id=${context.tenantId}::uuid AND a.property_id=${context.propertyId}::uuid AND a.message_id=${messageId}::uuid AND a.state='ACCEPTED' AND a.provider=${provider} AND a.provider_message_id=${providerMessageId})))
    `,
    );
    if (receipt && receipt.usedFallback) await this.alertSenderFailure(data);
  }

  private async alertSenderFailure(data: MailJobData) {
    if (
      !this.senderFailures ||
      !data.context.tenantId ||
      !data.context.propertyId ||
      describeMail(data.kind, data.command as never).sensitive ||
      describeMail(data.kind, data.command as never).eventType === 'owner.email_transport_failure'
    )
      return;
    try {
      const scope = { tenantId: data.context.tenantId, propertyId: data.context.propertyId };
      await this.senderFailures.record({ ...scope, messageId: data.messageId });
      await this.recoverSenderFailures(scope);
    } catch {
      this.logger.warn('Owner email-sender alert is pending recovery.');
    }
  }

  async recoverSenderFailures(scope: { tenantId: string; propertyId: string }): Promise<void> {
    if (!this.senderFailures) return;
    await this.senderFailures.cleanup(scope);
    await this.senderFailures.discover(scope);
    for (const alert of await this.senderFailures.pending(scope)) {
      if (alert.command.eventType !== 'owner.email_transport_failure') continue;
      await this.dispatch('rendered', alert.command, scope, { preserveIdentity: true });
      const rows = await this.database.withTenantTransaction(
        scope,
        (tx) => tx.$queryRaw<{ id: string; status: string }[]>`
        SELECT id,status::text AS status FROM email_messages WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND idempotency_key=${alert.command.idempotencyKey} AND lower(recipient_email)=lower(${alert.command.to})
      `,
      );
      const row = rows[0];
      if (row && (row.status !== 'QUEUED' || (await this.queue?.getJob(row.id))))
        await this.senderFailures.confirm(scope, alert, row.id);
    }
  }

  private async transportRetryAllowed(
    messageId: string,
    context: MailDeliveryContext,
  ): Promise<boolean> {
    if (!context.tenantId || !context.propertyId) return true;
    const rows = await this.database.withTenantTransaction(
      { tenantId: context.tenantId, propertyId: context.propertyId },
      (tx) => tx.$queryRaw<{ messageId: string }[]>`
      SELECT message_id AS "messageId" FROM email_transport_attempts WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND message_id=${messageId}::uuid AND state IN ('SENDING','UNKNOWN')
    `,
    );
    return !rows.length;
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
      case 'senderVerification': {
        if (!this.senderProofs || !data.context.tenantId || !data.context.propertyId)
          return Promise.reject(
            new MailDeliveryError('Sender verification is unavailable.', false),
          );
        const proof = data.command as QueuedMailCommands['senderVerification'];
        return this.senderProofs
          .command(
            { tenantId: data.context.tenantId, propertyId: data.context.propertyId },
            proof.verificationId,
          )
          .then((rendered) => {
            if (rendered.to !== proof.to)
              throw new MailDeliveryError('Sender verification recipient changed.', false);
            return this.mail.sendRenderedEmail(rendered);
          });
      }
      default:
        return Promise.reject(
          new MailDeliveryError(`Unknown mail kind: ${String(data.kind)}`, false),
        );
    }
  }
}
