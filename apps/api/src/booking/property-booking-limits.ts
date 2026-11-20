import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { TenantTransaction } from '../tenancy/tenant-database.service';
import { evaluateBookingRules, type BookingRulePolicy } from './booking-rules';
import { bookingPolicyColumns } from './booking-policy-columns';
/** Rechecked inside creation's existing transaction; a stale quote cannot bypass changed limits. */
export async function enforcePropertyBookingLimits(
  tx: TenantTransaction,
  c: { tenantId: string; propertyId: string },
  input: { startsOn: string; endsOn: string; adults: number; children: number; roomCount: number },
  /** Staff only: a reason to skip the hotel's own limits. The skipped rules are returned to be recorded. */
  overrideReason?: string,
): Promise<{ overridden: Array<{ code: string; message: string }> }> {
  const policies = await tx.$queryRaw<
    BookingRulePolicy[]
  >`SELECT ${bookingPolicyColumns} FROM properties WHERE tenant_id=${c.tenantId}::uuid AND id=${c.propertyId}::uuid FOR UPDATE`;
  if (!policies[0]) throw new NotFoundException('Property not found.');
  const result = evaluateBookingRules({
    ...input,
    channel: 'staff',
    policy: policies[0],
    overrideRules: Boolean(overrideReason),
  });
  if (!result.valid) throw new BadRequestException(result.errors[0]);
  return { overridden: result.overridden ?? [] };
}
