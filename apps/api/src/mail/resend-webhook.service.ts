import { Inject, Injectable, Logger } from '@nestjs/common';

import { TenantDatabaseService } from '../tenancy/tenant-database.service';

export interface ResendWebhookEvent {
  type?: string;
  created_at?: string;
  data?: {
    email_id?: string;
    bounce?: { message?: string; type?: string; subType?: string };
    failed?: { reason?: string };
    [key: string]: unknown;
  };
}

/** What happened to an event: changed a row, was a no-op, or matched no known email. */
export type ResendWebhookOutcome = 'applied' | 'ignored' | 'unmatched';

/**
 * Applies Resend delivery events to `email_messages` (Milestone 22, Task 5).
 *
 * Status only moves forward, so replayed or out-of-order events are harmless: a late
 * "delivered" never overwrites "bounced", and a "delivered" never resurrects a FAILED row.
 * A "bounced"/"complained" is always recorded, since those are the facts staff must see.
 */
@Injectable()
export class ResendWebhookService {
  private readonly logger = new Logger(ResendWebhookService.name);

  constructor(@Inject(TenantDatabaseService) private readonly database: TenantDatabaseService) {}

  async apply(event: ResendWebhookEvent): Promise<ResendWebhookOutcome> {
    const providerMessageId = event.data?.email_id;
    if (!event.type || typeof providerMessageId !== 'string' || providerMessageId === '')
      return 'ignored';

    const occurredAt = this.occurredAt(event.created_at);

    return this.database.withEmailWebhookTransaction(async (tx) => {
      const existing = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM email_messages WHERE provider_message_id = ${providerMessageId} LIMIT 1
      `;
      if (existing.length === 0) return 'unmatched';

      let changed = 0;
      switch (event.type) {
        case 'email.delivered':
          changed = await tx.$executeRaw`
            UPDATE email_messages
            SET status = 'DELIVERED', delivered_at = ${occurredAt}, last_error = NULL, updated_at = now()
            WHERE provider_message_id = ${providerMessageId} AND status IN ('QUEUED', 'SENT')
          `;
          break;
        case 'email.bounced': {
          const bounce = event.data?.bounce;
          const detail = [bounce?.type, bounce?.subType, bounce?.message]
            .filter(Boolean)
            .join(' / ');
          changed = await tx.$executeRaw`
            UPDATE email_messages
            SET status = 'BOUNCED', last_error = ${`Bounced${detail ? `: ${detail}` : ''}`.slice(0, 1000)},
                updated_at = now()
            WHERE provider_message_id = ${providerMessageId}
              AND status IN ('QUEUED', 'SENT', 'DELIVERED', 'FAILED')
          `;
          break;
        }
        case 'email.complained':
          changed = await tx.$executeRaw`
            UPDATE email_messages
            SET status = 'COMPLAINED', last_error = 'Recipient marked the email as spam.', updated_at = now()
            WHERE provider_message_id = ${providerMessageId} AND status <> 'COMPLAINED'
          `;
          break;
        case 'email.failed':
        case 'email.suppressed': {
          const reason =
            event.type === 'email.suppressed'
              ? 'Suppressed by the email provider (recipient previously bounced or complained).'
              : `Provider failed to send: ${event.data?.failed?.reason ?? 'unknown reason'}`;
          changed = await tx.$executeRaw`
            UPDATE email_messages
            SET status = 'FAILED', last_error = ${reason.slice(0, 1000)}, updated_at = now()
            WHERE provider_message_id = ${providerMessageId} AND status IN ('QUEUED', 'SENT')
          `;
          break;
        }
        default:
          return 'ignored'; // sent / delivery_delayed / opened / clicked: nothing to change
      }
      if (changed > 0) this.logger.log(`Email ${providerMessageId}: ${event.type} recorded.`);
      return changed > 0 ? 'applied' : 'ignored';
    });
  }

  /** The event's own timestamp when valid; otherwise now, so the stored time is never invalid. */
  private occurredAt(createdAt: string | undefined): Date {
    const parsed = createdAt ? new Date(createdAt) : null;
    return parsed && !Number.isNaN(parsed.valueOf()) ? parsed : new Date();
  }
}
