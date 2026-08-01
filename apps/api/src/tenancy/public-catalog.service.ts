import { Inject, Injectable } from '@nestjs/common';

import { TenantDatabaseService } from './tenant-database.service';

export type PublicCatalog = {
  paymentMethods: Array<'stripe' | 'pokpay' | 'pay_at_hotel'>;
  roomTypes: Array<{
    id: string;
    name: string;
    description: string | null;
    maxOccupancy: number;
    amenities: Array<{ id: string; name: string }>;
    ratePlans: Array<{
      id: string;
      name: string;
      currency: string;
      freeCancellationUntilHours: number | null;
    }>;
  }>;
};

@Injectable()
export class PublicCatalogService {
  constructor(@Inject(TenantDatabaseService) private readonly database: TenantDatabaseService) {}

  async getCatalog(tenantId: string, propertyId: string): Promise<PublicCatalog> {
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const properties = await tx.$queryRaw<
        Array<{ stripeEnabled: boolean; pokpayEnabled: boolean; payAtHotelEnabled: boolean }>
      >`
        SELECT stripe_enabled AS "stripeEnabled", pokpay_enabled AS "pokpayEnabled",
          pay_at_hotel_enabled AS "payAtHotelEnabled"
        FROM properties
        WHERE tenant_id = ${tenantId}::uuid AND id = ${propertyId}::uuid
      `;
      const roomTypes = await tx.$queryRaw<PublicCatalog['roomTypes']>`
        SELECT
          rt.id,
          rt.name,
          rt.description,
          rt.max_occupancy AS "maxOccupancy",
          COALESCE((
            SELECT json_agg(json_build_object('id', a.id, 'name', a.name) ORDER BY a.name)
            FROM room_type_amenities rta
            JOIN amenities a ON a.id = rta.amenity_id
            WHERE rta.tenant_id = ${tenantId}::uuid
              AND rta.property_id = ${propertyId}::uuid
              AND rta.room_type_id = rt.id
          ), '[]'::json) AS amenities,
          COALESCE((
            SELECT json_agg(json_build_object(
              'id', plans.id,
              'name', plans.name,
              'currency', plans.currency,
              'freeCancellationUntilHours', plans.free_cancellation_until_hours
            ) ORDER BY plans.created_at)
            FROM (
              SELECT DISTINCT rp.id, rp.name, rp.currency, rp.free_cancellation_until_hours, rp.created_at
              FROM rate_plans rp
              JOIN rate_rules rr ON rr.rate_plan_id = rp.id
              WHERE rp.tenant_id = ${tenantId}::uuid
                AND rp.property_id = ${propertyId}::uuid
                AND rp.is_active = true
                AND rr.tenant_id = ${tenantId}::uuid
                AND rr.property_id = ${propertyId}::uuid
                AND rr.room_type_id = rt.id
            ) plans
          ), '[]'::json) AS "ratePlans"
        FROM room_types rt
        WHERE rt.tenant_id = ${tenantId}::uuid AND rt.property_id = ${propertyId}::uuid
        ORDER BY rt.created_at
      `;
      const property = properties[0];
      const paymentMethods: PublicCatalog['paymentMethods'] = property
        ? [
            ...(property.stripeEnabled ? (['stripe'] as const) : []),
            ...(property.pokpayEnabled ? (['pokpay'] as const) : []),
            ...(property.payAtHotelEnabled ? (['pay_at_hotel'] as const) : []),
          ]
        : [];
      return { roomTypes, paymentMethods };
    });
  }
}
