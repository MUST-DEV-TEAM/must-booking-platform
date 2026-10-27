import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { LifecycleEmailService } from '../mail/lifecycle-email.service';
import { AuditLogService } from '../tenancy/audit-log.service';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { isStayStatus, stayStatusProblem, type StayStatus } from './booking-stay-status';

type Context = { tenantId: string; propertyId: string; userId: string };

/**
 * Arrival, departure and no-show for stays the hotel manages in MUST itself. Stays held by a PMS (Clock) are
 * never changed here: the PMS is where the front desk records it, and MUST only reads the result back.
 */
@Injectable()
export class BookingStayStatusService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(LifecycleEmailService) private readonly lifecycle: LifecycleEmailService,
  ) {}

  async set(context: Context, bookingId: string, to: StayStatus, expectedFrom?: unknown) {
    const result = await this.database.withTenantTransaction(context, async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          status: string;
          from: string | null;
          startsOn: string;
          externalBookingId: string | null;
          today: string;
        }>
      >`
        SELECT b.status::text AS status, b.pms_stay_status AS "from", b.starts_on::text AS "startsOn",
          b.external_booking_id AS "externalBookingId",
          (now() AT TIME ZONE COALESCE(p.timezone, 'UTC'))::date::text AS today
        FROM bookings b JOIN properties p ON p.tenant_id = b.tenant_id AND p.id = b.property_id
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
      const problem = stayStatusProblem({ from, to, startsOn: row.startsOn, today: row.today });
      if (problem) throw new ConflictException(problem);
      await tx.$executeRaw`
        UPDATE bookings SET pms_stay_status = ${to}, version = version + 1, updated_at = now()
        WHERE tenant_id = ${context.tenantId}::uuid AND property_id = ${context.propertyId}::uuid
          AND id = ${bookingId}::uuid
      `;
      await this.audit.recordInTransaction(tx, {
        tenantId: context.tenantId,
        propertyId: context.propertyId,
        actorUserId: context.userId,
        action: 'booking.stay_status_changed',
        targetType: 'booking',
        targetId: bookingId,
        details: { from, to },
      });
      return { from, to };
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
    return { stayStatus: result.to };
  }
}
