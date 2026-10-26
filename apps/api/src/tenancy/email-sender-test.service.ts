import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  HttpException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { RenderedEmailCommand } from '@must/domain-contracts';
import { MailDeliveryService } from '../mail/mail-delivery.service';
import { renderBrandedEmail } from '../mail/email-layout';
import { AuditLogService } from './audit-log.service';
import { emailWrite, type EmailContext } from './email-workspace-writes';
import { TenantDatabaseService } from './tenant-database.service';

type TestIntent = {
  kind: 'CUSTOM_SENDER_TEST';
  id: string;
  actorUserId: string;
  senderVersion: number;
  mode: 'SMTP' | 'RESEND';
  createdAt: string;
  command: RenderedEmailCommand;
};
type Profile = {
  version: number;
  mode: 'DEFAULT' | 'SMTP' | 'RESEND';
  fromName: string | null;
  fromAddress: string | null;
  domain: string | null;
  credentials: boolean;
  fromVerifiedAt: Date | null;
  connectionCheckedAt: Date | null;
  connectionStatus: string;
  domainStatus: string;
  domainCheckedAt: Date | null;
  propertyName: string;
  replyTo: string | null;
};
/** Actor-only, capped immutable custom-sender tests; publication never changes activation. */
@Injectable()
export class EmailSenderTestService {
  constructor(
    @Inject(TenantDatabaseService) private readonly db: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(MailDeliveryService) private readonly delivery: MailDeliveryService,
  ) {}
  async request(scope: EmailContext, userId: string, body: Record<string, unknown>, key?: string) {
    if (
      Object.keys(body).some((field) => !['version', 'reason'].includes(field)) ||
      !Number.isSafeInteger(body.version) ||
      Number(body.version) < 1 ||
      typeof body.reason !== 'string' ||
      body.reason.trim().length < 3 ||
      body.reason.trim().length > 300
    )
      throw new BadRequestException(
        'Use the current sender version and a reason of 3-300 characters.',
      );
    const intent = await emailWrite<TestIntent>(
      this.db,
      this.audit,
      scope,
      userId,
      key,
      'email_sender.test_requested',
      scope.propertyId,
      { version: body.version, reason: body.reason.trim() },
      async (tx) => {
        const profiles = await tx.$queryRaw<Profile[]>`
          SELECT s.version,s.mode,s.from_name AS "fromName",s.from_address AS "fromAddress",s.domain,s.encrypted_credentials IS NOT NULL AS credentials,
            s.from_verified_at AS "fromVerifiedAt",s.connection_checked_at AS "connectionCheckedAt",s.connection_status AS "connectionStatus",s.domain_status AS "domainStatus",s.domain_checked_at AS "domainCheckedAt",
            p.name AS "propertyName",COALESCE(p.email_reply_to,p.support_email) AS "replyTo"
          FROM properties p JOIN email_sending_profiles s ON s.tenant_id=p.tenant_id AND s.property_id=p.id
          WHERE p.tenant_id=${scope.tenantId}::uuid AND p.id=${scope.propertyId}::uuid
        `;
        const p = profiles[0];
        if (!p) throw new BadRequestException('Save and verify a custom sender before testing it.');
        if (p.version !== body.version)
          throw new ConflictException('Sender setup changed. Reload before creating a test.');
        if (
          p.mode === 'DEFAULT' ||
          !p.credentials ||
          !p.fromAddress ||
          (p.mode === 'SMTP' &&
            (!p.fromVerifiedAt || !p.connectionCheckedAt || p.connectionStatus !== 'verified')) ||
          (p.mode === 'RESEND' &&
            (!p.domainCheckedAt ||
              p.domainStatus !== 'verified' ||
              p.fromAddress.split('@')[1] !== p.domain))
        )
          throw new BadRequestException('Verify the saved custom sender before testing it.');
        const users = await tx.$queryRaw<{ email: string }[]>`
          SELECT u.email FROM users u JOIN tenant_memberships tm ON tm.user_id=u.id AND tm.tenant_id=${scope.tenantId}::uuid
          WHERE u.id=${userId}::uuid AND u.email_verified_at IS NOT NULL
        `;
        if (!users[0])
          throw new BadRequestException(
            'A current verified member is required to receive this test.',
          );
        const counts = await tx.$queryRaw<{ count: bigint }[]>`
          SELECT count(*) AS count FROM email_workspace_operations WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid
            AND response->>'kind'='CUSTOM_SENDER_TEST' AND (response->>'createdAt')::timestamptz>clock_timestamp()-interval '1 hour'
        `;
        if (Number(counts[0]?.count ?? 0) >= 3)
          throw new HttpException(
            'Three sender tests per rolling hour are allowed for this hotel.',
            429,
          );
        const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
        const id = randomUUID(),
          subject = 'Custom hotel sender test';
        const command: RenderedEmailCommand = {
          eventType: 'sender.test',
          to: users[0].email,
          subject,
          bookingId: null,
          fromName: p.fromName ?? p.propertyName,
          replyTo: p.replyTo,
          idempotencyKey: `custom-sender-test/${id}`,
          text: `This is a test of the custom ${p.mode === 'SMTP' ? 'SMTP' : 'Resend'} sender saved for ${p.propertyName}. No guest email was sent and activation was not changed.`,
          html: renderBrandedEmail({
            subject,
            brand: { name: p.propertyName },
            heading: subject,
            content:
              '<p>This is a test of your saved custom sending service. No guest email was sent and activation was not changed.</p>',
          }),
        };
        const response: TestIntent = {
          kind: 'CUSTOM_SENDER_TEST',
          id,
          actorUserId: userId,
          senderVersion: p.version,
          mode: p.mode,
          createdAt: clock!.now.toISOString(),
          command,
        };
        return {
          response,
          details: {
            reason: String(body.reason).trim(),
            testId: id,
            senderVersion: p.version,
            mode: p.mode,
            recipientUserId: userId,
            activationChanged: false,
            guestFallback: false,
          },
        };
      },
    );
    await this.publish(scope, intent);
    return this.status(scope, userId, intent.id);
  }
  private async publish(scope: EmailContext, intent: TestIntent) {
    if (Date.now() - Date.parse(intent.createdAt) >= 7 * 86400000) return;
    await this.delivery.dispatch('rendered', intent.command, scope, {
      preserveIdentity: true,
      senderTestVersion: intent.senderVersion,
      senderTestActorId: intent.actorUserId,
    });
  }
  async status(scope: EmailContext, userId: string, id: string) {
    return this.db.withTenantTransaction(scope, async (tx) => {
      const rows = await tx.$queryRaw<{ intent: TestIntent }[]>`
        SELECT response AS intent FROM email_workspace_operations WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid
          AND response->>'kind'='CUSTOM_SENDER_TEST' AND response->>'id'=${id} AND response->>'actorUserId'=${userId}
      `;
      if (!rows[0]) throw new NotFoundException('Sender test was not found.');
      const intent = rows[0].intent;
      const mail = await tx.$queryRaw<
        { id: string; status: string; provider: string | null; transportBlocked: boolean }[]
      >`
        SELECT m.id,m.status::text AS status,m.provider,EXISTS(SELECT 1 FROM email_transport_attempts a WHERE a.tenant_id=${scope.tenantId}::uuid AND a.property_id=${scope.propertyId}::uuid AND a.message_id=m.id AND (a.state='UNKNOWN' OR (a.state='SENDING' AND a.lease_expires_at<=clock_timestamp()))) AS "transportBlocked"
        FROM email_messages m WHERE m.tenant_id=${scope.tenantId}::uuid AND m.property_id=${scope.propertyId}::uuid AND m.idempotency_key=${intent.command.idempotencyKey} AND lower(m.recipient_email)=lower(${intent.command.to})
      `;
      return {
        id: intent.id,
        mode: intent.mode,
        recipient: intent.command.to,
        senderVersion: intent.senderVersion,
        createdAt: intent.createdAt,
        status: mail[0]?.transportBlocked
          ? 'UNKNOWN'
          : mail[0]?.status === 'QUEUED' &&
              Date.now() - Date.parse(intent.createdAt) >= 7 * 86400000
            ? 'EXPIRED'
            : (mail[0]?.status ??
              (Date.now() - Date.parse(intent.createdAt) >= 7 * 86400000 ? 'EXPIRED' : 'PENDING')),
        messageId: mail[0]?.id ?? null,
        provider: mail[0]?.provider ?? null,
        activationChanged: false,
      };
    });
  }
  async recover(scope: EmailContext) {
    const rows = await this.db.withTenantTransaction(
      scope,
      (tx) => tx.$queryRaw<{ intent: TestIntent }[]>`
      SELECT o.response AS intent FROM email_workspace_operations o WHERE o.tenant_id=${scope.tenantId}::uuid AND o.property_id=${scope.propertyId}::uuid
        AND o.response->>'kind'='CUSTOM_SENDER_TEST' AND (o.response->>'createdAt')::timestamptz>clock_timestamp()-interval '7 days'
        AND NOT EXISTS(SELECT 1 FROM email_messages m WHERE m.tenant_id=${scope.tenantId}::uuid AND m.property_id=${scope.propertyId}::uuid AND m.idempotency_key=o.response->'command'->>'idempotencyKey' AND m.status<>'QUEUED')
      ORDER BY o.created_at LIMIT 20
    `,
    );
    for (const { intent } of rows) await this.publish(scope, intent);
  }
}
