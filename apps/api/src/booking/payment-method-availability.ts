import type { TenantTransaction } from '../tenancy/tenant-database.service';

export type PaymentMethodAvailability = { stripe: boolean; pokpay: boolean; payAtHotel: boolean };

/**
 * Which payment methods a guest may really use at this property. A card method needs both the property's
 * switch and an enabled, connected payment connection; the website list (public catalog) uses the same rule,
 * so the server never accepts a booking for a method the guest was never offered.
 */
export async function paymentMethodAvailability(
  tx: TenantTransaction,
  context: { tenantId: string; propertyId: string },
): Promise<PaymentMethodAvailability> {
  const [row] = await tx.$queryRaw<PaymentMethodAvailability[]>`
    SELECT
      (p.stripe_enabled AND EXISTS (
        SELECT 1 FROM property_integration_connections pic
        JOIN integration_connections c ON c.tenant_id = pic.tenant_id AND c.id = pic.connection_id
        WHERE pic.tenant_id = p.tenant_id AND pic.property_id = p.id AND pic.enabled
          AND c.kind = 'PAYMENT' AND c.provider::text = 'STRIPE' AND c.status = 'CONNECTED')) AS "stripe",
      (p.pokpay_enabled AND EXISTS (
        SELECT 1 FROM property_integration_connections pic
        JOIN integration_connections c ON c.tenant_id = pic.tenant_id AND c.id = pic.connection_id
        WHERE pic.tenant_id = p.tenant_id AND pic.property_id = p.id AND pic.enabled
          AND c.kind = 'PAYMENT' AND c.provider::text = 'POKPAY' AND c.status = 'CONNECTED')) AS "pokpay",
      p.pay_at_hotel_enabled AS "payAtHotel"
    FROM properties p
    WHERE p.tenant_id = ${context.tenantId}::uuid AND p.id = ${context.propertyId}::uuid`;
  return row ?? { stripe: false, pokpay: false, payAtHotel: false };
}
