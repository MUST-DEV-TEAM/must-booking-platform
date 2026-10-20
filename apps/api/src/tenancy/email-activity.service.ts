import type { RecipientEnvelope } from '../mail/recipient-envelope';
import type { RecipientOutcomes } from '../mail/recipient-outcomes';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { createHash, randomUUID } from 'node:crypto';
import { auditCsv } from './audit-workspace';
import { Prisma } from '@prisma/client';
import { emailDeliveryQuery } from './email-delivery-query';

import { EmailMessageArchiveService } from '../mail/email-message-archive.service';
import { MailDeliveryService, RESEND_WINDOW_DAYS } from '../mail/mail-delivery.service';
import { emailWrite } from './email-workspace-writes';
import { CapabilitiesService } from './capabilities.service';
import { AuditLogService } from './audit-log.service';
import { TenantDatabaseService } from './tenant-database.service';

type Context = { tenantId: string; propertyId: string };
type Status = 'QUEUED' | 'SENT' | 'FAILED' | 'DELIVERED' | 'BOUNCED' | 'COMPLAINED' | 'SUPPRESSED';

export type EmailActivityItem = {
  id: string;
  version: number;
  eventType: string;
  label: string;
  recipient: string;
  recipientEnvelope?: RecipientEnvelope | null;
  recipientOutcomes?: RecipientOutcomes;
  subject: string;
  status: Status;
  lastError: string | null;
  attemptCount: number;
  bookingId: string | null;
  bookingReference: string | null;
  createdAt: Date;
  sentAt: Date | null;
  deliveredAt: Date | null;
  /** A failed email that is recent enough to be sent again. */
  canResend: boolean;
  transportBlocked: boolean;
};

/** Who guest emails come from today, and where replies go. */
export type EmailSender = {
  fromAddress: string | null;
  replyTo: string | null;
  hotelName: string;
};

export type EmailActivityPage = {
  items: EmailActivityItem[];
  page: number;
  pageSize: number;
  total: number;
  observedAt: Date;
  exportVersion: number;
  timezone: string | null;
  topics: { value: string; label: string }[];
};

/** Names people know, for the email log's event types. */
const LABELS: Record<string, string> = {
  'booking.confirmed': 'Booking confirmed (guest)',
  'booking.staff_new': 'New booking (staff)',
  'booking.refund_processed': 'Refund processed (guest)',
  'booking.cancelled': 'Booking cancelled (guest)',
  'booking.staff_cancelled': 'Booking cancelled (staff)',
  'guest.pre_arrival': 'Pre-arrival reminder (guest)',
  'guest.booking_changed': 'Booking changed (guest)',
  'guest.payment_not_completed': 'Payment not completed (guest)',
  'guest.post_stay': 'Post-stay thank-you (guest)',
  'owner.alert': 'Alert (owner)',
  'owner.refund_alert': 'Refund made (owner)',
  'owner.daily_summary': 'Daily summary (owner)',
  'template.test': 'Template test',
  'staff.invitation': 'Staff invitation',
  'email.sender_verification': 'Sender mailbox verification',
  'sender.test': 'Custom sender test',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every email this property sent, with "send again" for failed ones (email plan Step 4). */
@Injectable()
export class EmailActivityService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(MailDeliveryService) private readonly delivery: MailDeliveryService,
    @Inject(CapabilitiesService) private readonly capabilities: CapabilitiesService,
    @Inject(EmailMessageArchiveService) private readonly archive: EmailMessageArchiveService,
  ) {}

  list(context: Context, query: Record<string, unknown>): Promise<EmailActivityPage> {
    const page = this.positive(query.page, 1, 10_000);
    const pageSize = this.positive(query.pageSize, 25, 100);
    const filters = emailDeliveryQuery(query);
    return this.database.withTenantTransaction(context, async (tx) => {
      const scope = this.deliveryScope(context, filters);
      const rows = await tx.$queryRaw<
        Array<Omit<EmailActivityItem, 'label' | 'canResend'>>
      >(Prisma.sql`
        SELECT em.id,em.workspace_version AS version,em.event_type AS "eventType",em.recipient_email AS recipient,em.recipient_envelope AS "recipientEnvelope",em.recipient_outcomes AS "recipientOutcomes",em.subject,
          em.status::text AS status,em.last_error AS "lastError",em.attempt_count AS "attemptCount",
          em.booking_id::text AS "bookingId",COALESCE(b.order_reference,b.external_reference) AS "bookingReference",
          em.created_at AS "createdAt",em.sent_at AS "sentAt",em.delivered_at AS "deliveredAt",
          EXISTS(SELECT 1 FROM email_transport_attempts eta WHERE eta.tenant_id=em.tenant_id AND eta.property_id=em.property_id AND eta.message_id=em.id AND (eta.state IN ('SENDING','UNKNOWN') OR (eta.state='ACCEPTED' AND em.recipient_envelope IS NOT NULL))) AS "transportBlocked"
        ${scope} ORDER BY ${filters.order} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`);
      const counts = await tx.$queryRaw<{ total: number }[]>(
        Prisma.sql`SELECT count(*)::int AS total ${scope}`,
      );
      const properties = await tx.$queryRaw<
        { timezone: string; observedAt: Date; exportVersion: number }[]
      >`SELECT timezone,transaction_timestamp() AS "observedAt",email_delivery_export_version AS "exportVersion" FROM properties WHERE tenant_id=${context.tenantId}::uuid AND id=${context.propertyId}::uuid`;
      const topics = await tx.$queryRaw<
        { value: string }[]
      >`SELECT DISTINCT event_type AS value FROM email_messages WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid ORDER BY event_type`;
      const cutoff = Date.now() - RESEND_WINDOW_DAYS * 24 * 60 * 60 * 1000;
      return {
        items: rows.map((row) => ({
          ...row,
          label: LABELS[row.eventType] ?? row.eventType,
          lastError: row.lastError ? safeDeliveryError(row.lastError) : null,
          canResend:
            !row.transportBlocked &&
            row.status === 'FAILED' &&
            !['staff.invitation', 'email.sender_verification', 'sender.test'].includes(
              row.eventType,
            ) &&
            new Date(row.createdAt).getTime() > cutoff,
        })),
        observedAt: properties[0]!.observedAt,
        exportVersion: properties[0]!.exportVersion,
        timezone: properties[0]?.timezone ?? null,
        topics: topics.map((t) => ({ value: t.value, label: LABELS[t.value] ?? t.value })),
        page,
        pageSize,
        total: counts[0]?.total ?? 0,
      };
    });
  }

  private deliveryScope(context: Context, filters: ReturnType<typeof emailDeliveryQuery>) {
    return Prisma.sql`FROM email_messages em
        JOIN properties p ON p.tenant_id=em.tenant_id AND p.id=em.property_id
        LEFT JOIN bookings b ON b.tenant_id=em.tenant_id AND b.property_id=em.property_id AND b.id=em.booking_id
        WHERE em.tenant_id=${context.tenantId}::uuid AND em.property_id=${context.propertyId}::uuid AND ${filters.where}`;
  }

  async cleanupExports(context: Context, now = new Date()) {
    return this.database.withTenantTransaction(
      context,
      (tx) =>
        tx.$executeRaw`DELETE FROM email_delivery_exports WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND created_at<${now}-interval '24 hours'`,
    );
  }

  async export(context: Context, actorUserId: string, body: Record<string, unknown>, key?: string) {
    if (
      !key ||
      !/^[\x21-\x7e]{1,128}$/.test(key) ||
      !Number.isSafeInteger(body.version) ||
      Number(body.version) < 0
    )
      throw new BadRequestException('An Idempotency-Key and current export version are required.');
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 3 || reason.length > 300)
      throw new BadRequestException('An export reason of 3-300 characters is required.');
    const through = typeof body.through === 'string' ? new Date(body.through) : new Date(NaN);
    if (
      Number.isNaN(through.getTime()) ||
      through.getTime() > Date.now() + 5000 ||
      through.getTime() < Date.now() - 86400000
    )
      throw new BadRequestException('Use an observed cutoff within the last 24 hours.');
    if (!body.filters || typeof body.filters !== 'object' || Array.isArray(body.filters))
      throw new BadRequestException('Current delivery filters are required.');
    const filters = emailDeliveryQuery(body.filters as Record<string, unknown>, through);
    const ids = body.ids;
    if (
      ids !== undefined &&
      (!Array.isArray(ids) ||
        !ids.length ||
        ids.length > 100 ||
        ids.some((id) => typeof id !== 'string' || !UUID.test(id)) ||
        new Set(ids).size !== ids.length)
    )
      throw new BadRequestException('Select 1-100 distinct message IDs.');
    const normalized = {
      version: body.version,
      reason,
      through: through.toISOString(),
      ids: ids ? [...ids].sort() : null,
      filters: {
        filter: filters.filter,
        status: filters.status,
        topic: filters.topic,
        recipient: filters.recipient,
        search: filters.search,
        from: filters.from,
        to: filters.to,
        hours: filters.hours,
        sort: filters.sort,
        direction: filters.direction,
      },
    };
    const hash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    return this.database.withTenantTransaction(context, async (tx) => {
      const properties = await tx.$queryRaw<
        { version: number }[]
      >`SELECT email_delivery_export_version AS version FROM properties WHERE tenant_id=${context.tenantId}::uuid AND id=${context.propertyId}::uuid FOR UPDATE`;
      if (!properties[0]) throw new NotFoundException('Property was not found.');
      await tx.$executeRaw`DELETE FROM email_delivery_exports WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND created_at<now()-interval '24 hours'`;
      const receipts = await tx.$queryRaw<
        {
          hash: string;
          response: { csv: string; filename: string; count: number; version: number };
        }[]
      >`SELECT request_hash AS hash,response FROM email_delivery_exports WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND user_id=${actorUserId}::uuid AND idempotency_key=${key}`;
      if (receipts[0]) {
        if (receipts[0].hash !== hash)
          throw new ConflictException('Export intent changed. Use a new key.');
        return receipts[0].response;
      }
      if (properties[0].version !== body.version)
        throw new ConflictException('Another export changed the version. Reload before exporting.');
      const rows = await tx.$queryRaw<
        {
          id: string;
          topic: string;
          recipient: string;
          recipientEnvelope?: RecipientEnvelope | null;
          recipientOutcomes?: RecipientOutcomes;
          subject: string;
          status: string;
          attempts: number;
          booking: string | null;
          created: Date;
          sent: Date | null;
          delivered: Date | null;
        }[]
      >(
        Prisma.sql`SELECT em.id,em.event_type AS topic,em.recipient_email AS recipient,em.recipient_envelope AS "recipientEnvelope",em.recipient_outcomes AS "recipientOutcomes",em.subject,em.status::text AS status,em.attempt_count AS attempts,COALESCE(b.order_reference,b.external_reference) AS booking,em.created_at AS created,em.sent_at AS sent,em.delivered_at AS delivered ${this.deliveryScope(context, filters)} AND (${ids === undefined} OR em.id=ANY(${ids ?? []}::uuid[])) ORDER BY ${filters.order} LIMIT 5001`,
      );
      if (rows.length > 5000)
        throw new BadRequestException('More than 5,000 messages match. Narrow the filters.');
      if (Array.isArray(ids) && rows.length !== ids.length)
        throw new NotFoundException('A selected message is outside the current scope or filters.');
      const csv = auditCsv([
        [
          'Message ID',
          'Topic',
          'Recipient',
          'To',
          'CC',
          'BCC',
          'Recipient outcomes',
          'Subject',
          'Status',
          'Attempts',
          'Booking reference',
          'Created UTC',
          'Sent UTC',
          'Delivered UTC',
        ],
        ...rows.map((row) => [
          row.id,
          row.topic,
          row.recipient,
          row.recipientEnvelope?.to.join('; ') ?? row.recipient,
          row.recipientEnvelope?.cc.join('; ') ?? '',
          row.recipientEnvelope?.bcc.join('; ') ?? '',
          row.recipientEnvelope ? JSON.stringify(row.recipientOutcomes ?? {}) : '',
          row.subject,
          row.status,
          row.attempts,
          row.booking,
          row.created.toISOString(),
          row.sent?.toISOString(),
          row.delivered?.toISOString(),
        ]),
      ]);
      if (Buffer.byteLength(csv, 'utf8') > 2 * 1024 * 1024)
        throw new BadRequestException('Export exceeds 2 MB. Narrow the filters.');
      const version = properties[0].version + 1,
        response = {
          csv,
          count: rows.length,
          version,
          filename: `email-delivery-${context.propertyId}-${through.toISOString().slice(0, 10)}.csv`,
        };
      await this.audit.recordInTransaction(tx, {
        ...context,
        actorUserId,
        action: 'email.delivery.exported',
        targetType: 'email_export',
        targetId: context.propertyId,
        details: {
          reason,
          count: rows.length,
          through: through.toISOString(),
          selected: Array.isArray(ids),
          filters: normalized.filters,
        },
      });
      await tx.$executeRaw`UPDATE properties SET email_delivery_export_version=${version} WHERE tenant_id=${context.tenantId}::uuid AND id=${context.propertyId}::uuid`;
      await tx.$executeRaw`INSERT INTO email_delivery_exports(tenant_id,property_id,user_id,idempotency_key,request_hash,response) VALUES(${context.tenantId}::uuid,${context.propertyId}::uuid,${actorUserId}::uuid,${key},${hash},${JSON.stringify(response)}::jsonb)`;
      return response;
    });
  }

  overview(context: Context) {
    return this.database.withTenantTransaction(context, async (tx) => {
      const counts = await tx.$queryRaw<{ status: string; count: number; today: number }[]>`
        SELECT status::text AS status,count(*)::int AS count,
          count(*) FILTER(WHERE em.created_at >= date_trunc('day',now() AT TIME ZONE p.timezone) AT TIME ZONE p.timezone)::int AS today
        FROM email_messages em JOIN properties p ON p.tenant_id=em.tenant_id AND p.id=em.property_id
        WHERE em.tenant_id=${context.tenantId}::uuid AND em.property_id=${context.propertyId}::uuid
          AND em.event_type NOT IN ('template.test','sender.test') AND em.created_at>=now()-interval '7 days'
        GROUP BY status,p.timezone
      `;
      const metrics = await tx.$queryRaw<
        {
          volume24h: number;
          volume7d: number;
          attempted7d: number;
          bounced7d: number;
          complained7d: number;
          queued: number;
          oldestQueued: Date | null;
          suppressedAddresses: number;
        }[]
      >`
        SELECT count(*) FILTER(WHERE em.created_at>=now()-interval '24 hours')::int AS "volume24h",
          count(*) FILTER(WHERE em.created_at>=now()-interval '7 days')::int AS "volume7d",
          count(*) FILTER(WHERE em.created_at>=now()-interval '7 days' AND (em.attempt_count>0 OR em.status IN('SENT','DELIVERED','BOUNCED','COMPLAINED')))::int AS "attempted7d",
          count(*) FILTER(WHERE em.created_at>=now()-interval '7 days' AND em.status='BOUNCED')::int AS "bounced7d",
          count(*) FILTER(WHERE em.created_at>=now()-interval '7 days' AND em.status='COMPLAINED')::int AS "complained7d",
          count(*) FILTER(WHERE em.status='QUEUED')::int AS queued,
          min(em.created_at) FILTER(WHERE em.status='QUEUED') AS "oldestQueued",
          (SELECT count(*)::int FROM email_suppressions WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND active) AS "suppressedAddresses"
        FROM email_messages em WHERE em.tenant_id=${context.tenantId}::uuid AND em.property_id=${context.propertyId}::uuid AND em.event_type NOT IN ('template.test','sender.test')
      `;
      const failingTopics = await tx.$queryRaw<{ topic: string; count: number }[]>`
        SELECT event_type AS topic,count(*)::int AS count FROM email_messages
        WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid
          AND event_type NOT IN ('template.test','sender.test') AND created_at>=now()-interval '7 days' AND status IN('FAILED','BOUNCED','COMPLAINED')
        GROUP BY event_type ORDER BY count(*) DESC,event_type LIMIT 10
      `;
      const actionNeeded = await tx.$queryRaw<
        {
          id: string;
          eventType: string;
          recipient: string;
          status: string;
          lastError: string | null;
          createdAt: Date;
        }[]
      >`
        SELECT id,event_type AS "eventType",recipient_email AS recipient,status::text AS status,last_error AS "lastError",created_at AS "createdAt"
        FROM email_messages WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid
          AND event_type NOT IN ('template.test','sender.test') AND status IN('FAILED','BOUNCED','COMPLAINED')
        ORDER BY created_at DESC,id DESC LIMIT 10
      `;
      const m = metrics[0]!;
      const senderRows = await tx.$queryRaw<
        {
          mode: string;
          activeMode: string;
          status: string;
          records: unknown;
          dmarc: unknown;
          checkedAt: Date | null;
        }[]
      >`
        SELECT mode,active_mode AS "activeMode",domain_status AS status,dns_records AS records,dmarc_evidence AS dmarc,domain_checked_at AS "checkedAt"
        FROM email_sending_profiles WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid`;
      const sender = senderRows[0];
      const dns = sender && Array.isArray(sender.records) ? sender.records : [];
      const purposeStatus = (purpose: string) => {
        const matching = dns.filter(
          (row) => row && typeof row === 'object' && row.record === purpose,
        );
        if (!matching.length) return 'No recorded DNS result';
        return matching.every((row) => row.status === 'verified')
          ? 'Provider verified'
          : 'Provider: ' +
              [
                ...new Set(
                  matching.map((row) =>
                    typeof row.status === 'string' ? row.status : 'not recorded',
                  ),
                ),
              ].join(', ');
      };
      const dmarcState =
        sender?.dmarc && typeof sender.dmarc === 'object' && 'state' in sender.dmarc
          ? sender.dmarc.state
          : null;
      const domainEvidence = {
        activeMode: sender?.activeMode ?? 'DEFAULT',
        setupMode: sender?.mode ?? 'DEFAULT',
        status: sender?.status ?? 'unknown',
        checkedAt: sender?.checkedAt ?? null,
        spf: purposeStatus('SPF'),
        dkim: purposeStatus('DKIM'),
        dmarc:
          dmarcState === 'published'
            ? 'TXT published; alignment not checked'
            : dmarcState === 'absent'
              ? 'No TXT at the exact name; parent policy may apply'
              : dmarcState === 'invalid'
                ? 'Review conflicting or invalid DNS records'
                : dmarcState === 'unknown'
                  ? 'Public DNS check unavailable'
                  : 'No DMARC check recorded',
      };
      return {
        days: 7,
        counts,
        testTrafficExcluded: true,
        domainAuthentication:
          sender &&
          sender.mode === sender.activeMode &&
          sender.mode !== 'SMTP' &&
          sender.status === 'verified'
            ? 'VERIFIED'
            : 'UNKNOWN',
        domainEvidence,
        ...m,
        bounceRate: m.attempted7d ? (m.bounced7d * 100) / m.attempted7d : null,
        complaintRate: m.attempted7d ? (m.complained7d * 100) / m.attempted7d : null,
        failingTopics: failingTopics.map((r) => ({ ...r, label: LABELS[r.topic] ?? r.topic })),
        actionNeeded: actionNeeded.map((r) => ({
          ...r,
          label: LABELS[r.eventType] ?? r.eventType,
          lastError: r.lastError ? safeDeliveryError(r.lastError) : null,
        })),
      };
    });
  }

  async detail(context: Context, messageId: string, actorUserId?: string) {
    if (!UUID.test(messageId)) throw new NotFoundException('Email was not found.');
    const caps = actorUserId
      ? await this.capabilities.effective({ ...context, userId: actorUserId })
      : [];
    return this.database.withTenantTransaction(context, async (tx) => {
      const rows = await tx.$queryRaw<
        (Omit<EmailActivityItem, 'label' | 'canResend'> & {
          version: number;
          provider: string | null;
          providerMessageId: string | null;
          resendOfMessageId: string | null;
        })[]
      >`
        SELECT em.id,em.event_type AS "eventType",em.recipient_email AS recipient,em.recipient_envelope AS "recipientEnvelope",em.recipient_outcomes AS "recipientOutcomes",em.subject,
          em.status::text AS status,em.last_error AS "lastError",em.attempt_count AS "attemptCount",
          em.booking_id::text AS "bookingId",COALESCE(b.order_reference,b.external_reference) AS "bookingReference",
          em.created_at AS "createdAt",em.sent_at AS "sentAt",em.delivered_at AS "deliveredAt",em.workspace_version AS version,em.provider,em.provider_message_id AS "providerMessageId",em.resend_of_message_id AS "resendOfMessageId",
          EXISTS(SELECT 1 FROM email_transport_attempts eta WHERE eta.tenant_id=em.tenant_id AND eta.property_id=em.property_id AND eta.message_id=em.id AND (eta.state IN ('SENDING','UNKNOWN') OR (eta.state='ACCEPTED' AND em.recipient_envelope IS NOT NULL))) AS "transportBlocked"
        FROM email_messages em LEFT JOIN bookings b ON b.tenant_id=em.tenant_id AND b.property_id=em.property_id AND b.id=em.booking_id
        WHERE em.tenant_id=${context.tenantId}::uuid AND em.property_id=${context.propertyId}::uuid AND em.id=${messageId}::uuid
      `;
      const row = rows[0];
      if (!row) throw new NotFoundException('Email was not found.');
      const events = await tx.$queryRaw<
        {
          id: string;
          kind: string;
          status: string;
          attemptCount: number;
          provider: string | null;
          providerMessageId: string | null;
          observedAt: Date;
        }[]
      >`
        SELECT id,kind,status,attempt_count AS "attemptCount",provider,provider_message_id AS "providerMessageId",observed_at AS "observedAt"
        FROM email_delivery_events WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND message_id=${messageId}::uuid
        ORDER BY observed_at DESC,id DESC LIMIT 201`;
      const suppressed = await tx.$queryRaw<
        { recipient: string }[]
      >`SELECT recipient FROM email_suppressions WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND (recipient=${row.recipient.toLowerCase()} OR EXISTS(SELECT 1 FROM email_messages m WHERE m.tenant_id=${context.tenantId}::uuid AND m.property_id=${context.propertyId}::uuid AND m.id=${messageId}::uuid AND (m.recipient_envelope->'to' ? recipient OR m.recipient_envelope->'cc' ? recipient OR m.recipient_envelope->'bcc' ? recipient))) AND active`;
      const retained =
        !suppressed.length &&
        Date.now() - new Date(row.createdAt).getTime() < RESEND_WINDOW_DAYS * 86400000 &&
        (await this.delivery.canResend(messageId, context, true));
      return {
        ...row,
        renderedPreview: await this.archive.read(context, messageId, tx),
        bookingHref:
          caps.includes('bookings.view') && row.bookingId
            ? `/dashboard/${context.tenantId}?propertyId=${context.propertyId}&section=reservations&reservation=${row.bookingId}`
            : null,
        timeline: events.slice(0, 200).reverse(),
        timelineTruncated: events.length > 200,
        timelineHasCreation: events.some((e) => e.kind === 'QUEUED' && e.attemptCount === 0),
        retryUnavailableReason: row.transportBlocked
          ? row.recipientEnvelope
            ? 'A grouped staff email cannot be retried after acceptance or while acceptance is uncertain. Review individual recipient outcomes; a deliberate new copy is available only for sent or fully delivered messages.'
            : 'Another delivery attempt is active or acceptance is unknown. Automatic resend is stopped.'
          : suppressed.length
            ? 'Recipient is suppressed. Resolve it in Configuration before retrying.'
            : row.eventType === 'sender.test'
              ? 'Create a new sender test in Configuration. Sender tests have a separate hotel-wide rate limit.'
              : null,
        lastError: row.lastError ? safeDeliveryError(row.lastError) : null,
        label: LABELS[row.eventType] ?? row.eventType,
        canResend:
          !row.transportBlocked &&
          !suppressed.length &&
          row.status === 'FAILED' &&
          Date.now() - new Date(row.createdAt).getTime() < RESEND_WINDOW_DAYS * 86400000 &&
          retained,
        canSendCopy:
          retained &&
          row.eventType !== 'template.test' &&
          ['SENT', 'DELIVERED'].includes(row.status),
      };
    });
  }

  sender(context: Context): Promise<EmailSender> {
    return this.database.withTenantTransaction(context, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ name: string; supportEmail: string | null }>>`
        SELECT name, support_email AS "supportEmail" FROM properties
        WHERE tenant_id = ${context.tenantId}::uuid AND id = ${context.propertyId}::uuid
      `;
      if (!rows[0]) throw new NotFoundException('Property was not found.');
      // MAIL_FROM_EMAIL may be "Name <address>"; only the address is shown.
      const from = process.env.MAIL_FROM_EMAIL?.trim() ?? '';
      const address = /<([^>]+)>/.exec(from)?.[1] ?? from;
      return {
        fromAddress: address || null,
        replyTo: rows[0].supportEmail,
        hotelName: rows[0].name,
      };
    });
  }

  async retry(
    context: Context,
    actorUserId: string,
    messageId: string,
    body: Record<string, unknown>,
    key?: string,
  ) {
    if (!UUID.test(messageId)) throw new NotFoundException('Email was not found.');
    if (!Number.isSafeInteger(body.version) || Number(body.version) < 1)
      throw new BadRequestException('A positive message version is required.');
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 3 || reason.length > 300)
      throw new BadRequestException('A retry reason of 3-300 characters is required.');
    const response = await emailWrite(
      this.database,
      this.audit,
      context,
      actorUserId,
      key,
      'email.retry.requested',
      messageId,
      { version: body.version, reason },
      async (tx) => {
        const rows = await tx.$queryRaw<
          { status: string; version: number; createdAt: Date }[]
        >`SELECT status::text AS status,workspace_version AS version,created_at AS "createdAt" FROM email_messages WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND id=${messageId}::uuid FOR UPDATE`;
        const before = rows[0];
        if (!before) throw new NotFoundException('Email was not found.');
        if (before.version !== body.version || before.status !== 'FAILED')
          throw new ConflictException(
            'The email changed or is no longer failed. Reload before retrying.',
          );
        const suppressed = await tx.$queryRaw<
          { recipient: string }[]
        >`SELECT es.recipient FROM email_suppressions es JOIN email_messages em ON em.tenant_id=es.tenant_id AND em.property_id=es.property_id AND (lower(em.recipient_email)=es.recipient OR em.recipient_envelope->'to' ? es.recipient OR em.recipient_envelope->'cc' ? es.recipient OR em.recipient_envelope->'bcc' ? es.recipient) WHERE es.tenant_id=${context.tenantId}::uuid AND es.property_id=${context.propertyId}::uuid AND em.id=${messageId}::uuid AND es.active`;
        if (suppressed.length)
          throw new ConflictException(
            'This recipient is suppressed. Resolve the suppression before retrying.',
          );
        const approved = await this.delivery.retainedCommand(messageId, context);
        if (
          !approved ||
          Date.now() - new Date(before.createdAt).getTime() >= RESEND_WINDOW_DAYS * 86400000
        )
          throw new ConflictException(
            'The original approved message is no longer available for retry.',
          );
        const version = before.version + 1;
        await tx.$executeRaw`UPDATE email_messages SET status='QUEUED',last_error=NULL,workspace_version=${version},updated_at=now() WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND id=${messageId}::uuid`;
        return {
          response: { status: 'QUEUED' as const, version },
          details: {
            before: { status: before.status, version: before.version },
            after: { status: 'QUEUED', version },
            reason,
          },
        };
      },
    );
    const pending = await this.database.withTenantTransaction(
      context,
      (tx) =>
        tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM email_messages WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND id=${messageId}::uuid AND status='QUEUED' AND workspace_version=${response.version}`,
    );
    if (!pending.length) return { status: response.status, version: response.version };
    try {
      const approved = await this.delivery.retainedCommand(messageId, context);
      if (!approved) throw new Error('Retained command unavailable.');
      await this.delivery.enqueueApproved(approved, response.version);
    } catch {
      throw new ServiceUnavailableException(
        'Retry was recorded but could not be queued. Retry this same request.',
      );
    }
    return { status: response.status, version: response.version };
  }

  async bulkRetry(
    context: Context,
    actorUserId: string,
    body: Record<string, unknown>,
    key?: string,
  ) {
    const messages = body.messages;
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (
      !Array.isArray(messages) ||
      messages.length < 1 ||
      messages.length > 50 ||
      messages.some(
        (m) =>
          !m ||
          typeof m !== 'object' ||
          typeof m.id !== 'string' ||
          !UUID.test(m.id) ||
          !Number.isSafeInteger(m.version) ||
          m.version < 1,
      ) ||
      new Set(messages.map((m) => m.id)).size !== messages.length
    )
      throw new BadRequestException('Select 1-50 distinct messages with their current versions.');
    if (reason.length < 3 || reason.length > 300)
      throw new BadRequestException('A retry reason of 3-300 characters is required.');
    const selections = (messages as { id: string; version: number }[])
      .map((m) => ({ id: m.id, version: m.version }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const response = await emailWrite(
      this.database,
      this.audit,
      context,
      actorUserId,
      key,
      'email.bulk_retry.requested',
      context.propertyId,
      { messages: selections, reason },
      async (tx) => {
        const changes: { id: string; version: number }[] = [];
        for (const message of selections) {
          const rows = await tx.$queryRaw<
            { status: string; version: number; createdAt: Date; recipient: string }[]
          >`SELECT status::text AS status,workspace_version AS version,created_at AS "createdAt",recipient_email AS recipient FROM email_messages WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND id=${message.id}::uuid FOR UPDATE`;
          const row = rows[0];
          if (!row) throw new NotFoundException('A selected email was not found.');
          if (row.status !== 'FAILED' || row.version !== message.version)
            throw new ConflictException(
              'A selected email changed or is no longer failed. Reload before retrying.',
            );
          const suppressions = await tx.$queryRaw<
            { recipient: string }[]
          >`SELECT recipient FROM email_suppressions WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND (recipient=${row.recipient.toLowerCase()} OR EXISTS(SELECT 1 FROM email_messages m WHERE m.tenant_id=${context.tenantId}::uuid AND m.property_id=${context.propertyId}::uuid AND m.id=${message.id}::uuid AND (m.recipient_envelope->'to' ? recipient OR m.recipient_envelope->'cc' ? recipient OR m.recipient_envelope->'bcc' ? recipient))) AND active`;
          if (suppressions.length)
            throw new ConflictException(
              'A selected recipient is suppressed. Resolve it in Configuration first.',
            );
          if (
            Date.now() - row.createdAt.getTime() >= RESEND_WINDOW_DAYS * 86400000 ||
            !(await this.delivery.retainedCommand(message.id, context))
          )
            throw new ConflictException(
              'A selected original approved message is no longer available.',
            );
          const version = row.version + 1;
          await tx.$executeRaw`UPDATE email_messages SET status='QUEUED',last_error=NULL,workspace_version=${version},updated_at=now() WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND id=${message.id}::uuid`;
          changes.push({ id: message.id, version });
        }
        return {
          response: { status: 'QUEUED' as const, messages: changes },
          details: { reason, count: changes.length, before: selections, after: changes },
        };
      },
    );
    try {
      for (const message of response.messages) {
        const pending = await this.database.withTenantTransaction(
          context,
          (tx) =>
            tx.$queryRaw<
              { id: string }[]
            >`SELECT id FROM email_messages WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND id=${message.id}::uuid AND status='QUEUED' AND workspace_version=${message.version}`,
        );
        if (!pending.length) continue;
        const approved = await this.delivery.retainedCommand(message.id, context);
        if (!approved) throw new Error('Retained command unavailable.');
        await this.delivery.enqueueApproved(approved, message.version);
      }
    } catch {
      throw new ServiceUnavailableException(
        'Bulk retry was recorded but not fully queued. Retry this same request.',
      );
    }
    return response;
  }

  async resendCopy(
    context: Context,
    actorUserId: string,
    messageId: string,
    body: Record<string, unknown>,
    key?: string,
  ) {
    if (!UUID.test(messageId)) throw new NotFoundException('Email was not found.');
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (
      !Number.isSafeInteger(body.version) ||
      Number(body.version) < 1 ||
      reason.length < 3 ||
      reason.length > 300
    )
      throw new BadRequestException(
        'A current source version and reason of 3-300 characters are required.',
      );
    const response = await emailWrite(
      this.database,
      this.audit,
      context,
      actorUserId,
      key,
      'email.copy.requested',
      messageId,
      { version: body.version, reason },
      async (tx) => {
        const rows = await tx.$queryRaw<
          {
            version: number;
            status: string;
            createdAt: Date;
            recipient: string;
            eventType: string;
          }[]
        >`SELECT workspace_version AS version,status::text AS status,created_at AS "createdAt",recipient_email AS recipient,event_type AS "eventType" FROM email_messages WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND id=${messageId}::uuid FOR UPDATE`;
        const row = rows[0];
        if (!row) throw new NotFoundException('Email was not found.');
        if (row.version !== body.version || !['SENT', 'DELIVERED'].includes(row.status))
          throw new ConflictException(
            'The source changed or has no sent/delivered outcome. Reload before sending a copy.',
          );
        if (row.eventType === 'template.test')
          throw new ConflictException(
            'Use Send controlled test so the verified recipient and test cap are enforced.',
          );
        const suppressions = await tx.$queryRaw<
          { recipient: string }[]
        >`SELECT recipient FROM email_suppressions WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND (recipient=${row.recipient.toLowerCase()} OR EXISTS(SELECT 1 FROM email_messages m WHERE m.tenant_id=${context.tenantId}::uuid AND m.property_id=${context.propertyId}::uuid AND m.id=${messageId}::uuid AND (m.recipient_envelope->'to' ? recipient OR m.recipient_envelope->'cc' ? recipient OR m.recipient_envelope->'bcc' ? recipient))) AND active`;
        if (suppressions.length)
          throw new ConflictException(
            'The recipient is suppressed. Resolve it in Configuration first.',
          );
        if (
          Date.now() - row.createdAt.getTime() >= RESEND_WINDOW_DAYS * 86400000 ||
          !(await this.delivery.retainedCommand(messageId, context, true))
        )
          throw new ConflictException('The original approved message is no longer retained.');
        const copyId = randomUUID(),
          version = row.version + 1;
        await tx.$executeRaw`INSERT INTO email_messages(id,tenant_id,property_id,booking_id,event_type,recipient_email,recipient_kind,subject,template_version,idempotency_key,resend_of_message_id,recipient_envelope) SELECT ${copyId}::uuid,tenant_id,property_id,booking_id,event_type,recipient_email,recipient_kind,subject,template_version,${'manual-resend/' + copyId},id,recipient_envelope FROM email_messages WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND id=${messageId}::uuid`;
        await tx.$executeRaw`UPDATE email_messages SET workspace_version=${version},updated_at=now() WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND id=${messageId}::uuid`;
        return {
          response: {
            status: 'QUEUED' as const,
            messageId: copyId,
            originMessageId: messageId,
            version,
          },
          details: {
            reason,
            before: { version: row.version, status: row.status },
            after: { version, status: row.status, copyId },
          },
        };
      },
    );
    const pending = await this.database.withTenantTransaction(
      context,
      (tx) =>
        tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM email_messages WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND id=${response.messageId}::uuid AND status='QUEUED' AND workspace_version=1`,
    );
    if (pending.length) {
      try {
        const approved = await this.delivery.retainedCommand(messageId, context, true);
        if (!approved) throw new Error('Retained command unavailable.');
        await this.delivery.enqueueApproved(
          {
            ...approved,
            messageId: response.messageId,
            idempotencyKeyOverride: 'manual-resend/' + response.messageId,
          },
          1,
          true,
        );
      } catch {
        throw new ServiceUnavailableException(
          'The copy was recorded but could not be queued. Retry this same request.',
        );
      }
    }
    return response;
  }

  async resend(
    context: Context,
    actorUserId: string,
    messageId: string,
  ): Promise<{ status: 'QUEUED' }> {
    if (!UUID.test(messageId)) throw new NotFoundException('Email was not found.');
    const exists = await this.database.withTenantTransaction(context, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM email_messages
        WHERE tenant_id = ${context.tenantId}::uuid AND property_id = ${context.propertyId}::uuid
          AND id = ${messageId}::uuid
      `;
      return rows.length > 0;
    });
    if (!exists) throw new NotFoundException('Email was not found.');
    const result = await this.delivery.resend(messageId, context);
    if (result === 'not_failed')
      throw new ConflictException('Only a failed email can be sent again.');
    if (result === 'unavailable')
      throw new ConflictException(
        `This email can no longer be sent again (only failed emails from the last ${RESEND_WINDOW_DAYS} days can).`,
      );
    await this.audit.record({
      tenantId: context.tenantId,
      propertyId: context.propertyId,
      actorUserId,
      action: 'email.resent',
      targetType: 'email_message',
      targetId: messageId,
      details: {},
    });
    return { status: 'QUEUED' };
  }

  private positive(value: unknown, fallback: number, max: number): number {
    if (value === undefined) return fallback;
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1)
      throw new BadRequestException('page and pageSize must be positive whole numbers.');
    return Math.min(number, max);
  }
}

/** Provider text is untrusted diagnostic content; never expose credentials, authorization or URLs. */
export function safeDeliveryError(value: string): string {
  if (/(?:RESEND_API_KEY|MAIL_FROM_EMAIL) must be configured/.test(value))
    return 'Email sending is not configured. Choose a sender in Configuration.';
  return value
    .replace(/https?:\/\/\S+/gi, '[link redacted]')
    .replace(
      /(?:bearer|authorization|api[_ -]?key|token|password|secret)[\s:=]+\S+/gi,
      '[credential redacted]',
    )
    .slice(0, 500);
}
