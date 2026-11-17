import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';

import { reportOperationalFailure } from '../../observability/error-tracking';
import { NotificationsService } from '../../tenancy/notifications.service';
import {
  TenantDatabaseService,
  type TenantTransaction,
} from '../../tenancy/tenant-database.service';

const QUEUE = 'clock.stale-stay-check';
const SCHEDULER = 'clock-stale-stay-check-daily';
const JOB = 'check-stale-stays';
/** 04:30 UTC, after the nightly refund checks. */
const DAILY = '30 4 * * *';
/** A stay still "expected" this many days after arrival is flagged. */
export const STALE_AFTER_DAYS = 2;
/** Older arrivals are not flagged (a one-time clean-up decision, not a daily list). */
export const STALE_WINDOW_DAYS = 60;
const MAXIMUM_PER_HOTEL = 200;
/** The kind on the review note, so a repeat updates one note instead of adding another. */
export const STAY_STILL_EXPECTED = 'STAY_STILL_EXPECTED';

type Scope = { tenantId: string; propertyId: string };
type Stale = { id: string; reference: string | null; startsOn: string };

export type StaleStaySummary = { hotels: number; flagged: number; resolved: number };

/**
 * Once a day, for every Clock hotel: a confirmed booking whose arrival was more than two days ago and that Clock
 * still shows as "expected" (never checked in, no-show or cancelled) gets one review note and one bell notice, so
 * reception can correct it in Clock. It reads only what MUST already stores from Clock; nothing is read from or
 * written to Clock. The note closes by itself when the booking's status changes.
 */
@Injectable()
export class ClockStaleStayCheckService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClockStaleStayCheckService.name);
  private connection: ConnectionOptions | undefined;
  private queue: Queue | undefined;
  private worker: Worker | undefined;

  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.connection = this.bullConnection(process.env.REDIS_URL!);
    this.queue = new Queue(QUEUE, { connection: this.connection });
    this.worker = new Worker(QUEUE, () => this.run(), {
      connection: this.connection,
      concurrency: 1,
    });
    this.worker.on('error', (error) =>
      this.logger.error('Stale stay check worker error.', error.stack),
    );
    await this.queue.upsertJobScheduler(
      SCHEDULER,
      { pattern: DAILY, tz: 'UTC' },
      {
        name: JOB,
        data: {},
        opts: {
          attempts: 2,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: true,
          removeOnFail: 30,
        },
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  async run(): Promise<StaleStaySummary> {
    const hotels = await this.database.withPlatformAdminTransaction(
      { role: 'platform_admin' },
      (tx) => tx.$queryRaw<Scope[]>`SELECT * FROM clock_connected_properties()`,
    );
    const summary: StaleStaySummary = { hotels: hotels.length, flagged: 0, resolved: 0 };
    for (const hotel of hotels) {
      try {
        const result = await this.checkHotel(hotel);
        summary.flagged += result.flagged;
        summary.resolved += result.resolved;
      } catch (error) {
        reportOperationalFailure(error instanceof Error ? error : new Error(String(error)), {
          component: 'clock',
          operation: 'stale-stay-check',
          tenantId: hotel.tenantId,
          propertyId: hotel.propertyId,
        });
      }
    }
    this.logger.log(`Stale stay check: ${JSON.stringify(summary)}`);
    return summary;
  }

  async checkHotel(scope: Scope): Promise<{ flagged: number; resolved: number }> {
    return this.database.withTenantTransaction(scope, async (tx) => {
      const stale = await this.staleStays(tx, scope);
      let flagged = 0;
      for (const stay of stale) {
        const message = `Booking ${stay.reference ?? stay.id} is still "expected" in Clock ${STALE_AFTER_DAYS}+ days after arrival.`;
        const staffMessage = `Booking ${stay.reference ?? ''} arrived on ${stay.startsOn} but Clock still shows it as expected (not checked in, no-show or cancelled). In Clock, set what really happened to this booking. This note closes by itself when its status changes.`;
        // Inserted directly, once per booking: the shared review helper also raises an error-tracker alert per
        // note, which a daily list of ordinary housekeeping must not do.
        const inserted = await tx.$executeRaw`
          INSERT INTO manual_review_items (tenant_id, property_id, category, reference_type, reference_id, message, context)
          SELECT ${scope.tenantId}::uuid, ${scope.propertyId}::uuid, 'UNKNOWN_STATUS'::"ManualReviewCategory", 'booking', ${stay.id},
            ${message}, ${JSON.stringify({ kind: STAY_STILL_EXPECTED, staffMessage, arrival: stay.startsOn })}::jsonb
          WHERE NOT EXISTS (
            SELECT 1 FROM manual_review_items WHERE tenant_id = ${scope.tenantId}::uuid AND property_id = ${scope.propertyId}::uuid
              AND reference_type = 'booking' AND reference_id = ${stay.id} AND status = 'OPEN'
              AND context->>'kind' = ${STAY_STILL_EXPECTED})`;
        if (inserted === 0) continue;
        await this.notifications.recordInTransaction(tx, {
          ...scope,
          type: 'BOOKING_NEEDS_ATTENTION',
          payload: { bookingId: stay.id, reason: 'stay_still_expected' },
        });
        flagged += 1;
      }
      // A note whose booking now has a real status (or is cancelled, or fell out of the window) is closed.
      const resolved = await tx.$executeRaw`
        UPDATE manual_review_items m SET status = 'RESOLVED', resolved_at = now(), updated_at = now()
        WHERE m.tenant_id = ${scope.tenantId}::uuid AND m.property_id = ${scope.propertyId}::uuid
          AND m.reference_type = 'booking' AND m.status = 'OPEN'
          AND m.context->>'kind' = ${STAY_STILL_EXPECTED}
          AND NOT EXISTS (
            SELECT 1 FROM bookings b WHERE b.tenant_id = m.tenant_id AND b.property_id = m.property_id
              AND b.id::text = m.reference_id AND b.status = 'CONFIRMED'
              AND COALESCE(b.pms_stay_status, 'expected') = 'expected')`;
      return { flagged, resolved };
    });
  }

  private staleStays(tx: TenantTransaction, scope: Scope): Promise<Stale[]> {
    return tx.$queryRaw<Stale[]>`
      SELECT b.id::text AS id, b.external_reference AS reference, b.starts_on::text AS "startsOn"
      FROM bookings b JOIN properties p ON p.tenant_id = b.tenant_id AND p.id = b.property_id
      WHERE b.tenant_id = ${scope.tenantId}::uuid AND b.property_id = ${scope.propertyId}::uuid
        AND b.status = 'CONFIRMED' AND b.external_booking_id IS NOT NULL
        AND COALESCE(b.pms_stay_status, 'expected') = 'expected'
        AND b.starts_on < (now() AT TIME ZONE p.timezone)::date - ${STALE_AFTER_DAYS}::int
        AND b.starts_on >= (now() AT TIME ZONE p.timezone)::date - ${STALE_WINDOW_DAYS}::int
      ORDER BY b.starts_on ASC LIMIT ${MAXIMUM_PER_HOTEL}`;
  }

  private bullConnection(redisUrl: string): ConnectionOptions {
    const url = new URL(redisUrl);
    return {
      host: url.hostname,
      port: Number(url.port || 6379),
      username: url.username || undefined,
      password: url.password || undefined,
      tls: url.protocol === 'rediss:' ? {} : undefined,
      maxRetriesPerRequest: null,
    };
  }
}
