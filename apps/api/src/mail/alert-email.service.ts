import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import type { MailBrand } from '@must/domain-contracts';

import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import {
  ownerAlertEmail,
  platformAlertEmail,
  platformDailySummaryEmail,
  refundAlertEmail,
  type AlertEvent,
  type PlatformDailyStats,
} from './alert-email-content';
import { MailDeliveryService } from './mail-delivery.service';
import { staffRecipients } from './notification-recipients';
import type { NotificationTopic } from './notification-topics';
import { addDays, localNow } from './scheduled-email.service';

const QUEUE = 'mail.alerts';
const SCHEDULER = 'alert-emails-every-5-minutes';
export const ALERT_WINDOW_MS = 5 * 60_000;
/** Events are reported once their window has been closed this long (late commits). */
const SETTLE_MS = 60_000;
/** Each sweep re-checks this many windows, so a missed sweep or restart loses nothing. */
const WINDOWS_PER_SWEEP = 3;
const PLATFORM_SUMMARY_HOUR = 7;
const DEFAULT_PLATFORM_TIMEZONE = 'Europe/Tirane';

type Context = { tenantId: string; propertyId: string };

/** The closed alert windows a sweep at `now` covers, oldest first: [start, end). */
export function alertWindows(now: Date): Array<{ start: Date; end: Date }> {
  const lastEnd = Math.floor((now.getTime() - SETTLE_MS) / ALERT_WINDOW_MS) * ALERT_WINDOW_MS;
  return Array.from({ length: WINDOWS_PER_SWEEP }, (_, index) => {
    const start = lastEnd - (WINDOWS_PER_SWEEP - index) * ALERT_WINDOW_MS;
    return { start: new Date(start), end: new Date(start + ALERT_WINDOW_MS) };
  });
}

/**
 * Instant alerts (email plan Step 2b). Every 5 minutes a sweep reads what went wrong
 * across all hotels in the last few 5-minute windows and sends one email per window:
 *
 * - to each property's owners (or whoever the property chose): bookings that need
 *   attention and Clock sync problems ("Problem alerts"), and refunds made;
 * - to the system owner (PLATFORM_ALERT_EMAIL): the same problems for every hotel,
 *   failed or bounced emails, and new hotel signups; plus a daily platform summary.
 *
 * Each email's idempotency key names its window, so re-checking a window never sends
 * twice, and a burst of problems becomes one email instead of many.
 */
@Injectable()
export class AlertEmailService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlertEmailService.name);
  private connection: IORedis | null = null;
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(MailDeliveryService) private readonly delivery: MailDeliveryService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Tests call sweep() directly; a background sweep would email about every test tenant.
    if (process.env.NODE_ENV === 'test') return;
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      this.logger.warn('REDIS_URL is not set: alert emails will not be sent.');
      return;
    }
    this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue(QUEUE, { connection: this.connection });
    this.worker = new Worker(QUEUE, () => this.sweep(), {
      connection: this.connection,
      concurrency: 1,
    });
    this.worker.on('error', (error) =>
      this.logger.error(`Alert email worker error: ${error.message}`, error.stack),
    );
    await this.queue.upsertJobScheduler(
      SCHEDULER,
      { every: ALERT_WINDOW_MS },
      { name: 'sweep', data: {}, opts: { removeOnComplete: true, removeOnFail: 100 } },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.connection?.disconnect();
  }

  async sweep(now = new Date()): Promise<void> {
    const windows = alertWindows(now);
    const events = await this.database.$queryRaw<AlertEvent[]>`
      SELECT "tenantId"::text, "propertyId"::text, "tenantName", "propertyName", kind, "itemId",
        reference, detail, "occurredAt"
      FROM "notification_alert_events"(${windows[0]!.start}::timestamptz, ${windows.at(-1)!.end}::timestamptz)
    `;
    for (const window of windows) {
      const inWindow = events.filter(
        (event) => event.occurredAt >= window.start && event.occurredAt < window.end,
      );
      if (!inWindow.length) continue;
      await this.sendPropertyAlerts(inWindow, window.start);
      await this.safely('platform alert', () => this.sendPlatformAlert(inWindow, window.start));
    }
    await this.safely('platform daily summary', () => this.sendPlatformSummary(now));
  }

  private async sendPropertyAlerts(events: AlertEvent[], windowStart: Date): Promise<void> {
    const byProperty = new Map<string, AlertEvent[]>();
    for (const event of events) {
      if (!event.propertyId || event.kind === 'new_hotel' || event.kind === 'email_failed')
        continue;
      const key = `${event.tenantId}/${event.propertyId}`;
      byProperty.set(key, [...(byProperty.get(key) ?? []), event]);
    }
    for (const propertyEvents of byProperty.values()) {
      const context = {
        tenantId: propertyEvents[0]!.tenantId,
        propertyId: propertyEvents[0]!.propertyId!,
      };
      const refunds = propertyEvents.filter((event) => event.kind === 'refund');
      const problems = propertyEvents.filter((event) => event.kind !== 'refund');
      await this.safely(`alerts for property ${context.propertyId}`, async () => {
        await this.sendToStaff(context, 'owner_alerts', problems, windowStart);
        await this.sendToStaff(context, 'refund_processed', refunds, windowStart);
      });
    }
  }

  private async sendToStaff(
    context: Context,
    topic: NotificationTopic,
    events: AlertEvent[],
    windowStart: Date,
  ): Promise<void> {
    if (!events.length) return;
    const work = await this.database.withTenantTransaction(context, async (tx) => {
      const recipients = await staffRecipients(tx, context, topic);
      if (!recipients.length) return null;
      const rows = await tx.$queryRaw<Array<MailBrand & { timezone: string | null }>>`
        SELECT name, logo_url AS "logoUrl", support_email AS "supportEmail", phone,
          public_website_origin AS "websiteUrl", address, timezone
        FROM properties WHERE tenant_id = ${context.tenantId}::uuid AND id = ${context.propertyId}::uuid
      `;
      return { recipients, property: rows[0]! };
    });
    if (!work) return;
    const { timezone, ...brand } = work.property;
    const render = topic === 'refund_processed' ? refundAlertEmail : ownerAlertEmail;
    const prefix = topic === 'refund_processed' ? 'refund-alert' : 'owner-alert';
    for (const recipient of work.recipients) {
      const email = render(events, recipient.email, brand, timezone || 'UTC', this.dashboardUrl());
      await this.delivery.dispatch(
        'rendered',
        {
          ...email,
          idempotencyKey: `${prefix}/${context.propertyId}/${windowStart.toISOString()}/${recipient.staffUserId}`,
        },
        context,
      );
    }
  }

  private async sendPlatformAlert(events: AlertEvent[], windowStart: Date): Promise<void> {
    const to = this.platformAlertEmail();
    if (!to) return;
    // Refunds are routine for the hotel; the system owner hears about problems only.
    const relevant = events.filter((event) => event.kind !== 'refund');
    if (!relevant.length) return;
    const email = platformAlertEmail(relevant, to, this.platformTimeZone(), this.dashboardUrl());
    await this.delivery.dispatch(
      'rendered',
      { ...email, idempotencyKey: `platform-alert/${windowStart.toISOString()}` },
      { tenantId: null, propertyId: null },
    );
  }

  async sendPlatformSummary(now: Date): Promise<void> {
    const to = this.platformAlertEmail();
    if (!to) return;
    const timeZone = this.platformTimeZone();
    const local = localNow(now, timeZone);
    if (local.hour < PLATFORM_SUMMARY_HOUR) return;
    const day = addDays(local.date, -1);
    const key = `platform-daily-summary/${day}`;
    const logged = await this.database.withPlatformMailTransaction(
      (tx) => tx.$queryRaw<unknown[]>`
        SELECT 1 FROM email_messages WHERE tenant_id IS NULL AND idempotency_key = ${key}
      `,
    );
    if (logged.length) return;
    const [stats] = await this.database.$queryRaw<PlatformDailyStats[]>`
      SELECT * FROM "platform_daily_stats"(${day}::date, ${timeZone})
    `;
    const email = platformDailySummaryEmail(stats!, day, to, this.dashboardUrl());
    await this.delivery.dispatch(
      'rendered',
      { ...email, idempotencyKey: key },
      { tenantId: null, propertyId: null },
    );
  }

  private async safely(what: string, operation: () => Promise<void>): Promise<void> {
    try {
      await operation();
    } catch (error) {
      this.logger.error(
        `Could not send ${what}.`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private platformAlertEmail(): string | null {
    return process.env.PLATFORM_ALERT_EMAIL?.trim() || null;
  }

  private platformTimeZone(): string {
    const zone = process.env.PLATFORM_TIMEZONE?.trim() || DEFAULT_PLATFORM_TIMEZONE;
    try {
      new Intl.DateTimeFormat('en', { timeZone: zone });
      return zone;
    } catch {
      return DEFAULT_PLATFORM_TIMEZONE;
    }
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
