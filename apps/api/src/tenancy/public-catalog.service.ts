import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import { TenantDatabaseService } from './tenant-database.service';

type PublicCatalogRoom = {
  id: string;
  name: string;
  title: string | null;
  roomSize: string | null;
  rules: string | null;
  amenities: Array<{ id: string; name: string; icon: string | null }>;
  floor: number | null;
  viewType: string | null;
  isAvailable: boolean;
};

type PublicCatalogRoomType = {
  id: string;
  name: string;
  description: string | null;
  amenitiesIntro: string | null;
  mainImageUrl: string | null;
  galleryImageUrls: string[];
  maxOccupancy: number;
  amenities: Array<{ id: string; name: string; icon: string | null }>;
  ratePlans: Array<{
    id: string;
    name: string;
    currency: string;
    freeCancellationUntilHours: number | null;
  }>;
  // false for a Clock-connected room type: its price comes live from Clock's
  // own /products endpoint via an auto-created shadow rate plan that
  // deliberately has no rate_rules (so `ratePlans` above is always empty for
  // it) — a caller must not require picking one to book. true for a local
  // property, where `ratePlans` lists the real choices to pick from; an
  // empty array there means the property is missing pricing configuration,
  // not that none is needed.
  requiresRatePlanSelection: boolean;
};

type PublicCatalogIndividualRoomType = PublicCatalogRoomType & {
  rooms: PublicCatalogRoom[];
};

export type PublicCatalog = {
  paymentMethods: Array<'stripe' | 'pokpay' | 'pay_at_hotel'>;
  roomTypes: PublicCatalogRoomType[] | PublicCatalogIndividualRoomType[];
  bookingMode?: 'INDIVIDUAL_ROOM_ONLY' | 'MIXED';
};

@Injectable()
export class PublicCatalogService {
  constructor(@Inject(TenantDatabaseService) private readonly database: TenantDatabaseService) {}

  async getCatalog(tenantId: string, propertyId: string, query: unknown): Promise<PublicCatalog> {
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const properties = await tx.$queryRaw<
        Array<{
          stripeEnabled: boolean;
          pokpayEnabled: boolean;
          payAtHotelEnabled: boolean;
          bookingMode: 'ROOM_TYPE_ONLY' | 'INDIVIDUAL_ROOM_ONLY' | 'MIXED';
        }>
      >`
        SELECT stripe_enabled AS "stripeEnabled", pokpay_enabled AS "pokpayEnabled",
          pay_at_hotel_enabled AS "payAtHotelEnabled", booking_mode AS "bookingMode"
        FROM properties
        WHERE tenant_id = ${tenantId}::uuid AND id = ${propertyId}::uuid
      `;
      const connectedPaymentConnections = await tx.$queryRaw<
        Array<{ provider: 'STRIPE' | 'POKPAY' }>
      >`
        SELECT c.provider::text AS provider
        FROM integration_connections c
        JOIN property_integration_connections pic
          ON pic.tenant_id = c.tenant_id AND pic.connection_id = c.id
        WHERE c.tenant_id = ${tenantId}::uuid
          AND pic.property_id = ${propertyId}::uuid
          AND c.kind = 'PAYMENT'
          AND pic.enabled = true
          AND c.status = 'CONNECTED'
      `;
      const roomTypes = await tx.$queryRaw<PublicCatalogRoomType[]>`
        SELECT
          rt.id,
          rt.name,
          rt.description,
          rt.amenities_intro AS "amenitiesIntro",
          rt.main_image_url AS "mainImageUrl",
          rt.gallery_image_urls AS "galleryImageUrls",
          rt.max_occupancy AS "maxOccupancy",
          COALESCE((
            SELECT json_agg(json_build_object('id', a.id, 'name', a.name, 'icon', a.icon) ORDER BY a.name)
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
          ), '[]'::json) AS "ratePlans",
          NOT EXISTS (
            SELECT 1 FROM rate_plans shadow
            WHERE shadow.tenant_id = ${tenantId}::uuid
              AND shadow.property_id = ${propertyId}::uuid
              AND shadow.clock_shadow_room_type_id = rt.id
          ) AS "requiresRatePlanSelection"
        FROM room_types rt
        WHERE rt.tenant_id = ${tenantId}::uuid AND rt.property_id = ${propertyId}::uuid
        ORDER BY rt.created_at
      `;
      const property = properties[0];
      const connectedPaymentProviders = new Set(
        connectedPaymentConnections.map((connection) => connection.provider),
      );
      const paymentMethods: PublicCatalog['paymentMethods'] = property
        ? [
            ...(property.stripeEnabled && connectedPaymentProviders.has('STRIPE')
              ? (['stripe'] as const)
              : []),
            ...(property.pokpayEnabled && connectedPaymentProviders.has('POKPAY')
              ? (['pokpay'] as const)
              : []),
            ...(property.payAtHotelEnabled ? (['pay_at_hotel'] as const) : []),
          ]
        : [];
      if (!property || property.bookingMode === 'ROOM_TYPE_ONLY')
        return { roomTypes, paymentMethods };

      const range = this.availabilityRange(query);
      const rooms = await tx.$queryRaw<Array<PublicCatalogRoom & { roomTypeId: string }>>`
        SELECT r.id, r.name, r.title, r.room_size AS "roomSize",
          COALESCE(NULLIF(BTRIM(r.rules), ''), NULLIF(BTRIM(p.rules), '')) AS rules,
          COALESCE(
            (
              SELECT json_agg(json_build_object('id', a.id, 'name', a.name, 'icon', a.icon) ORDER BY a.name)
              FROM room_amenities ra
              JOIN amenities a ON a.tenant_id = ra.tenant_id AND a.property_id = ra.property_id AND a.id = ra.amenity_id
              WHERE ra.tenant_id = ${tenantId}::uuid
                AND ra.property_id = ${propertyId}::uuid
                AND ra.room_id = r.id
            ),
            (
              SELECT json_agg(json_build_object('id', a.id, 'name', a.name, 'icon', a.icon) ORDER BY a.name)
              FROM room_type_amenities rta
              JOIN amenities a ON a.tenant_id = rta.tenant_id AND a.property_id = rta.property_id AND a.id = rta.amenity_id
              WHERE rta.tenant_id = ${tenantId}::uuid
                AND rta.property_id = ${propertyId}::uuid
                AND rta.room_type_id = r.room_type_id
            ),
            '[]'::json
          ) AS amenities,
          r.floor, r.view_type AS "viewType", r.room_type_id AS "roomTypeId",
          NOT EXISTS (
            SELECT 1
            FROM room_availability ra
            WHERE ra.tenant_id = ${tenantId}::uuid
              AND ra.property_id = ${propertyId}::uuid
              AND ra.room_id = r.id
              AND ra.stays_on >= ${range.startsOn}::date
              AND ra.stays_on < ${range.endsOn}::date
              AND ra.is_available = false
          )
          AND NOT EXISTS (
            SELECT 1
            FROM bookings b
            WHERE b.tenant_id = ${tenantId}::uuid
              AND b.property_id = ${propertyId}::uuid
              AND b.room_id = r.id
              AND b.starts_on < ${range.endsOn}::date
              AND b.ends_on > ${range.startsOn}::date
              AND b.status IN (
                'PAYMENT_PENDING'::"BookingStatus",
                'PAYMENT_NOT_REQUIRED'::"BookingStatus",
                'PMS_CREATION_PENDING'::"BookingStatus",
                'PMS_CONFIRMATION_PENDING'::"BookingStatus",
                'CONFIRMED'::"BookingStatus",
                'PAYMENT_FAILED'::"BookingStatus",
                'PMS_UNKNOWN_RESULT'::"BookingStatus",
                'PMS_REJECTED'::"BookingStatus",
              'MANUAL_REVIEW'::"BookingStatus"
            )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM availability_blocks ab
            WHERE ab.tenant_id = ${tenantId}::uuid
              AND ab.property_id = ${propertyId}::uuid
              AND ab.starts_on < ${range.endsOn}::date
              AND ab.ends_on > ${range.startsOn}::date
              AND (
                ab.blocks_all
                OR EXISTS (
                  SELECT 1
                  FROM availability_block_rooms abr
                  WHERE abr.tenant_id = ab.tenant_id
                    AND abr.property_id = ab.property_id
                    AND abr.block_id = ab.id
                    AND abr.room_id = r.id
                )
                OR EXISTS (
                  SELECT 1
                  FROM availability_block_room_types abrt
                  WHERE abrt.tenant_id = ab.tenant_id
                    AND abrt.property_id = ab.property_id
                    AND abrt.block_id = ab.id
                    AND abrt.room_type_id = r.room_type_id
                )
              )
          ) AS "isAvailable"
        FROM rooms r
        JOIN properties p ON p.tenant_id = r.tenant_id AND p.id = r.property_id
        WHERE r.tenant_id = ${tenantId}::uuid AND r.property_id = ${propertyId}::uuid
        ORDER BY r.created_at
      `;
      const roomsByType = new Map<string, PublicCatalogRoom[]>();
      for (const { roomTypeId, ...room } of rooms)
        roomsByType.set(roomTypeId, [...(roomsByType.get(roomTypeId) ?? []), room]);
      return {
        bookingMode: property.bookingMode,
        roomTypes: roomTypes.map((roomType) => ({
          ...roomType,
          rooms: roomsByType.get(roomType.id) ?? [],
        })),
        paymentMethods,
      };
    });
  }

  private availabilityRange(query: unknown): { startsOn: string; endsOn: string } {
    const value = (query ?? {}) as Record<string, unknown>;
    const startsOn = this.date(value.startsOn, 'startsOn');
    const endsOn = this.date(value.endsOn, 'endsOn');
    if (endsOn <= startsOn) throw new BadRequestException('endsOn must be after startsOn.');
    return { startsOn, endsOn };
  }

  private date(value: unknown, field: string): string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
      throw new BadRequestException(`${field} must be an ISO date (YYYY-MM-DD).`);
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value)
      throw new BadRequestException(`${field} must be an ISO date (YYYY-MM-DD).`);
    return value;
  }
}
