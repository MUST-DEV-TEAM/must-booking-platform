import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { MailDeliveryService, RESEND_WINDOW_DAYS } from '../mail/mail-delivery.service';
import { AuditLogService } from './audit-log.service';
import { TenantDatabaseService } from './tenant-database.service';

type Context = { tenantId: string; propertyId: string };
type Status = 'QUEUED' | 'SENT' | 'FAILED' | 'DELIVERED' | 'BOUNCED' | 'COMPLAINED';

export type EmailActivityItem = {
  id: string;
  eventType: string;
  label: string;
  recipient: string;
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
  'owner.alert': 'Alert (owner)',
  'owner.refund_alert': 'Refund made (owner)',
  'owner.daily_summary': 'Daily summary (owner)',
  'template.test': 'Template test',
  'staff.invitation': 'Staff invitation',
};

const FILTERS: Record<string, Status[]> = {
  all: ['QUEUED', 'SENT', 'FAILED', 'DELIVERED', 'BOUNCED', 'COMPLAINED'],
  problems: ['FAILED', 'BOUNCED', 'COMPLAINED'],
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every email this property sent, with "send again" for failed ones (email plan Step 4). */
@Injectable()
export class EmailActivityService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(MailDeliveryService) private readonly delivery: MailDeliveryService,
  ) {}

  list(context: Context, query: Record<string, unknown>): Promise<EmailActivityPage> {
    const page = this.positive(query.page, 1, 10_000);
    const pageSize = this.positive(query.pageSize, 25, 100);
    const filter = typeof query.filter === 'string' ? query.filter : 'all';
    const statuses = FILTERS[filter];
    if (!statuses) throw new BadRequestException('filter must be "all" or "problems".');
    return this.database.withTenantTransaction(context, async (tx) => {
      const [rows, counts] = await Promise.all([
        tx.$queryRaw<Array<Omit<EmailActivityItem, 'label' | 'canResend'>>>`
          SELECT em.id, em.event_type AS "eventType", em.recipient_email AS recipient, em.subject,
            em.status::text AS status, em.last_error AS "lastError",
            em.attempt_count AS "attemptCount", em.booking_id::text AS "bookingId",
            COALESCE(b.order_reference, b.external_reference) AS "bookingReference",
            em.created_at AS "createdAt", em.sent_at AS "sentAt", em.delivered_at AS "deliveredAt"
          FROM email_messages em
          LEFT JOIN bookings b ON b.tenant_id = em.tenant_id AND b.id = em.booking_id
          WHERE em.tenant_id = ${context.tenantId}::uuid AND em.property_id = ${context.propertyId}::uuid
            AND em.status::text = ANY(${statuses})
          ORDER BY em.created_at DESC, em.id DESC
          LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
        `,
        tx.$queryRaw<Array<{ total: number }>>`
          SELECT count(*)::int AS total FROM email_messages
          WHERE tenant_id = ${context.tenantId}::uuid AND property_id = ${context.propertyId}::uuid
            AND status::text = ANY(${statuses})
        `,
      ]);
      const cutoff = Date.now() - RESEND_WINDOW_DAYS * 24 * 60 * 60 * 1000;
      return {
        items: rows.map((row) => ({
          ...row,
          label: LABELS[row.eventType] ?? row.eventType,
          canResend:
            row.status === 'FAILED' &&
            row.eventType !== 'staff.invitation' &&
            new Date(row.createdAt).getTime() > cutoff,
        })),
        page,
        pageSize,
        total: counts[0]?.total ?? 0,
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
