import { randomUUID } from 'node:crypto';
import type { TenantTransaction } from '../tenancy/tenant-database.service';

export type BillingRatePlan =
  | { ok: true; ratePlanId: string }
  | { ok: false; reason: 'RATE_PLAN_NOT_FOUND' | 'CURRENCY_MISMATCH' };

/**
 * The rate plan a new booking is stored under, so that its currency is the currency the guest was quoted.
 *
 * A booking has no currency column of its own: payments, emails and reports all read the currency of its rate
 * plan. For a hotel's own plans the quoted currency must equal the plan's. A Clock rate plan (a "shadow" plan)
 * is different: Clock decides what currency each rate is sold in and the hotel can change it at any time, so
 * the guest pays what Clock quoted. Such a booking is kept on the inactive "Clock reservations billed in X"
 * plan, the same plan Clock reservations imported in another currency already use.
 */
export async function resolveBillingRatePlan(
  tx: TenantTransaction,
  scope: { tenantId: string; propertyId: string },
  ratePlanId: string,
  currency: string,
): Promise<BillingRatePlan> {
  const plans = await tx.$queryRaw<Array<{ id: string; currency: string; isClockPlan: boolean }>>`
    SELECT id, currency, (clock_shadow_room_type_id IS NOT NULL) AS "isClockPlan"
    FROM rate_plans
    WHERE id = ${ratePlanId}::uuid AND tenant_id = ${scope.tenantId}::uuid
      AND property_id = ${scope.propertyId}::uuid AND is_active = true
  `;
  const plan = plans[0];
  if (!plan) return { ok: false, reason: 'RATE_PLAN_NOT_FOUND' };
  if (plan.currency === currency) return { ok: true, ratePlanId: plan.id };
  if (!plan.isClockPlan || !/^[A-Z]{3}$/.test(currency))
    return { ok: false, reason: 'CURRENCY_MISMATCH' };

  const name = `Clock reservations billed in ${currency}`;
  const found = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM rate_plans
    WHERE tenant_id = ${scope.tenantId}::uuid AND property_id = ${scope.propertyId}::uuid
      AND clock_shadow_room_type_id IS NULL AND is_active = false
      AND name = ${name} AND currency = ${currency}
  `;
  if (found[0]) return { ok: true, ratePlanId: found[0].id };
  const id = randomUUID();
  await tx.$executeRaw`
    INSERT INTO rate_plans (id, tenant_id, property_id, name, currency, is_active)
    VALUES (${id}::uuid, ${scope.tenantId}::uuid, ${scope.propertyId}::uuid, ${name}, ${currency}, false)
  `;
  return { ok: true, ratePlanId: id };
}
