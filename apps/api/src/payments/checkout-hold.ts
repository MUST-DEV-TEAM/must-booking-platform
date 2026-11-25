import type { TenantTransaction } from '../tenancy/tenant-database.service';

/**
 * How many minutes the online payment page may stay open: the time left on the booking's room hold (the
 * property's `online_payment_hold_minutes` from when the booking was created), at least 1. The payment window
 * never outlives the hold, so a guest cannot pay for a room that was already released (ADR-0019; a payment that
 * still arrives late is refunded by the ADR-0043 flow). The same rule as the restaurant deposit checkout.
 */
export async function checkoutHoldMinutes(
  tx: TenantTransaction,
  scope: { tenantId: string; propertyId: string },
  bookingId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ minutes: number }>>`
    SELECT GREATEST(1, CEIL(p.online_payment_hold_minutes - EXTRACT(EPOCH FROM (now() - COALESCE(b.payment_pending_at,b.created_at))) / 60))::int AS minutes
    FROM bookings b JOIN properties p ON p.tenant_id = b.tenant_id AND p.id = b.property_id
    WHERE b.tenant_id = ${scope.tenantId}::uuid AND b.property_id = ${scope.propertyId}::uuid
      AND b.id = ${bookingId}::uuid`;
  return rows[0]?.minutes ?? 1;
}
