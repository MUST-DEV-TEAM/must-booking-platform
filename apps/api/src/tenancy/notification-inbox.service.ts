import { bookingContactSql } from '../booking/booking-contact';
import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogService } from './audit-log.service';
import { CapabilitiesService } from './capabilities.service';
import { TenantDatabaseService } from './tenant-database.service';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_PRIORITIES,
  NOTIFICATION_REGISTRY,
  NOTIFICATION_UUID,
  registeredNotificationTypes,
  type NotificationType,
} from './notification-registry';
import { BOOKING_NEEDS_ATTENTION_STATUSES } from '../booking/booking-attention';
const ACTIONABLE_TYPES: NotificationType[] = ['EMAIL_DELIVERY_FAILED', 'BOOKING_NEEDS_ATTENTION', 'CANCELLATION_REQUESTED'];
export type InboxContext = { tenantId: string; propertyId: string; userId: string };
type Row = {
  id: string;
  type: NotificationType;
  readAt: Date | null;
  createdAt: Date;
  bookingId: string | null;
  bookingStatus: string | null;
  reference: string | null;
  guestName: string | null;
  startsOn: string | null;
  endsOn: string | null;
  needsAction: boolean | null;
  emailMessageId: string | null;
  manuallyResolved: boolean;
  resolvedAt: Date | null;
  resolvedByName: string | null;
  resolutionNote: string | null;
};
/** Personal awareness over existing operational facts; reading never resolves an issue. */
@Injectable()
export class NotificationInboxService {
  constructor(
    @Inject(TenantDatabaseService) private readonly db: TenantDatabaseService,
    @Inject(CapabilitiesService) private readonly caps: CapabilitiesService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}
  private async access(c: InboxContext) {
    const caps = await this.caps.effective(c);
    const member = await this.db.withTenantTransaction(
      c,
      (tx) =>
        tx.$queryRaw<
          { role: string }[]
        >`SELECT role FROM tenant_memberships WHERE tenant_id=${c.tenantId}::uuid AND user_id=${c.userId}::uuid`,
    );
    const broad = ['OWNER', 'ADMIN'].includes(member[0]?.role ?? '');
    const types = registeredNotificationTypes(caps, broad);
    return { caps, types };
  }
  private base(c: InboxContext, types: NotificationType[]) {
    return Prisma.sql`
  SELECT n.id,n.type,r.read_at AS "readAt",n.created_at AS "createdAt",b.id AS "bookingId",b.status::text AS "bookingStatus",b.external_reference AS reference,
   NULLIF(TRIM(CONCAT_WS(' ',${bookingContactSql.firstName},${bookingContactSql.lastName})),'') AS "guestName",b.starts_on::text AS "startsOn",b.ends_on::text AS "endsOn",
   n.payload->>'emailMessageId' AS "emailMessageId",
   (nr.notification_id IS NOT NULL) AS "manuallyResolved",nr.resolved_at AS "resolvedAt",
   COALESCE(NULLIF(TRIM(CONCAT_WS(' ',ru.first_name,ru.last_name)),''),ru.email) AS "resolvedByName",nr.note AS "resolutionNote",
   CASE WHEN nr.notification_id IS NOT NULL THEN false WHEN n.type='CANCELLATION_REQUESTED' THEN EXISTS(SELECT 1 FROM booking_requests q WHERE q.tenant_id=n.tenant_id AND q.property_id=n.property_id AND q.id::text=n.payload->>'requestId' AND q.status='Pending') WHEN n.type='EMAIL_DELIVERY_FAILED' THEN true WHEN n.type<>'BOOKING_NEEDS_ATTENTION' THEN false WHEN b.id IS NULL THEN NULL ELSE
    (b.status::text=ANY(${[...BOOKING_NEEDS_ATTENTION_STATUSES]}::text[]) OR EXISTS(SELECT 1 FROM manual_review_items m WHERE m.tenant_id=${c.tenantId}::uuid AND m.property_id=${c.propertyId}::uuid AND m.reference_type='booking' AND m.reference_id=b.id::text AND m.status='OPEN')) END AS "needsAction"
  FROM notifications n
  LEFT JOIN notification_reads r ON r.tenant_id=n.tenant_id AND r.property_id=n.property_id AND r.notification_id=n.id AND r.user_id=${c.userId}::uuid
  LEFT JOIN notification_resolutions nr ON nr.tenant_id=n.tenant_id AND nr.property_id=n.property_id AND nr.notification_id=n.id
  LEFT JOIN users ru ON ru.id=nr.resolved_by_user_id
  LEFT JOIN bookings b ON b.tenant_id=n.tenant_id AND b.property_id=n.property_id AND b.id::text=n.payload->>'bookingId'
  LEFT JOIN guests g ON g.tenant_id=b.tenant_id AND g.id=b.guest_id
  WHERE n.tenant_id=${c.tenantId}::uuid AND n.property_id=${c.propertyId}::uuid AND n.type=ANY(${types}::text[])
   AND n.created_at>=transaction_timestamp()-interval '90 days'`;
  }
  private present(row: Row, c: InboxContext, caps: string[]) {
    const registry = NOTIFICATION_REGISTRY[row.type];
    const canBooking = caps.includes('bookings.view'),
      canStaff = caps.includes('staff.view');
    const href =
      row.type === 'CANCELLATION_REQUESTED' && caps.includes('requests.review')
        ? `/dashboard/${c.tenantId}?propertyId=${c.propertyId}&section=overview&tab=approvals`
        : row.type === 'EMAIL_DELIVERY_FAILED' &&
      caps.includes('settings.manage') &&
      row.emailMessageId &&
      NOTIFICATION_UUID.test(row.emailMessageId)
        ? `/dashboard/${c.tenantId}?propertyId=${c.propertyId}&section=emails&emailMessageId=${row.emailMessageId}`
        : canBooking && row.bookingId
          ? `/dashboard/${c.tenantId}?propertyId=${c.propertyId}&section=reservations&reservation=${row.bookingId}`
          : row.type === 'STAFF_SEAT_CAP_REACHED' && canStaff
            ? `/dashboard/${c.tenantId}?propertyId=${c.propertyId}&section=staff`
            : null;
    return {
      id: row.id,
      type: row.type,
      ...registry,
      readAt: row.readAt,
      createdAt: row.createdAt,
      needsAction: row.needsAction,
      actionable: ACTIONABLE_TYPES.includes(row.type),
      resolution: this.resolution(row),
      booking:
        canBooking && row.bookingId
          ? {
              id: row.bookingId,
              externalReference: row.reference,
              status: row.bookingStatus,
              guestName: row.guestName,
              startsOn: row.startsOn,
              endsOn: row.endsOn,
            }
          : null,
      href,
      limitedContext:
        row.type === 'EMAIL_DELIVERY_FAILED'
          ? !caps.includes('settings.manage')
            ? 'settings.manage'
            : !href
              ? 'Related email is unavailable'
              : null
          : !canBooking && row.type !== 'STAFF_SEAT_CAP_REACHED'
            ? 'bookings.view'
            : !row.bookingId && row.type !== 'STAFF_SEAT_CAP_REACHED'
              ? 'Related reservation is unavailable'
              : null,
    };
  }
  /** Open, resolved (by a person or automatically by the underlying record), or null for information. */
  private resolution(row: Row) {
    if (row.manuallyResolved)
      return {
        state: 'resolved' as const,
        source: 'manual' as const,
        by: row.resolvedByName ?? 'A staff member',
        at: row.resolvedAt,
        note: row.resolutionNote,
      };
    if (!ACTIONABLE_TYPES.includes(row.type)) return null;
    if (row.needsAction === false)
      return {
        state: 'resolved' as const,
        source: 'system' as const,
        by: 'System',
        at: null,
        note: null,
      };
    return row.needsAction === true ? { state: 'open' as const } : null;
  }
  async list(c: InboxContext, query: Record<string, unknown> = {}) {
    const page = Number(query.page ?? 1),
      pageSize = Number(query.pageSize ?? 20);
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > 100000 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    )
      throw new BadRequestException('Invalid notification page.');
    const search = String(query.search ?? '').trim();
    if (search.length > 100)
      throw new BadRequestException('Search must be at most 100 characters.');
    const category = query.category ? String(query.category) : null,
      priority = query.priority ? String(query.priority) : null;
    if (
      (category && !NOTIFICATION_CATEGORIES.some((v) => v === category)) ||
      (priority && !NOTIFICATION_PRIORITIES.some((v) => v === priority))
    )
      throw new BadRequestException('Unknown category or priority.');
    const from = this.day(query.from),
      to = this.day(query.to);
    if (from && to && from > to)
      throw new BadRequestException('Start date must not follow end date.');
    const { caps, types } = await this.access(c);
    const matched = types.filter(
      (t) =>
        (!category || NOTIFICATION_REGISTRY[t].category === category) &&
        (!priority || NOTIFICATION_REGISTRY[t].priority === priority),
    );
    return this.db.withTenantTransaction(
      c,
      async (tx) => {
        const property = await tx.$queryRaw<
          { timezone: string; canMarkRead: boolean }[]
        >`SELECT p.timezone,u.email_verified_at IS NOT NULL AS "canMarkRead" FROM properties p JOIN users u ON u.id=${c.userId}::uuid WHERE p.tenant_id=${c.tenantId}::uuid AND p.id=${c.propertyId}::uuid`;
        if (!property[0]) throw new NotFoundException('Property not found.');
        const where = Prisma.sql`type=ANY(${matched}::text[])
    AND (${query.unread === '1' || query.unread === 'true' || query.unread === true} = false OR "readAt" IS NULL)
    AND (${query.needsAction === '1' || query.needsAction === 'true'} = false OR "needsAction" IS DISTINCT FROM false)
    AND (${query.resolved === '1' || query.resolved === 'true'} = false OR ("manuallyResolved" OR (type=ANY(${ACTIONABLE_TYPES}::text[]) AND "needsAction" = false)))
    AND (${from}::date IS NULL OR ("createdAt" AT TIME ZONE ${property[0].timezone})::date>=${from}::date)
    AND (${to}::date IS NULL OR ("createdAt" AT TIME ZONE ${property[0].timezone})::date<=${to}::date)
    AND (${search}='' OR replace(type,'_',' ') ILIKE ${'%' + search + '%'} OR (${caps.includes('bookings.view')} AND (COALESCE(reference,'') ILIKE ${'%' + search + '%'} OR COALESCE("guestName",'') ILIKE ${'%' + search + '%'})))`;
        const items = await tx.$queryRaw<Row[]>(
          Prisma.sql`WITH inbox AS (${this.base(c, types)}) SELECT * FROM inbox WHERE ${where} ORDER BY "createdAt" DESC,id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
        );
        const totals = await tx.$queryRaw<{ total: number }[]>(
          Prisma.sql`WITH inbox AS (${this.base(c, types)}) SELECT count(*)::int AS total FROM inbox WHERE ${where}`,
        );
        const counts = await tx.$queryRaw<
          { unreadTotal: number; critical: number; today: number; needsAction: number }[]
        >(
          Prisma.sql`WITH inbox AS (${this.base(c, types)}) SELECT count(*) FILTER(WHERE "readAt" IS NULL)::int AS "unreadTotal",count(*) FILTER(WHERE type=ANY(${types.filter((t) => String(NOTIFICATION_REGISTRY[t].priority) === 'Critical')}::text[]))::int AS critical,count(*) FILTER(WHERE ("createdAt" AT TIME ZONE ${property[0].timezone})::date=(transaction_timestamp() AT TIME ZONE ${property[0].timezone})::date)::int AS today,count(*) FILTER(WHERE "needsAction" IS DISTINCT FROM false)::int AS "needsAction" FROM inbox`,
        );
        const state = await tx.$queryRaw<
          { version: number }[]
        >`SELECT version FROM notification_inbox_states WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND user_id=${c.userId}::uuid`;
        const clock = await tx.$queryRaw<
          { through: Date }[]
        >`SELECT transaction_timestamp() AS through`;
        return {
          items: items.map((r) => this.present(r, c, caps)),
          page,
          pageSize,
          total: totals[0].total,
          ...counts[0],
          counts: counts[0],
          version: state[0]?.version ?? 0,
          through: clock[0].through,
          canMarkRead: property[0].canMarkRead,
          registry: Object.entries(NOTIFICATION_REGISTRY)
            .filter(([type]) => types.includes(type as NotificationType))
            .map(([type, value]) => ({ type, ...value })),
          categories: NOTIFICATION_CATEGORIES,
          priorities: NOTIFICATION_PRIORITIES,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async detail(c: InboxContext, id: string) {
    if (!NOTIFICATION_UUID.test(id)) throw new BadRequestException('Invalid notification id.');
    const { caps, types } = await this.access(c);
    return this.db.withTenantTransaction(c, async (tx) => {
      const rows = await tx.$queryRaw<Row[]>(
        Prisma.sql`WITH inbox AS (${this.base(c, types)}) SELECT * FROM inbox WHERE id=${id}::uuid`,
      );
      if (!rows[0]) throw new NotFoundException('Notification not found.');
      const shown = this.present(rows[0], c, caps);
      // Who has read an action item is shared only with staff managers; others see their own state.
      const readBy =
        caps.includes('staff.view') && ACTIONABLE_TYPES.includes(rows[0].type)
          ? await tx.$queryRaw<{ name: string | null; readAt: Date }[]>`
              SELECT NULLIF(TRIM(CONCAT_WS(' ',u.first_name,u.last_name)),'') AS name, r.read_at AS "readAt"
              FROM notification_reads r JOIN users u ON u.id=r.user_id
              WHERE r.tenant_id=${c.tenantId}::uuid AND r.property_id=${c.propertyId}::uuid
                AND r.notification_id=${id}::uuid ORDER BY r.read_at LIMIT 50`
          : undefined;
      return readBy ? { ...shown, readBy } : shown;
    });
  }
  async mark(
    c: InboxContext,
    kind: 'all' | 'visible' | 'single',
    body: Record<string, unknown>,
    key: string | undefined,
    id?: string,
  ) {
    if (!key || !/^[\x21-\x7e]{1,128}$/.test(key))
      throw new BadRequestException('A valid Idempotency-Key is required.');
    if (!body || !Number.isSafeInteger(body.version) || Number(body.version) < 0)
      throw new BadRequestException('An inbox version is required.');
    const ids = kind === 'single' ? [id] : body.ids;
    if (
      kind !== 'all' &&
      (!Array.isArray(ids) ||
        !ids.length ||
        ids.length > 100 ||
        ids.some((v) => typeof v !== 'string' || !NOTIFICATION_UUID.test(v)))
    )
      throw new BadRequestException('Select between 1 and 100 valid notifications.');
    const through = kind === 'all' ? new Date(String(body.through)) : null;
    if (
      kind === 'all' &&
      (!through || Number.isNaN(through.getTime()) || through.getTime() > Date.now() + 5000)
    )
      throw new BadRequestException('A valid observed through time is required.');
    const { types } = await this.access(c);
    const hash = createHash('sha256').update(JSON.stringify({ kind, id, body })).digest('hex');
    return this.db.withTenantTransaction(
      c,
      async (tx) => {
        const verified = await tx.$queryRaw<
          { ok: boolean }[]
        >`SELECT email_verified_at IS NOT NULL AS ok FROM users WHERE id=${c.userId}::uuid`;
        if (!verified[0]?.ok)
          throw new ForbiddenException('Verify your email before marking notifications read.');
        await tx.$executeRaw`INSERT INTO notification_inbox_states(tenant_id,property_id,user_id) VALUES(${c.tenantId}::uuid,${c.propertyId}::uuid,${c.userId}::uuid) ON CONFLICT DO NOTHING`;
        const state = await tx.$queryRaw<
          { version: number }[]
        >`SELECT version FROM notification_inbox_states WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND user_id=${c.userId}::uuid FOR UPDATE`;
        const receipt = await tx.$queryRaw<
          { hash: string; response: { updated: number; version: number } }[]
        >`SELECT request_hash AS hash,response FROM notification_operations WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND user_id=${c.userId}::uuid AND idempotency_key=${key}`;
        if (receipt[0]) {
          if (receipt[0].hash !== hash)
            throw new ConflictException('Idempotency-Key already used for a different request.');
          return receipt[0].response;
        }
        if (state[0].version !== body.version)
          throw new ConflictException('Your inbox changed. Reload before marking read.');
        const selected = await tx.$queryRaw<{ id: string }[]>(
          Prisma.sql`WITH inbox AS (${this.base(c, types)}) SELECT id FROM inbox WHERE ${kind === 'all' ? Prisma.sql`"createdAt"<=${through}` : Prisma.sql`id=ANY(${ids as string[]}::uuid[])`}`,
        );
        if (kind !== 'all' && selected.length !== new Set(ids as string[]).size)
          throw new NotFoundException('One or more notifications are unavailable.');
        const updated = selected.length
          ? await tx.$executeRaw`INSERT INTO notification_reads(tenant_id,property_id,user_id,notification_id) SELECT ${c.tenantId}::uuid,${c.propertyId}::uuid,${c.userId}::uuid,n.id FROM notifications n WHERE n.tenant_id=${c.tenantId}::uuid AND n.property_id=${c.propertyId}::uuid AND n.id=ANY(${selected.map((r) => r.id)}::uuid[]) ON CONFLICT DO NOTHING`
          : 0;
        const response = { updated, version: state[0].version + 1 };
        await tx.$executeRaw`UPDATE notification_inbox_states SET version=${response.version} WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND user_id=${c.userId}::uuid`;
        await this.audit.recordInTransaction(tx, {
          ...c,
          actorUserId: c.userId,
          action: 'notifications.mark_read',
          targetType: 'notification_inbox',
          targetId: c.userId,
          details: {
            kind,
            updated,
            beforeVersion: state[0].version,
            afterVersion: response.version,
          },
        });
        await tx.$executeRaw`INSERT INTO notification_operations(tenant_id,property_id,user_id,idempotency_key,request_hash,response) VALUES(${c.tenantId}::uuid,${c.propertyId}::uuid,${c.userId}::uuid,${key},${hash},${JSON.stringify(response)}::jsonb)`;
        return response;
      },
      { timeoutMs: 15000 },
    );
  }
  /** Shared resolution of a needs-action item. Repeating the same call is a harmless no-op. */
  async resolve(c: InboxContext, id: string, body: Record<string, unknown> = {}) {
    return this.changeResolution(c, id, 'resolve', this.note(body?.note));
  }
  async reopen(c: InboxContext, id: string) {
    return this.changeResolution(c, id, 'reopen', null);
  }
  private note(value: unknown) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || value.trim().length > 1000)
      throw new BadRequestException('The note must be text of at most 1000 characters.');
    return value.trim() || null;
  }
  private async changeResolution(
    c: InboxContext,
    id: string,
    action: 'resolve' | 'reopen',
    note: string | null,
  ) {
    if (!NOTIFICATION_UUID.test(id)) throw new BadRequestException('Invalid notification id.');
    const { types } = await this.access(c);
    return this.db.withTenantTransaction(c, async (tx) => {
      const verified = await tx.$queryRaw<
        { ok: boolean }[]
      >`SELECT email_verified_at IS NOT NULL AS ok FROM users WHERE id=${c.userId}::uuid`;
      if (!verified[0]?.ok)
        throw new ForbiddenException('Verify your email before resolving notifications.');
      const rows = await tx.$queryRaw<{ type: NotificationType }[]>(
        Prisma.sql`SELECT n.type FROM notifications n WHERE n.tenant_id=${c.tenantId}::uuid AND n.property_id=${c.propertyId}::uuid AND n.id=${id}::uuid AND n.type=ANY(${types}::text[]) FOR UPDATE`,
      );
      if (!rows[0]) throw new NotFoundException('Notification not found.');
      if (rows[0].type === 'CANCELLATION_REQUESTED') throw new BadRequestException('Decide the request in Approvals.');
      if (!ACTIONABLE_TYPES.includes(rows[0].type))
        throw new BadRequestException('Only needs-action notifications can be resolved.');
      const changed =
        action === 'resolve'
          ? await tx.$executeRaw`INSERT INTO notification_resolutions(tenant_id,property_id,notification_id,resolved_by_user_id,note) VALUES(${c.tenantId}::uuid,${c.propertyId}::uuid,${id}::uuid,${c.userId}::uuid,${note}) ON CONFLICT DO NOTHING`
          : await tx.$executeRaw`DELETE FROM notification_resolutions WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND notification_id=${id}::uuid`;
      if (changed)
        await this.audit.recordInTransaction(tx, {
          ...c,
          actorUserId: c.userId,
          action: action === 'resolve' ? 'notifications.resolve' : 'notifications.reopen',
          targetType: 'notification',
          targetId: id,
          details: { type: rows[0].type, ...(note ? { note } : {}) },
        });
      return { changed: changed > 0, resolved: action === 'resolve' };
    });
  }
  private day(value: unknown) {
    if (value === undefined || value === '') return null;
    const s = String(value);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
      Number.isNaN(Date.parse(s)) ||
      new Date(s).toISOString().slice(0, 10) !== s
    )
      throw new BadRequestException('Use a valid YYYY-MM-DD date.');
    return s;
  }
  async cleanup(c: { tenantId: string; propertyId: string }, now = new Date()) {
    return this.db.withTenantTransaction(c, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${c.tenantId + ':' + c.propertyId + ':notifications-retention'},0))`;
      const cutoff = new Date(now.getTime() - 90 * 86400000);
      const deleted =
        await tx.$executeRaw`DELETE FROM notifications WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND created_at<${cutoff}`;
      const receipts =
        await tx.$executeRaw`DELETE FROM notification_operations WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND created_at<${cutoff}`;
      if (deleted || receipts)
        await this.audit.recordInTransaction(tx, {
          ...c,
          actorUserId: null,
          action: 'notifications.retention',
          targetType: 'property',
          targetId: c.propertyId,
          details: { deleted, receipts, cutoff: cutoff.toISOString() },
        });
      return { deleted, receipts };
    });
  }
}
