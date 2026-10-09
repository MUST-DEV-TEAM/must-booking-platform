import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import type { MailBrand } from '@must/domain-contracts';

import { TenantDatabaseService, type TenantTransaction } from '../tenancy/tenant-database.service';
import { renderTemplate, savedTemplate, stayTemplateValues } from './email-templates';
import { MailDeliveryService } from './mail-delivery.service';
import { scheduledGuestSettings, staffRecipients } from './notification-recipients';
import {
  ownerDailySummaryEmail,
  preArrivalEmail,
  type OwnerDailySummary,
  type PreArrivalStay,
} from './scheduled-email-content';

const QUEUE = 'mail.scheduled';
const SCHEDULER = 'scheduled-emails-every-15-minutes';
const SWEEP_INTERVAL_MS = 15 * 60_000;
/** Local hour (property time zone) from which each email may go out that day. */
const OWNER_SUMMARY_HOUR = 7;
const PRE_ARRIVAL_HOUR = 9;

type Context = { tenantId: string; propertyId: string };
type PropertyRow = {
  name: string;
  logoUrl: string | null;
  supportEmail: string | null;
  phone: string | null;
  websiteUrl: string | null;
  address: string | null;
  checkInTime: string | null;
};
type StayRow = {
  id: string;
  groupKey: string;
  reference: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  startsOn: string;
  endsOn: string;
  roomName: string;
  guestCount: number;
  paymentMethod: string;
  amount: string;
  currency: string;
};

/** The calendar date and hour right now in a time zone (UTC if the zone is unknown). */
export function localNow(now: Date, timeZone: string | null): { date: string; hour: number } {
  const format = (zone: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = format(timeZone || 'UTC');
  } catch {
    parts = format('UTC');
  }
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return { date: `${part('year')}-${part('month')}-${part('day')}`, hour: Number(part('hour')) };
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

/**
 * Time-based emails (email plan Step 2a): the guest pre-arrival reminder and the
 * owner's daily summary. A sweep runs every 15 minutes, visits every property in its
 * own time zone, and sends what is due today. Each email has a fixed idempotency key
 * (booking/order, or property + date + owner), so repeated sweeps send it once.
 * Both are switched per property in the notification settings.
 */
@Injectable()
export class ScheduledEmailService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScheduledEmailService.name);
  private connection: IORedis | null = null;
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(MailDeliveryService) private readonly delivery: MailDeliveryService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Tests call sweep() directly; a background sweep would email every test tenant.
    if (process.env.NODE_ENV === 'test') return;
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      this.logger.warn('REDIS_URL is not set: scheduled emails will not be sent.');
      return;
    }
    this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue(QUEUE, { connection: this.connection });
    this.worker = new Worker(QUEUE, () => this.sweep(), {
      connection: this.connection,
      concurrency: 1,
    });
    this.worker.on('error', (error) =>
      this.logger.error(`Scheduled email worker error: ${error.message}`, error.stack),
    );
    await this.queue.upsertJobScheduler(
      SCHEDULER,
      { every: SWEEP_INTERVAL_MS },
      { name: 'sweep', data: {}, opts: { removeOnComplete: true, removeOnFail: 100 } },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.connection?.disconnect();
  }

  async sweep(now = new Date()): Promise<void> {
    const properties = await this.database.$queryRaw<
      Array<{ tenantId: string; propertyId: string; timezone: string | null }>
    >`SELECT "tenantId", "propertyId", "timezone" FROM "scheduled_email_properties"()`;
    for (const property of properties) {
      const context = { tenantId: property.tenantId, propertyId: property.propertyId };
      const local = localNow(now, property.timezone);
      try {
        if (local.hour >= OWNER_SUMMARY_HOUR)
          await this.sendOwnerSummary(context, property.timezone || 'UTC', local.date);
        if (local.hour >= PRE_ARRIVAL_HOUR)
          await this.sendPreArrival(context, property.timezone || 'UTC', local.date);
      } catch (error) {
        this.logger.error(
          `Scheduled emails failed for property ${property.propertyId}.`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }

  async sendPreArrival(context: Context, timeZone: string, today: string): Promise<void> {
    const work = await this.database.withTenantTransaction(context, async (tx) => {
      const settings = await scheduledGuestSettings(tx, context, 'pre_arrival');
      if (!settings.enabled) return null;
      const arrival = addDays(today, settings.daysOffset);
      // Direct bookings only: Clock-imported reservations (references CLOCK-…) can come
      // from other sales channels whose guests we have no permission to email.
      // Bookings made today are skipped; they just got their confirmation.
      const rows = await tx.$queryRaw<StayRow[]>`
        SELECT b.id::text, COALESCE(b.order_reference, b.id::text) AS "groupKey",
          COALESCE(b.order_reference, b.external_reference) AS reference,
          g.email, g.first_name AS "firstName", g.last_name AS "lastName",
          b.starts_on::text AS "startsOn", b.ends_on::text AS "endsOn",
          COALESCE(r.name, rt.name) AS "roomName", (b.adults + b.children) AS "guestCount",
          b.payment_method::text AS "paymentMethod", b.total_amount::text AS amount, rp.currency
        FROM bookings b
        JOIN guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
        JOIN rate_plans rp ON rp.tenant_id = b.tenant_id AND rp.property_id = b.property_id AND rp.id = b.rate_plan_id
        JOIN room_types rt ON rt.tenant_id = b.tenant_id AND rt.property_id = b.property_id AND rt.id = b.room_type_id
        LEFT JOIN rooms r ON r.tenant_id = b.tenant_id AND r.property_id = b.property_id AND r.id = b.room_id
        WHERE b.tenant_id = ${context.tenantId}::uuid AND b.property_id = ${context.propertyId}::uuid
          AND b.status = 'CONFIRMED'::"BookingStatus" AND b.starts_on = ${arrival}::date
          AND b.external_reference NOT LIKE 'CLOCK-%'
          AND (b.created_at AT TIME ZONE ${timeZone})::date < ${today}::date
          AND COALESCE(g.email, '') <> ''
        ORDER BY "groupKey", b.order_room_number NULLS FIRST, b.id
      `;
      if (!rows.length) return null;
      return {
        brand: await this.brand(tx, context),
        stays: this.groupStays(rows),
        template: await savedTemplate(tx, context, 'pre_arrival'),
      };
    });
    if (!work) return;
    for (const stay of work.stays) {
      const message = renderTemplate(
        'pre_arrival',
        work.template,
        stayTemplateValues({
          guestName: stay.guestName,
          hotelName: work.brand.name || 'the hotel',
          reference: stay.reference,
          startsOn: stay.startsOn,
          endsOn: stay.endsOn,
          roomName: stay.rooms.map((room) => room.roomName).join(', '),
          guestCount: stay.rooms.reduce((sum, room) => sum + room.guestCount, 0),
        }),
      );
      const email = preArrivalEmail(stay, work.brand, message);
      await this.delivery.dispatch(
        'rendered',
        { ...email, idempotencyKey: `pre-arrival/${stay.bookingId}` },
        context,
      );
    }
  }

  async sendOwnerSummary(context: Context, timeZone: string, today: string): Promise<void> {
    const work = await this.database.withTenantTransaction(context, async (tx) => {
      const recipients = await staffRecipients(tx, context, 'owner_daily_summary');
      if (!recipients.length) return null;
      const pending = [];
      for (const recipient of recipients) {
        const key = `owner-daily-summary/${context.propertyId}/${today}/${recipient.staffUserId}`;
        if (!(await this.alreadyLogged(tx, context, key))) pending.push({ ...recipient, key });
      }
      if (!pending.length) return null;
      return {
        pending,
        brand: await this.brand(tx, context),
        summary: await this.ownerSummary(tx, context, timeZone, today),
      };
    });
    if (!work) return;
    const dashboardUrl = this.dashboardUrl();
    for (const recipient of work.pending) {
      const email = ownerDailySummaryEmail(work.summary, recipient.email, work.brand, dashboardUrl);
      await this.delivery.dispatch(
        'rendered',
        { ...email, idempotencyKey: recipient.key },
        context,
      );
    }
  }

  private async ownerSummary(
    tx: TenantTransaction,
    context: Context,
    timeZone: string,
    today: string,
  ): Promise<OwnerDailySummary> {
    const yesterday = addDays(today, -1);
    const stays = await tx.$queryRaw<
      Array<{ kind: string; guestName: string; roomName: string; nights: number }>
    >`
      SELECT CASE WHEN b.starts_on = ${today}::date THEN 'arrival'
          WHEN b.ends_on = ${today}::date THEN 'departure' ELSE 'in_house' END AS kind,
        COALESCE(NULLIF(TRIM(CONCAT_WS(' ', g.first_name, g.last_name)), ''), g.email, b.external_reference) AS "guestName",
        COALESCE(r.name, rt.name) AS "roomName", (b.ends_on - b.starts_on) AS nights
      FROM bookings b
      LEFT JOIN guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
      JOIN room_types rt ON rt.tenant_id = b.tenant_id AND rt.property_id = b.property_id AND rt.id = b.room_type_id
      LEFT JOIN rooms r ON r.tenant_id = b.tenant_id AND r.property_id = b.property_id AND r.id = b.room_id
      WHERE b.tenant_id = ${context.tenantId}::uuid AND b.property_id = ${context.propertyId}::uuid
        AND b.status = 'CONFIRMED'::"BookingStatus"
        AND b.starts_on <= ${today}::date AND b.ends_on >= ${today}::date
      ORDER BY b.starts_on, "guestName"
    `;
    const created = await tx.$queryRaw<
      Array<{ count: number; amount: string | null; currency: string | null }>
    >`
      SELECT COUNT(*)::int AS count, SUM(b.total_amount)::text AS amount, rp.currency
      FROM bookings b
      JOIN rate_plans rp ON rp.tenant_id = b.tenant_id AND rp.property_id = b.property_id AND rp.id = b.rate_plan_id
      WHERE b.tenant_id = ${context.tenantId}::uuid AND b.property_id = ${context.propertyId}::uuid
        AND b.status = 'CONFIRMED'::"BookingStatus"
        AND (b.created_at AT TIME ZONE ${timeZone})::date = ${yesterday}::date
      GROUP BY rp.currency ORDER BY rp.currency
    `;
    const cancelled = await tx.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count FROM bookings b
      WHERE b.tenant_id = ${context.tenantId}::uuid AND b.property_id = ${context.propertyId}::uuid
        AND b.status = 'CANCELLED'::"BookingStatus"
        AND (b.updated_at AT TIME ZONE ${timeZone})::date = ${yesterday}::date
    `;
    return {
      date: today,
      arrivals: stays
        .filter((s) => s.kind === 'arrival')
        .map(({ guestName, roomName, nights }) => ({ guestName, roomName, nights })),
      departures: stays
        .filter((s) => s.kind === 'departure')
        .map(({ guestName, roomName }) => ({ guestName, roomName })),
      // Staying tonight: arrived today or earlier and not leaving today.
      inHouse: stays.filter((s) => s.kind !== 'departure').length,
      newBookings: {
        count: created.reduce((sum, row) => sum + row.count, 0),
        revenue: created
          .filter((row) => row.amount && row.currency)
          .map((row) => ({ amount: row.amount!, currency: row.currency! })),
      },
      cancellations: cancelled[0]?.count ?? 0,
    };
  }

  private groupStays(rows: StayRow[]): PreArrivalStay[] {
    const groups = new Map<string, StayRow[]>();
    for (const row of rows) groups.set(row.groupKey, [...(groups.get(row.groupKey) ?? []), row]);
    return [...groups.values()].map((group) => {
      const first = group[0]!;
      const payAtHotel = first.paymentMethod === 'PAY_AT_HOTEL';
      const total = group.reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0);
      return {
        bookingId: first.id,
        reference: first.reference,
        guestEmail: first.email,
        guestName:
          [first.firstName, first.lastName].filter(Boolean).join(' ').trim() || first.email,
        startsOn: first.startsOn,
        endsOn: first.endsOn,
        rooms: group.map((row) => ({ roomName: row.roomName, guestCount: Number(row.guestCount) })),
        dueAtHotel: payAtHotel
          ? { amount: (total / 100).toFixed(2), currency: first.currency }
          : null,
      };
    });
  }

  private async brand(
    tx: TenantTransaction,
    context: Context,
  ): Promise<MailBrand & { checkInTime: string | null }> {
    const rows = await tx.$queryRaw<PropertyRow[]>`
      SELECT name, logo_url AS "logoUrl", support_email AS "supportEmail", phone,
        public_website_origin AS "websiteUrl", address, check_in_time AS "checkInTime"
      FROM properties WHERE tenant_id = ${context.tenantId}::uuid AND id = ${context.propertyId}::uuid
    `;
    const row = rows[0]!;
    return { ...row };
  }

  private async alreadyLogged(tx: TenantTransaction, context: Context, key: string) {
    const rows = await tx.$queryRaw<unknown[]>`
      SELECT 1 FROM email_messages
      WHERE tenant_id = ${context.tenantId}::uuid AND idempotency_key = ${key}
    `;
    return rows.length > 0;
  }

  private dashboardUrl(): string | null {
    const base = process.env.WEB_APP_URL?.trim();
    if (!base) return null;
    try {
      return new URL('/dashboard', base).toString();
    } catch {
      return null;
    }
  }
}
