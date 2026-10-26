import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { RenderedEmailCommand } from '@must/domain-contracts';
import { AuditLogService } from '../tenancy/audit-log.service';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { renderBrandedEmail, escapeHtml, MUST_BOOKING_BRAND } from './email-layout';
import type { TransportScope } from './email-transport-journal';

type Scope = { tenantId: string; propertyId: string };
export type PendingOwnerAlert = {
  messageId: string;
  ownerUserId: string;
  command: RenderedEmailCommand;
};
/** Durable, nonrecursive owner alerts; no guest content or provider error body is retained. */
@Injectable()
export class EmailTransportFailures {
  constructor(
    @Inject(TenantDatabaseService) private readonly db: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}
  record(scope: TransportScope) {
    return this.db.withTenantTransaction(scope, async (tx) => {
      // Serialize incident grouping before locking individual messages (the same property-first order as settings writes).
      await tx.$queryRaw`SELECT id FROM properties WHERE tenant_id=${scope.tenantId}::uuid AND id=${scope.propertyId}::uuid FOR NO KEY UPDATE`;
      const messages = await tx.$queryRaw<{ status: string; propertyName: string }[]>`
        SELECT m.status::text AS status,p.name AS "propertyName" FROM email_messages m
        JOIN properties p ON p.tenant_id=m.tenant_id AND p.id=m.property_id
        WHERE m.tenant_id=${scope.tenantId}::uuid AND m.property_id=${scope.propertyId}::uuid AND m.id=${scope.messageId}::uuid FOR UPDATE OF m
      `;
      if (!messages[0]) return;
      const roots = await tx.$queryRaw<{ messageId: string }[]>`
        SELECT message_id AS "messageId" FROM email_transport_failures WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND message_id=${scope.messageId}::uuid
      `;
      if (roots.length) return;
      const attempts = await tx.$queryRaw<{ stage: string; state: string }[]>`
        SELECT stage,state FROM email_transport_attempts WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND message_id=${scope.messageId}::uuid
      `;
      const outcome = attempts.some((row) => row.state === 'UNKNOWN')
        ? 'UNKNOWN'
        : attempts.some((row) => row.stage === 'FALLBACK' && row.state === 'ACCEPTED')
          ? 'FALLBACK_USED'
          : messages[0].status === 'FAILED' && attempts.some((row) => row.state === 'REJECTED')
            ? 'FAILED'
            : null;
      if (!outcome) return;
      const recent = await tx.$queryRaw<{ notificationId: string; startedAt: Date }[]>`
        SELECT notification_id AS "notificationId",alert_started_at AS "startedAt" FROM email_transport_failures
        WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND alert_started_at>clock_timestamp()-interval '1 hour'
        ORDER BY created_at LIMIT 1
      `;
      if (recent[0]) {
        await tx.$executeRaw`INSERT INTO email_transport_failures(tenant_id,property_id,message_id,notification_id,outcome,alert_started_at)
          VALUES(${scope.tenantId}::uuid,${scope.propertyId}::uuid,${scope.messageId}::uuid,${recent[0].notificationId}::uuid,${outcome},${recent[0].startedAt})`;
        await this.audit.recordInTransaction(tx, {
          tenantId: scope.tenantId,
          propertyId: scope.propertyId,
          actorUserId: null,
          action: 'email_transport.owner_alert_grouped',
          targetType: 'email',
          targetId: scope.messageId,
          details: {
            actorType: 'job',
            source: 'job',
            outcome,
            notificationId: recent[0].notificationId,
            reason:
              'Existing hotel sender alert in the rolling hour; all failures remain in Delivery',
          },
        });
        return;
      }
      const notificationId = randomUUID();
      await tx.$executeRaw`
        INSERT INTO notifications(id,tenant_id,property_id,type,payload) VALUES(${notificationId}::uuid,${scope.tenantId}::uuid,${scope.propertyId}::uuid,'EMAIL_DELIVERY_FAILED',${JSON.stringify({ emailMessageId: scope.messageId, outcome })}::jsonb)
      `;
      await tx.$executeRaw`
        INSERT INTO email_transport_failures(tenant_id,property_id,message_id,notification_id,outcome) VALUES(${scope.tenantId}::uuid,${scope.propertyId}::uuid,${scope.messageId}::uuid,${notificationId}::uuid,${outcome})
      `;
      const owners = await tx.$queryRaw<{ userId: string; email: string }[]>`
        SELECT tm.user_id AS "userId",u.email FROM tenant_memberships tm JOIN users u ON u.id=tm.user_id
        WHERE tm.tenant_id=${scope.tenantId}::uuid AND tm.role='OWNER' AND u.email_verified_at IS NOT NULL
      `;
      for (const owner of owners) {
        const command = ownerSenderFailureEmail(
          scope,
          messages[0].propertyName,
          outcome,
          owner.userId,
          owner.email,
        );
        await tx.$executeRaw`
          INSERT INTO email_transport_failure_outbox(tenant_id,property_id,message_id,owner_user_id,recipient_email,command)
          VALUES(${scope.tenantId}::uuid,${scope.propertyId}::uuid,${scope.messageId}::uuid,${owner.userId}::uuid,${owner.email},${JSON.stringify(command)}::jsonb)
        `;
      }
      await this.audit.recordInTransaction(tx, {
        tenantId: scope.tenantId,
        propertyId: scope.propertyId,
        actorUserId: null,
        action: 'email_transport.owner_alert_created',
        targetType: 'email',
        targetId: scope.messageId,
        details: {
          actorType: 'job',
          source: 'job',
          outcome,
          notificationId,
          ownerEmailIntentCount: owners.length,
        },
      });
    });
  }
  async discover(scope: Scope) {
    const rows = await this.db.withTenantTransaction(
      scope,
      (tx) => tx.$queryRaw<{ messageId: string }[]>`
      SELECT DISTINCT a.message_id AS "messageId" FROM email_transport_attempts a
      JOIN email_messages m ON m.tenant_id=a.tenant_id AND m.property_id=a.property_id AND m.id=a.message_id
      WHERE a.tenant_id=${scope.tenantId}::uuid AND a.property_id=${scope.propertyId}::uuid
        AND (a.state='UNKNOWN' OR (a.state='REJECTED' AND m.status='FAILED') OR (a.stage='FALLBACK' AND a.state='ACCEPTED'))
        AND NOT EXISTS(SELECT 1 FROM email_transport_failures f WHERE f.tenant_id=${scope.tenantId}::uuid AND f.property_id=${scope.propertyId}::uuid AND f.message_id=a.message_id)
      ORDER BY a.message_id LIMIT 50
    `,
    );
    for (const row of rows) await this.record({ ...scope, messageId: row.messageId });
  }
  pending(scope: Scope): Promise<PendingOwnerAlert[]> {
    return this.db.withTenantTransaction(
      scope,
      (tx) => tx.$queryRaw<PendingOwnerAlert[]>`
      SELECT o.message_id AS "messageId",o.owner_user_id AS "ownerUserId",o.command FROM email_transport_failure_outbox o
      JOIN tenant_memberships tm ON tm.tenant_id=o.tenant_id AND tm.user_id=o.owner_user_id AND tm.role='OWNER'
      JOIN users u ON u.id=tm.user_id AND u.email_verified_at IS NOT NULL AND lower(u.email)=lower(o.recipient_email)
      WHERE o.tenant_id=${scope.tenantId}::uuid AND o.property_id=${scope.propertyId}::uuid AND o.published_at IS NULL AND o.expires_at>clock_timestamp()
      ORDER BY o.created_at,o.message_id,o.owner_user_id LIMIT 50
    `,
    );
  }
  async allowed(scope: Scope, command: RenderedEmailCommand): Promise<boolean> {
    const rows = await this.db.withTenantTransaction(
      scope,
      (tx) => tx.$queryRaw<{ userId: string }[]>`
      SELECT o.owner_user_id AS "userId" FROM email_transport_failure_outbox o
      JOIN tenant_memberships tm ON tm.tenant_id=o.tenant_id AND tm.user_id=o.owner_user_id AND tm.role='OWNER'
      JOIN users u ON u.id=tm.user_id AND u.email_verified_at IS NOT NULL AND lower(u.email)=lower(o.recipient_email)
      WHERE o.tenant_id=${scope.tenantId}::uuid AND o.property_id=${scope.propertyId}::uuid AND o.expires_at>clock_timestamp()
        AND o.command->>'idempotencyKey'=${command.idempotencyKey} AND lower(o.recipient_email)=lower(${command.to})
      LIMIT 1
    `,
    );
    return rows.length > 0;
  }
  confirm(scope: Scope, alert: PendingOwnerAlert, mailId: string) {
    return this.db.withTenantTransaction(
      scope,
      (tx) => tx.$executeRaw`
      UPDATE email_transport_failure_outbox o SET published_at=clock_timestamp()
      WHERE o.tenant_id=${scope.tenantId}::uuid AND o.property_id=${scope.propertyId}::uuid AND o.message_id=${alert.messageId}::uuid AND o.owner_user_id=${alert.ownerUserId}::uuid AND o.published_at IS NULL
        AND EXISTS(SELECT 1 FROM email_messages m WHERE m.tenant_id=${scope.tenantId}::uuid AND m.property_id=${scope.propertyId}::uuid AND m.id=${mailId}::uuid AND m.idempotency_key=o.command->>'idempotencyKey' AND lower(m.recipient_email)=lower(o.recipient_email))
    `,
    );
  }
  cleanup(scope: Scope) {
    return this.db.withTenantTransaction(
      scope,
      (tx) => tx.$executeRaw`
      DELETE FROM email_transport_failure_outbox WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND expires_at<=clock_timestamp()
    `,
    );
  }
}

export function ownerSenderFailureEmail(
  scope: TransportScope,
  propertyName: string,
  outcome: 'UNKNOWN' | 'FAILED' | 'FALLBACK_USED',
  ownerUserId: string,
  to: string,
): RenderedEmailCommand {
  const subject = 'Hotel email sending needs attention';
  const explanation =
    outcome === 'UNKNOWN'
      ? 'Delivery could not be confirmed. Automatic retries and fallback were stopped to avoid duplicate email.'
      : outcome === 'FALLBACK_USED'
        ? 'Your custom sender rejected an email. The guest message was accepted through the MUST sender using your fallback preference.'
        : 'An email could not be accepted by the configured sending service after the permitted attempts.';
  let href: string | null = null;
  try {
    const url = new URL(`/dashboard/${scope.tenantId}`, process.env.WEB_APP_URL);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error();
    url.search = new URLSearchParams({
      propertyId: scope.propertyId,
      section: 'emails',
      emailMessageId: scope.messageId,
    }).toString();
    href = url.toString();
  } catch {
    /* Without a configured URL, give a real navigation instruction instead of a dead link. */
  }
  return {
    eventType: 'owner.email_transport_failure',
    to,
    subject,
    bookingId: null,
    fromName: 'MUST Booking',
    replyTo: MUST_BOOKING_BRAND.supportEmail,
    idempotencyKey: `owner-email-failure/${scope.messageId}/${ownerUserId}`,
    text: `${propertyName}: ${explanation} Open Emails > Delivery to review the message and sending configuration.${href ? ` ${href}` : ''}`,
    html: renderBrandedEmail({
      subject,
      brand: MUST_BOOKING_BRAND,
      heading: subject,
      content: `<p>${escapeHtml(propertyName)}: ${escapeHtml(explanation)}</p><p>Open Emails &gt; Delivery to review the message and sending configuration.</p>`,
      cta: href ? { url: href, label: 'Review delivery' } : null,
    }),
  };
}
