import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  TenantDatabaseService,
  type TenantTransaction,
} from '../../tenancy/tenant-database.service';
import { BookingCancellationNotificationService } from '../../mail/booking-cancellation-notification.service';
import {
  BookingUpdateNotificationService,
  type PreviousStay,
} from '../../mail/booking-update-notification.service';
import { reportOperationalFailure } from '../../observability/error-tracking';
import { IntegrationConnectionsService } from '../integration-connections.service';
import { ManualReviewService } from '../manual-review.service';
import { localStatusForClockStatus } from './clock-booking-status';
import {
  guardedTransitionSql,
  ownershipLockSql,
  ownsRow,
  type OwnershipRow,
} from './clock-provider-event-status';
import { ClockCircuitBreakerService, CircuitOpenError } from './clock-circuit-breaker';
import { parseClockCredentials } from './clock-credentials';
import {
  classifyClockClientFailure,
  classifyClockHttpResponse,
} from './clock-error-classification';
import {
  ClockHttpClient,
  ClockHttpError,
  type ClockConnectionCredentials,
} from './clock-http-client';
import { ClockRateLimiterService } from './clock-rate-limiter';
import { resolveBookingOccupancy } from '../../booking/booking-occupancy';

// CONFIRMED_IN_SANDBOX 2026-09-03 against a real GET /bookings/{id} response
// (Empire Beach Resort) — see docs/CLOCK_WEBHOOK_FLOW.md. Only the fields
// this service actually reads; the real response carries many more.
export interface ClockBookingDetail {
  id: number;
  number?: string | null;
  arrival: string;
  departure: string;
  status: string;
  adults?: number | null;
  children?: number | null;
  arrival_room_type_id?: number | null;
  arrival_room_id?: number | null;
  current_room_id?: number | null;
  total_booking_value?: { cents: number; currency: string } | null;
  rate_calculation?: Array<{ date: string; cents: number; currency: string }> | null;
  guest_e_mail?: string | null;
  guest_first_name?: string | null;
  guest_last_name?: string | null;
  guest_phone_number?: string | null;
}

export function isClockBookingDetail(value: unknown): value is ClockBookingDetail {
  if (!value || typeof value !== 'object') return false;
  const detail = value as Record<string, unknown>;
  return (
    typeof detail.id === 'number' &&
    typeof detail.arrival === 'string' &&
    typeof detail.departure === 'string' &&
    typeof detail.status === 'string'
  );
}

export type HydrationOutcome =
  | {
      outcome: 'created' | 'updated';
      bookingId: string;
      cancelledInPms: boolean;
      /** Set when a confirmed booking's dates or room type changed at Clock. */
      changedFrom?: PreviousStay;
    }
  | { outcome: 'missing_room_type_mapping' }
  | { outcome: 'unknown_status' }
  | { outcome: 'no_active_connection' }
  | { outcome: 'ownership_lost' };

/** Identifies the provider_events row and fencing token (ADR-0031) a caller
 * currently holds. When supplied, hydrateBooking validates ownership under
 * a real row lock as the first statement inside its own effect-applying
 * transaction (not a preceding, separately-committed check), and — only if
 * ownership still holds — writes the event's terminal status in that same
 * transaction, so the local effect and the event outcome commit together
 * or not at all. Omit it to hydrate without any event-ownership fencing
 * (e.g. a direct call from reconciliation tooling, not the webhook path). */
export interface EventOwnership {
  eventRowId: string;
  token: string;
}

/**
 * Mirrors a single Clock booking into MUST's local `bookings` table
 * regardless of whether MUST created it — the "Fetch full object -> Normalize
 * -> Apply" steps of the source brief's webhook pipeline (Milestone 12 Tasks
 * 16/17), combined here since both are small for a single booking. Product
 * decision (owner, 2026-09-03): Clock-only bookings (walk-ins, phone
 * bookings, OTA-synced reservations) are mirrored in fully, counted the same
 * as any MUST-created booking in KPIs/revenue — not a read-only shadow.
 *
 * Idempotent: upserts on the (tenant, property, external_booking_id) unique
 * key, so re-processing the same Clock booking (a retried job, a later
 * booking_guests_update event for a booking already hydrated by booking_new)
 * updates the same row rather than creating a duplicate.
 */
@Injectable()
export class ClockBookingHydrationService {
  private readonly logger = new Logger(ClockBookingHydrationService.name);

  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(IntegrationConnectionsService)
    private readonly connections: IntegrationConnectionsService,
    @Inject(ManualReviewService) private readonly manualReview: ManualReviewService,
    @Inject(ClockHttpClient) private readonly client: ClockHttpClient,
    @Inject(ClockRateLimiterService) private readonly rateLimiter: ClockRateLimiterService,
    @Inject(ClockCircuitBreakerService) private readonly circuitBreaker: ClockCircuitBreakerService,
    @Inject(BookingCancellationNotificationService)
    private readonly cancellations: BookingCancellationNotificationService,
    @Inject(BookingUpdateNotificationService)
    private readonly updates: BookingUpdateNotificationService,
  ) {}

  async hydrateBooking(
    tenantId: string,
    propertyId: string,
    connectionId: string,
    clockBookingId: string,
    ownership?: EventOwnership,
  ): Promise<HydrationOutcome> {
    const connection = await this.connections.activePmsConnectionCredentials(tenantId, propertyId);
    if (!connection || connection.provider !== 'CLOCK_PMS') {
      this.logger.warn(
        `Clock booking hydration skipped for property ${propertyId}: no active Clock connection.`,
      );
      return { outcome: 'no_active_connection' };
    }
    const parsed = parseClockCredentials(connection.credentials);
    if (!parsed.ok) {
      this.logger.warn(`Clock booking hydration skipped: ${parsed.message}`);
      return { outcome: 'no_active_connection' };
    }

    // Outbound HTTP stays outside the locked transaction below (ADR-0031) —
    // holding a Postgres row lock across a real network round-trip to Clock
    // would tie up a connection for however long that call takes.
    const detail = await this.fetchClock<ClockBookingDetail>(
      parsed.value,
      `/bookings/${clockBookingId}`,
    );

    const outcome = await this.database.withTenantTransaction<HydrationOutcome>(
      { tenantId, propertyId },
      async (tx) => {
        if (ownership) {
          // Real fencing, not a preceding check: this row lock is held for
          // the rest of this transaction, so no concurrent claim/finalize
          // from another attempt can interleave between this validation and
          // the effect + status write committing together below.
          const [lockSql, lockParams] = ownershipLockSql(tenantId, ownership.eventRowId);
          const ownershipRows = await tx.$queryRawUnsafe<OwnershipRow[]>(lockSql, ...lockParams);
          if (!ownsRow(ownershipRows[0], ownership.token)) return { outcome: 'ownership_lost' };
        }

        const existingRows = await tx.$queryRawUnsafe<
          Array<{ status: string; startsOn: string; endsOn: string; roomTypeId: string }>
        >(
          `SELECT status::text AS status, starts_on::text AS "startsOn", ends_on::text AS "endsOn",
             room_type_id::text AS "roomTypeId" FROM bookings
         WHERE tenant_id = $1::uuid AND property_id = $2::uuid AND external_booking_id = $3
         FOR UPDATE`,
          tenantId,
          propertyId,
          String(detail.id),
        );
        const existing = existingRows[0];
        const mappedStatus = localStatusForClockStatus(detail.status);
        if (
          !mappedStatus &&
          !(await this.hasOpenUnknownStatusReview(tx, tenantId, propertyId, detail))
        )
          await this.manualReview.recordInTransaction(tx, {
            tenantId,
            propertyId,
            connectionId,
            category: 'UNKNOWN_STATUS',
            referenceType: 'clock_booking',
            referenceId: String(detail.id),
            message: existing
              ? `Clock booking ${detail.number ?? detail.id} has status "${detail.status}", which MUST does not recognise. The booking keeps its current status (${existing.status}); check it in Clock.`
              : `Clock booking ${detail.number ?? detail.id} has status "${detail.status}", which MUST does not recognise, so it was not imported. Check it in Clock, then re-send the event.`,
            context: { clockStatus: detail.status },
          });
        if (!mappedStatus && !existing) {
          if (ownership) await this.finalizeOwnedEvent(tx, tenantId, ownership, 'FAILED');
          return { outcome: 'unknown_status' };
        }

        const roomTypeId = await this.mappedEntityId(
          tx,
          tenantId,
          propertyId,
          'ROOM_TYPE',
          detail.arrival_room_type_id,
        );
        if (!roomTypeId) {
          await this.manualReview.recordInTransaction(tx, {
            tenantId,
            propertyId,
            connectionId,
            category: 'MISSING_MAPPING',
            referenceType: 'clock_booking',
            referenceId: String(detail.id),
            message: `Clock booking ${detail.number ?? detail.id} references room type ${detail.arrival_room_type_id}, which has no confirmed local mapping. Confirm the mapping in Catalog Sync, then re-send the event.`,
          });
          if (ownership) await this.finalizeOwnedEvent(tx, tenantId, ownership, 'FAILED');
          return { outcome: 'missing_room_type_mapping' };
        }

        const ratePlanId = await this.shadowRatePlanId(
          tx,
          tenantId,
          propertyId,
          roomTypeId,
          detail.arrival_room_type_id,
          detail.total_booking_value?.currency ?? 'EUR',
        );
        const roomId = await this.mappedEntityId(
          tx,
          tenantId,
          propertyId,
          'ROOM',
          detail.current_room_id ?? detail.arrival_room_id,
        );
        const guestId = await this.resolveGuest(tx, tenantId, detail);

        // An unrecognised status keeps the booking's current local status.
        const status = mappedStatus ?? existing!.status;
        const totalAmount = ((detail.total_booking_value?.cents ?? 0) / 100).toFixed(2);
        const occupancy = resolveBookingOccupancy({
          adults:
            detail.adults != null && Number.isInteger(detail.adults) && detail.adults >= 1
              ? detail.adults
              : undefined,
          children:
            detail.children != null && Number.isInteger(detail.children) && detail.children >= 0
              ? detail.children
              : undefined,
        });
        const externalReference = `CLOCK-${detail.number ?? detail.id}`;
        const nightlyRates = (detail.rate_calculation ?? []).map((night) => ({
          date: night.date,
          amount: (night.cents / 100).toFixed(2),
        }));

        const rows = await tx.$queryRawUnsafe<Array<{ id: string; inserted: boolean }>>(
          `INSERT INTO bookings (
           tenant_id, property_id, room_type_id, room_id, guest_id, external_reference,
           external_booking_id, status, payment_method, starts_on, ends_on, rate_plan_id,
           total_amount, adults, children, guest_count, nightly_rates, pms_stay_status
         ) VALUES (
           $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7, $8::"BookingStatus",
           'PAY_AT_HOTEL'::"BookingPaymentMethod", $9::date, $10::date, $11::uuid, $12::decimal,
           $13, $14, $15, $16::jsonb, $17
         )
         ON CONFLICT (tenant_id, property_id, external_booking_id) DO UPDATE SET
           room_type_id = EXCLUDED.room_type_id,
           room_id = EXCLUDED.room_id,
           guest_id = COALESCE(EXCLUDED.guest_id, bookings.guest_id),
           status = EXCLUDED.status,
           starts_on = EXCLUDED.starts_on,
           ends_on = EXCLUDED.ends_on,
           total_amount = EXCLUDED.total_amount,
           adults = EXCLUDED.adults,
           children = EXCLUDED.children,
           guest_count = EXCLUDED.guest_count,
           nightly_rates = EXCLUDED.nightly_rates,
           pms_stay_status = EXCLUDED.pms_stay_status,
           version = bookings.version + 1,
           updated_at = CURRENT_TIMESTAMP
         RETURNING id, (xmax = 0) AS inserted`,
          tenantId,
          propertyId,
          roomTypeId,
          roomId,
          guestId,
          externalReference,
          String(detail.id),
          status,
          detail.arrival,
          detail.departure,
          ratePlanId,
          totalAmount,
          occupancy.adults,
          occupancy.children,
          occupancy.guestCount,
          JSON.stringify(nightlyRates),
          detail.status.slice(0, 40),
        );

        const row = rows[0]!;
        if (ownership) await this.finalizeOwnedEvent(tx, tenantId, ownership, 'HYDRATED');
        const changed =
          existing !== undefined &&
          existing.status === 'CONFIRMED' &&
          status === 'CONFIRMED' &&
          (existing.startsOn !== detail.arrival ||
            existing.endsOn !== detail.departure ||
            existing.roomTypeId !== roomTypeId);
        return {
          outcome: row.inserted ? 'created' : 'updated',
          bookingId: row.id,
          ...(changed
            ? {
                changedFrom: {
                  startsOn: existing.startsOn,
                  endsOn: existing.endsOn,
                  roomTypeId: existing.roomTypeId,
                },
              }
            : {}),
          // Cancelled at Clock itself: a cancellation MUST made has already set
          // the local row to CANCELLED before Clock's event comes back.
          cancelledInPms:
            existing !== undefined && existing.status !== 'CANCELLED' && status === 'CANCELLED',
        };
      },
    );

    if ((outcome.outcome === 'created' || outcome.outcome === 'updated') && outcome.cancelledInPms)
      await this.notifyStaffOfPmsCancellation(tenantId, propertyId, outcome.bookingId);
    // The hotel moved a guest's stay in Clock: tell the guest (direct bookings only,
    // when the property has this email on). Never fails hydration.
    if (outcome.outcome === 'updated' && outcome.changedFrom)
      await this.updates.sendBookingChanged(
        { tenantId, propertyId },
        outcome.bookingId,
        outcome.changedFrom,
      );
    return outcome;
  }

  /** One open review item per Clock booking and unknown status, whether or
   * not the booking was imported, so repeated events don't repeat the alert. */
  private async hasOpenUnknownStatusReview(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    detail: ClockBookingDetail,
  ): Promise<boolean> {
    const rows = await tx.$queryRawUnsafe<Array<{ found: number }>>(
      `SELECT 1 AS found FROM manual_review_items
       WHERE tenant_id = $1::uuid AND property_id = $2::uuid
         AND category = 'UNKNOWN_STATUS'::"ManualReviewCategory" AND status = 'OPEN'::"ManualReviewStatus"
         AND reference_type = 'clock_booking' AND reference_id = $3
         AND context->>'clockStatus' = $4
       LIMIT 1`,
      tenantId,
      propertyId,
      String(detail.id),
      detail.status,
    );
    return rows.length > 0;
  }

  /** Staff hear about a front-desk cancellation; the guest is not emailed.
   * Never fails hydration: the booking change has already committed. */
  private async notifyStaffOfPmsCancellation(
    tenantId: string,
    propertyId: string,
    bookingId: string,
  ): Promise<void> {
    try {
      await this.cancellations.sendAfterCancellation({ tenantId, propertyId }, bookingId, {
        notifyGuest: false,
      });
    } catch (error) {
      reportOperationalFailure(error, {
        component: 'clock',
        operation: 'clock-cancellation-staff-notification',
        tenantId,
        propertyId,
      });
    }
  }

  /** Writes the event's terminal status inside the caller's own
   * transaction (ADR-0031) — the local effect and the event outcome commit
   * atomically together or not at all. Guarded defense-in-depth by status
   * and token even though the row lock already held throughout this
   * transaction makes a concurrent override impossible. */
  private async finalizeOwnedEvent(
    tx: TenantTransaction,
    tenantId: string,
    ownership: EventOwnership,
    status: 'HYDRATED' | 'FAILED',
  ): Promise<void> {
    const [sql, params] = guardedTransitionSql({
      tenantId,
      eventRowId: ownership.eventRowId,
      status,
      allowedFrom: ['QUEUED'],
      requireToken: ownership.token,
      clearToken: true,
    });
    await tx.$executeRawUnsafe(sql, ...params);
  }

  private async mappedEntityId(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    entityType: 'ROOM_TYPE' | 'ROOM',
    externalId: number | null | undefined,
  ): Promise<string | null> {
    if (externalId == null) return null;
    const rows = await tx.$queryRawUnsafe<Array<{ localEntityId: string | null }>>(
      `SELECT local_entity_id AS "localEntityId" FROM clock_catalog_mappings
       WHERE tenant_id = $1::uuid AND property_id = $2::uuid AND entity_type = $3::"ClockCatalogEntityType"
         AND external_entity_id = $4 AND sync_status = 'CONFIRMED'`,
      tenantId,
      propertyId,
      entityType,
      String(externalId),
    );
    return rows[0]?.localEntityId ?? null;
  }

  /** Same shadow-rate-plan convention clock-catalog-sync.service.ts auto-creates
   * when a ROOM_TYPE mapping is confirmed — this is a defensive fallback for a
   * mapping confirmed before that code existed, not the primary creation path. */
  private async shadowRatePlanId(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    roomTypeId: string,
    externalRoomTypeId: number | null | undefined,
    currency: string,
  ): Promise<string> {
    const existing = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM rate_plans WHERE tenant_id = $1::uuid AND property_id = $2::uuid
         AND clock_shadow_room_type_id = $3::uuid`,
      tenantId,
      propertyId,
      roomTypeId,
    );
    if (existing[0]) return existing[0].id;

    const id = randomUUID();
    await tx.$executeRawUnsafe(
      `INSERT INTO rate_plans (id, tenant_id, property_id, name, currency, is_active, clock_shadow_room_type_id)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, true, $6::uuid)`,
      id,
      tenantId,
      propertyId,
      `Clock room type ${externalRoomTypeId ?? roomTypeId}`,
      currency,
      roomTypeId,
    );
    return id;
  }

  /** Same find-then-insert-with-race-fallback pattern as
   * ClockBookingService.resolveGuest / MultiRoomBookingService for matching/
   * creating by email. Returns null (never a fabricated email) when Clock
   * hasn't captured a guest email yet — real, observed 2026-09-03: a freshly
   * created demo booking's guest_e_mail was an empty string.
   *
   * Fill-blanks-only for an existing match (owner decision, 2026-09-03): a
   * matched guest's name/phone is only filled in where currently blank,
   * never overwritten. Real-world proof this matters, same day: a guest's
   * actual name would otherwise have been silently replaced by stale
   * placeholder text ("QA Task8RefundTrial") left in an unrelated old Clock
   * booking that happened to share the same email — booking data stays
   * fully Clock-owned, but guest identity fields don't, since the same
   * guest can also have self-entered, more trustworthy data from a MUST
   * checkout. */
  private async resolveGuest(
    tx: TenantTransaction,
    tenantId: string,
    detail: ClockBookingDetail,
  ): Promise<string | null> {
    const email = detail.guest_e_mail?.trim().toLowerCase();
    if (!email) return null;
    const firstName = detail.guest_first_name?.trim() || null;
    const lastName = detail.guest_last_name?.trim() || null;
    const phone = detail.guest_phone_number?.trim() || null;

    const existing = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM guests WHERE tenant_id = $1::uuid AND lower(email) = $2`,
      tenantId,
      email,
    );
    if (existing[0]) {
      await tx.$executeRawUnsafe(
        `UPDATE guests SET first_name = COALESCE(first_name, $3), last_name = COALESCE(last_name, $4),
           phone = COALESCE(phone, $5), updated_at = CURRENT_TIMESTAMP
         WHERE tenant_id = $1::uuid AND id = $2::uuid`,
        tenantId,
        existing[0].id,
        firstName,
        lastName,
        phone,
      );
      return existing[0].id;
    }

    const inserted = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO guests (tenant_id, email, first_name, last_name, phone)
       VALUES ($1::uuid, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, lower(email)) DO NOTHING
       RETURNING id`,
      tenantId,
      email,
      firstName,
      lastName,
      phone,
    );
    if (inserted[0]) return inserted[0].id;

    const matched = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM guests WHERE tenant_id = $1::uuid AND lower(email) = $2`,
      tenantId,
      email,
    );
    return matched[0]?.id ?? null;
  }

  /** Same rate-limit/circuit-breaker-wrapped GET pattern as
   * ClockBookingConsistencyService.fetchClock, reused verbatim. */
  private async fetchClock<T>(credentials: ClockConnectionCredentials, path: string): Promise<T> {
    const breakerKey = credentials.apiUser;
    try {
      this.circuitBreaker.assertClosed(breakerKey);
    } catch (error) {
      if (error instanceof CircuitOpenError)
        throw new Error(`Clock booking hydration unavailable: ${error.message}`);
      throw error;
    }
    for (;;) {
      const rateLimit = await this.rateLimiter.consume(breakerKey);
      if (rateLimit.allowed) break;
      await wait(rateLimit.retryAfterSeconds * 1_000);
    }

    try {
      const response = await this.client.request<T>(credentials, {
        api: 'pms_api',
        method: 'GET',
        path,
        timeoutMs: 15_000,
      });
      if (response.status < 200 || response.status >= 300) {
        this.circuitBreaker.recordFailure(breakerKey);
        throw new Error(classifyClockHttpResponse(response.status, response.body).message);
      }
      this.circuitBreaker.recordSuccess(breakerKey);
      return response.body;
    } catch (error) {
      if (error instanceof ClockHttpError) {
        this.circuitBreaker.recordFailure(breakerKey);
        throw new Error(
          classifyClockClientFailure(error.isTimeout ? 'timeout' : 'network', error.message)
            .message,
        );
      }
      throw error;
    }
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
