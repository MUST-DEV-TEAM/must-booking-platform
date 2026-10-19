import { Prisma } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import { propertyClock } from '../booking/booking-rules';
import {
  evaluatePricing,
  type PricingFacts,
  type PricingPlan,
  type BasePrice,
  type DailyPrice,
  type Adjustment,
  type Charge,
  type PricingRequest,
} from '../booking/pricing-evaluator';
import type { TenantTransaction } from './tenant-database.service';
export const pricingPlanColumns = Prisma.sql`id,name,currency,is_active AS "isActive",lifecycle,version,code,description,pricing_basis AS "pricingBasis",base_plan_id AS "basePlanId",adjustment_kind AS "adjustmentKind",adjustment_value::text AS "adjustmentValue",room_type_ids AS "roomTypeIds",channels,meal_plan AS "mealPlan",is_fallback AS "isFallback",min_stay AS "minStay",max_stay AS "maxStay",min_advance AS "minAdvance",publication_starts_on::text AS "publicationStartsOn",publication_ends_on::text AS "publicationEndsOn"`;
export const adjustmentColumns = Prisma.sql`id,name,lifecycle,version,mode,value::text,currency,room_type_ids AS "roomTypeIds",rate_plan_ids AS "ratePlanIds",starts_on::text AS "startsOn",ends_on::text AS "endsOn",weekdays,priority,min_stay AS "minStay",max_stay AS "maxStay",min_advance AS "minAdvance",max_advance AS "maxAdvance",note`;
export const chargeColumns = Prisma.sql`id,name,category,lifecycle,version,basis,value::text,currency,display,confirmed,room_type_ids AS "roomTypeIds",rate_plan_ids AS "ratePlanIds",channels,starts_on::text AS "startsOn",ends_on::text AS "endsOn",note`;
export async function pricingContext(
  tx: TenantTransaction,
  tenantId: string,
  propertyId: string,
  lock = false,
) {
  const rows = await tx.$queryRaw<
    Array<{
      timezone: string;
      bookingMode: string;
      pricingVersion: number;
      advanceBookingDays: number | null;
    }>
  >(
    Prisma.sql`SELECT timezone,booking_mode::text AS "bookingMode",pricing_version AS "pricingVersion",advance_booking_days AS "advanceBookingDays" FROM properties WHERE tenant_id=${tenantId}::uuid AND id=${propertyId}::uuid ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`,
  );
  if (!rows[0]) throw new NotFoundException('Property not found.');
  const external = await tx.$queryRaw<
    Array<{ id: string }>
  >`SELECT c.id FROM property_integration_connections pc JOIN integration_connections c ON c.tenant_id=pc.tenant_id AND c.id=pc.connection_id WHERE pc.tenant_id=${tenantId}::uuid AND pc.property_id=${propertyId}::uuid AND pc.enabled AND pc.kind='PMS' AND c.provider='CLOCK_PMS'`;
  return {
    ...rows[0],
    today: propertyClock(rows[0].timezone).date,
    source: external.length ? ('CLOCK_PMS' as const) : ('LOCAL' as const),
    readOnly: external.length > 0,
  };
}
export async function pricingFacts(
  tx: TenantTransaction,
  tenantId: string,
  propertyId: string,
): Promise<PricingFacts> {
  const plans = await tx.$queryRaw<PricingPlan[]>(
    Prisma.sql`SELECT ${pricingPlanColumns} FROM rate_plans WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND clock_shadow_room_type_id IS NULL ORDER BY created_at,id`,
  );
  const base = await tx.$queryRaw<
    BasePrice[]
  >`SELECT id,rate_plan_id AS "ratePlanId",room_type_id AS "roomTypeId",starts_on::text AS "startsOn",ends_on::text AS "endsOn",weekdays,amount::text,version,created_at::text AS "createdAt" FROM rate_rules WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid ORDER BY created_at,id`;
  const daily = await tx.$queryRaw<
    DailyPrice[]
  >`SELECT rate_plan_id AS "ratePlanId",room_type_id AS "roomTypeId",stays_on::text AS date,amount::text,version FROM pricing_daily_prices WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid ORDER BY stays_on`;
  const rules = await tx.$queryRaw<Adjustment[]>(
    Prisma.sql`SELECT ${adjustmentColumns} FROM pricing_adjustments WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid ORDER BY name,id`,
  );
  const charges = await tx.$queryRaw<Charge[]>(
    Prisma.sql`SELECT ${chargeColumns} FROM pricing_charges WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid ORDER BY name,id`,
  );
  const roomOverrides = await tx.$queryRaw<
    PricingFacts['roomOverrides']
  >`SELECT rate_plan_id AS "ratePlanId",room_id AS "roomId",amount::text,version FROM room_price_overrides WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid`;
  return { plans, base, daily, rules, charges, roomOverrides };
}
/** Local search/quote/catalog/calendar/preview all resolve these same facts through the same pure evaluator. */
export async function localPricing(
  tx: TenantTransaction,
  tenantId: string,
  propertyId: string,
  input: Omit<PricingRequest, 'today'>,
) {
  const context = await pricingContext(tx, tenantId, propertyId);
  if (context.source !== 'LOCAL')
    return {
      valid: false,
      errors: [
        {
          code: 'PRICING_EXTERNAL_SOURCE',
          message: 'Prices are managed in Clock; local prices cannot substitute.',
        },
      ],
      total: null,
      nightlyRates: [],
    };
  return evaluatePricing(await pricingFacts(tx, tenantId, propertyId), {
    ...input,
    today: context.today,
  });
}
