import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { TenantTransaction } from '../tenancy/tenant-database.service';
import { evaluateBookingRules, type BookingRulePolicy } from './booking-rules';
/** Rechecked inside creation's existing transaction; a stale quote cannot bypass changed limits. */
export async function enforcePropertyBookingLimits(
  tx: TenantTransaction,
  c: { tenantId: string; propertyId: string },
  input: { startsOn: string; endsOn: string; adults: number; children: number; roomCount: number },
) {
  const policies = await tx.$queryRaw<
    BookingRulePolicy[]
  >`SELECT timezone,same_day_booking_allowed AS "sameDayBookingAllowed",same_day_cutoff_time AS "sameDayCutoffTime",max_guests_per_booking AS "maxGuestsPerBooking",max_rooms_per_booking AS "maxRoomsPerBooking" FROM properties WHERE tenant_id=${c.tenantId}::uuid AND id=${c.propertyId}::uuid FOR UPDATE`;
  if (!policies[0]) throw new NotFoundException('Property not found.');
  const result = evaluateBookingRules({ ...input, channel: 'staff', policy: policies[0] });
  if (!result.valid) throw new BadRequestException(result.errors[0]);
}
