import { createHash } from 'node:crypto';
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
      const existing = await tx.$queryRaw<
        { id: string; tenantId: string | null; propertyId: string | null; recipient: string }[]
      >`
        SELECT id,tenant_id::text AS "tenantId",property_id::text AS "propertyId",recipient_email AS recipient FROM email_messages WHERE provider_message_id = ${providerMessageId} LIMIT 1
      `;
      if (existing.length === 0) return 'unmatched';
      const scope = existing[0]!;
      if (scope.tenantId && scope.propertyId) {
        await tx.$executeRaw`SELECT set_config('app.tenant_id',${scope.tenantId},true),set_config('app.property_id',${scope.propertyId},true)`;
        const reason =
          event.type === 'email.complained'
            ? 'complaint'
            : event.type === 'email.bounced' &&
                typeof event.data?.bounce?.type === 'string' &&
                event.data.bounce.type.toLowerCase() === 'permanent'
              ? 'hard_bounce'
              : null;
        if (reason) {
          const fingerprint = createHash('sha256')
            .update(
              JSON.stringify({
                type: event.type,
                createdAt: event.created_at ?? null,
                bounce: {
                  type: event.data?.bounce?.type ?? null,
                  subType: event.data?.bounce?.subType ?? null,
                  message: event.data?.bounce?.message ?? null,
                },
              }),
            )
            .digest('hex');
          const receipt = await tx.$queryRaw<
            { message_id: string }[]
          >`INSERT INTO email_suppression_events(tenant_id,property_id,message_id,event_hash) VALUES(${scope.tenantId}::uuid,${scope.propertyId}::uuid,${scope.id}::uuid,${fingerprint}) ON CONFLICT DO NOTHING RETURNING message_id`;
          if (receipt.length) {
            const activated = await tx.$executeRaw`
          INSERT INTO email_suppressions(tenant_id,property_id,recipient,reason,latest_event_at)
          VALUES(${scope.tenantId}::uuid,${scope.propertyId}::uuid,${scope.recipient.toLowerCase()},${reason},${occurredAt})
          ON CONFLICT(tenant_id,property_id,recipient) DO UPDATE SET reason=EXCLUDED.reason,active=true,version=email_suppressions.version+1,latest_event_at=EXCLUDED.latest_event_at,updated_at=now()
          WHERE EXCLUDED.latest_event_at>email_suppressions.latest_event_at AND (email_suppressions.cleared_at IS NULL OR EXCLUDED.latest_event_at>email_suppressions.cleared_at)
        `;
            if (activated)
              await tx.$executeRaw`INSERT INTO audit_logs(tenant_id,property_id,actor_user_id,actor_type,action,target_type,target_id,details) VALUES(${scope.tenantId}::uuid,${scope.propertyId}::uuid,NULL,'TENANT_USER'::"AuditActorType",'email.suppression.activated','email_suppression',${scope.recipient.toLowerCase()},${JSON.stringify({ reason, messageId: scope.id, source: 'delivery_webhook' })}::jsonb)`;
          }
        }
      }

      let changed = 0;
      switch (event.type) {
        case 'email.delivered':
          changed = await tx.$executeRaw`
            UPDATE email_messages
            SET status = 'DELIVERED', delivered_at = ${occurredAt}, last_error = NULL, updated_at = now()
            WHERE tenant_id IS NOT DISTINCT FROM ${scope.tenantId}::uuid AND property_id IS NOT DISTINCT FROM ${scope.propertyId}::uuid AND provider_message_id = ${providerMessageId} AND status IN ('QUEUED', 'SENT')
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
            WHERE tenant_id IS NOT DISTINCT FROM ${scope.tenantId}::uuid AND property_id IS NOT DISTINCT FROM ${scope.propertyId}::uuid AND provider_message_id = ${providerMessageId}
              AND status IN ('QUEUED', 'SENT', 'DELIVERED', 'FAILED')
          `;
          break;
        }
        case 'email.complained':
          changed = await tx.$executeRaw`
            UPDATE email_messages
            SET status = 'COMPLAINED', last_error = 'Recipient marked the email as spam.', updated_at = now()
            WHERE tenant_id IS NOT DISTINCT FROM ${scope.tenantId}::uuid AND property_id IS NOT DISTINCT FROM ${scope.propertyId}::uuid AND provider_message_id = ${providerMessageId} AND status <> 'COMPLAINED'
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
            WHERE tenant_id IS NOT DISTINCT FROM ${scope.tenantId}::uuid AND property_id IS NOT DISTINCT FROM ${scope.propertyId}::uuid AND provider_message_id = ${providerMessageId} AND status IN ('QUEUED', 'SENT')
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
