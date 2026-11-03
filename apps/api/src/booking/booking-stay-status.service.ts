import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { LifecycleEmailService } from '../mail/lifecycle-email.service';
import { AuditLogService } from '../tenancy/audit-log.service';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import {
  cleanStayNote,
  isEarlyDeparture,
  isStayStatus,
  stayStatusProblem,
  type StayStatus,
} from './booking-stay-status';

type Context = { tenantId: string; propertyId: string; userId: string };

export type StayStatusOptions = {
  /** Why staff proceed, e.g. when checking out with money still owed. */
  note?: unknown;
  /** Staff confirmed that check-out may go ahead although money is still owed. */
  acknowledgeBalance?: unknown;
};

/**
 * Arrival, departure and no-show for stays the hotel manages in MUST itself. Stays held by a PMS (Clock) are
 * never changed here: the PMS is where the front desk records it, and MUST only reads the result back.
 *
 * Every step is saved with the real time and the staff member, in an append-only history, so the hotel can
 * always say when a guest actually arrived and left.
 */
@Injectable()
export class BookingStayStatusService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(LifecycleEmailService) private readonly lifecycle: LifecycleEmailService,
  ) {}

  async set(
    context: Context,
    bookingId: string,
    to: StayStatus,
    expectedFrom?: unknown,
    options: StayStatusOptions = {},
  ) {
    const note = cleanStayNote(options.note);
    const result = await this.database.withTenantTransaction(context, async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          status: string;
          from: string | null;
          startsOn: string;
          endsOn: string;
          externalBookingId: string | null;
          today: string;
          outstanding: string;
          currency: string | null;
        }>
      >`
        SELECT b.status::text AS status, b.pms_stay_status AS "from", b.starts_on::text AS "startsOn",
          b.ends_on::text AS "endsOn", b.external_booking_id AS "externalBookingId",
          (now() AT TIME ZONE COALESCE(p.timezone, 'UTC'))::date::text AS today,
          GREATEST(0, b.total_amount
            - COALESCE((SELECT sum(amount) FROM payments pay WHERE pay.tenant_id = b.tenant_id
                AND pay.property_id = b.property_id AND pay.booking_id = b.id
                AND pay.kind = 'CHARGE' AND pay.status IN ('PAID', 'succeeded')), 0)
            + COALESCE((SELECT sum(amount) FROM payments pay WHERE pay.tenant_id = b.tenant_id
                AND pay.property_id = b.property_id AND pay.booking_id = b.id
                AND pay.kind = 'REFUND' AND pay.status = 'REFUNDED'), 0))::text AS outstanding,
          COALESCE(b.currency, rp.currency) AS currency
        FROM bookings b
        JOIN properties p ON p.tenant_id = b.tenant_id AND p.id = b.property_id
        JOIN rate_plans rp ON rp.tenant_id = b.tenant_id AND rp.property_id = b.property_id
          AND rp.id = b.rate_plan_id
        WHERE b.tenant_id = ${context.tenantId}::uuid AND b.property_id = ${context.propertyId}::uuid
          AND b.id = ${bookingId}::uuid
        FOR UPDATE OF b
      `;
      const row = rows[0];
      if (!row) throw new NotFoundException('Reservation not found.');
      if (row.externalBookingId)
        throw new ConflictException(
          'This stay is managed in the hotel system, so arrival is recorded there.',
        );
      if (row.status !== 'CONFIRMED')
        throw new ConflictException('Only a confirmed reservation can be checked in or out.');
      const from: StayStatus = isStayStatus(row.from) ? row.from : 'expected';
      if (isStayStatus(expectedFrom) && expectedFrom !== from)
        throw new ConflictException('Someone else just changed this stay. Reload and try again.');
      const problem = stayStatusProblem({
        from,
        to,
        startsOn: row.startsOn,
        endsOn: row.endsOn,
        today: row.today,
      });
      if (problem) throw new ConflictException(problem);

      // Checking out with money still owed is allowed only as a deliberate, explained choice.
      const owes = to === 'checked_out' && Number(row.outstanding) > 0;
      const overridden = owes && options.acknowledgeBalance === true;
      if (owes && !overridden)
        throw new ConflictException({
          message: `This guest still owes ${row.outstanding} ${row.currency ?? ''}. Settle it, or confirm check-out with the balance open.`,
          code: 'BALANCE_OUTSTANDING',
          outstanding: row.outstanding,
          currency: row.currency,
        });
      if (overridden && !note)
        throw new ConflictException({
          message: 'Add a short note saying why the guest is checking out with a balance open.',
          code: 'NOTE_REQUIRED',
        });

      const early =
        to === 'checked_out' && isEarlyDeparture({ endsOn: row.endsOn, today: row.today });
      // The real times follow the status: leaving a step clears the time that step recorded.
      await tx.$executeRaw`
        UPDATE bookings SET pms_stay_status = ${to}, version = version + 1, updated_at = now(),
          checked_in_at = CASE WHEN ${to} = 'checked_in' THEN now()
            WHEN ${to} = 'expected' THEN NULL ELSE checked_in_at END,
          checked_out_at = CASE WHEN ${to} = 'checked_out' THEN now() ELSE NULL END
        WHERE tenant_id = ${context.tenantId}::uuid AND property_id = ${context.propertyId}::uuid
          AND id = ${bookingId}::uuid
      `;
      await tx.$executeRaw`
        INSERT INTO booking_stay_events (
          tenant_id, property_id, booking_id, from_status, to_status, actor_user_id,
          early_departure, balance_overridden, note
        ) VALUES (
          ${context.tenantId}::uuid, ${context.propertyId}::uuid, ${bookingId}::uuid, ${from}, ${to},
          ${context.userId}::uuid, ${early}, ${overridden}, ${note}
        )
      `;
      await this.audit.recordInTransaction(tx, {
        tenantId: context.tenantId,
        propertyId: context.propertyId,
        actorUserId: context.userId,
        action: 'booking.stay_status_changed',
        targetType: 'booking',
        targetId: bookingId,
        details: { from, to, earlyDeparture: early, balanceOverridden: overridden },
      });
      return { to, early, plannedEndsOn: row.endsOn, today: row.today };
    });
    // Told after the change is saved; an email problem never undoes it.
    if (result.to === 'no_show')
      await this.lifecycle.guest(context, {
        topic: 'no_show_notice',
        key: 'no_show_notice',
        eventType: 'guest.no_show_notice',
        idempotencyKey: `no-show/${bookingId}`,
        bookingId,
        heading: 'We missed you',
      });
    return {
      stayStatus: result.to,
      // The nights that are left can go back on sale through the reviewed date change.
      ...(result.early
        ? { earlyDeparture: true, plannedEndsOn: result.plannedEndsOn, departedOn: result.today }
        : {}),
    };
  }

  /** The history of arrival and departure steps of one stay, oldest first. */
  async events(context: { tenantId: string; propertyId: string }, bookingId: string) {
    return this.database.withTenantTransaction(
      context,
      (tx) =>
        tx.$queryRaw<
          Array<{
            from: string;
            to: string;
            at: string;
            by: string | null;
            earlyDeparture: boolean;
            balanceOverridden: boolean;
            note: string | null;
          }>
        >`
        SELECT e.from_status AS "from", e.to_status AS "to", e.occurred_at AS "at",
          u.email AS "by", e.early_departure AS "earlyDeparture",
          e.balance_overridden AS "balanceOverridden", e.note
        FROM booking_stay_events e
        LEFT JOIN users u ON u.id = e.actor_user_id
        WHERE e.tenant_id = ${context.tenantId}::uuid AND e.property_id = ${context.propertyId}::uuid
          AND e.booking_id = ${bookingId}::uuid
        ORDER BY e.occurred_at, e.id
      `,
    );
  }
}
