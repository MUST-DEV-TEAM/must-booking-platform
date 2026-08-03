import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { TenantDatabaseService } from './tenant-database.service';
import { AuditLogService } from './audit-log.service';
import { PropertyRoleTemplatesService } from './property-role-templates.service';

type Property = {
  id: string;
  name: string;
  address: string;
  timezone: string;
  publicWebsiteOrigin: string | null;
  minStayNights: number | null;
  maxStayNights: number | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  advanceBookingDays: number | null;
  paymentGateways: { stripe: boolean; pokpay: boolean; payAtHotel: boolean };
};
@Injectable()
export class PropertiesService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(PropertyRoleTemplatesService) private readonly templates: PropertyRoleTemplatesService,
  ) {}
  list(tenantId: string, userId: string): Promise<Property[]> {
    return this.database.withTenantTransaction(
      { tenantId },
      (tx) =>
        tx.$queryRaw<Property[]>`SELECT id, name, address, timezone,
          min_stay_nights AS "minStayNights", max_stay_nights AS "maxStayNights",
          check_in_time AS "checkInTime", check_out_time AS "checkOutTime",
          advance_booking_days AS "advanceBookingDays", public_website_origin AS "publicWebsiteOrigin",
          json_build_object('stripe', stripe_enabled, 'pokpay', pokpay_enabled, 'payAtHotel', pay_at_hotel_enabled) AS "paymentGateways"
          FROM properties p
          WHERE EXISTS (
            SELECT 1
            FROM tenant_memberships tm
            WHERE tm.tenant_id = p.tenant_id
              AND tm.user_id = ${userId}::uuid
              AND (
                tm.role IN ('OWNER', 'ADMIN')
                OR EXISTS (
                  SELECT 1
                  FROM property_staff_assignments psa
                  WHERE psa.tenant_id = p.tenant_id
                    AND psa.property_id = p.id
                    AND psa.user_id = ${userId}::uuid
                )
              )
          )
          ORDER BY p.created_at`,
    );
  }
  async create(tenantId: string, actorUserId: string, body: unknown): Promise<Property> {
    const input = this.input(body);
    const id = randomUUID();
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      const limit = await tx.$queryRaw<
        Array<{ maxProperties: number }>
      >`SELECT p.max_properties AS "maxProperties" FROM organizations o JOIN plans p ON p.id=o.plan_id WHERE o.id=${tenantId}::uuid FOR UPDATE OF o`;
      const count = await tx.$queryRaw<
        Array<{ count: bigint }>
      >`SELECT count(*) AS count FROM properties`;
      if (!limit[0] || Number(count[0].count) >= limit[0].maxProperties)
        throw new ConflictException('Property limit reached. Upgrade to unlock more properties.');
      const slug = `${
        input.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 90) || 'property'
      }-${id.slice(0, 8)}`;
      const rows = await tx.$queryRaw<
        Property[]
      >`INSERT INTO properties (id, tenant_id, name, slug, address, timezone) VALUES (${id}::uuid, ${tenantId}::uuid, ${input.name}, ${slug}, ${input.address}, ${input.timezone}) RETURNING id, name, address, timezone,
        min_stay_nights AS "minStayNights", max_stay_nights AS "maxStayNights",
        check_in_time AS "checkInTime", check_out_time AS "checkOutTime",
        advance_booking_days AS "advanceBookingDays", public_website_origin AS "publicWebsiteOrigin",
        json_build_object('stripe', stripe_enabled, 'pokpay', pokpay_enabled, 'payAtHotel', pay_at_hotel_enabled) AS "paymentGateways"`;
      await this.templates.ensureBuiltInTemplatesInTransaction(tx, tenantId, id);
      await this.audit.recordInTransaction(tx, {
        tenantId,
        propertyId: id,
        actorUserId,
        action: 'property.created',
        targetType: 'property',
        targetId: id,
      });
      return rows[0];
    });
  }
  async update(
    tenantId: string,
    propertyId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<Property> {
    const input = this.updateInput(body);
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const existing = await tx.$queryRaw<Array<Property>>`
        SELECT id, name, address, timezone,
          min_stay_nights AS "minStayNights", max_stay_nights AS "maxStayNights",
          check_in_time AS "checkInTime", check_out_time AS "checkOutTime",
          advance_booking_days AS "advanceBookingDays", public_website_origin AS "publicWebsiteOrigin",
          json_build_object('stripe', stripe_enabled, 'pokpay', pokpay_enabled, 'payAtHotel', pay_at_hotel_enabled) AS "paymentGateways"
        FROM properties WHERE id = ${propertyId}::uuid
      `;
      if (!existing[0]) throw new BadRequestException('Property not found.');
      const nextMinStayNights =
        input.minStayNights === undefined ? existing[0].minStayNights : input.minStayNights;
      const nextMaxStayNights =
        input.maxStayNights === undefined ? existing[0].maxStayNights : input.maxStayNights;
      if (
        nextMinStayNights !== null &&
        nextMaxStayNights !== null &&
        nextMinStayNights > nextMaxStayNights
      )
        throw new BadRequestException('minStayNights cannot exceed maxStayNights.');
      const rows = await tx.$queryRaw<Property[]>`
        UPDATE properties
        SET name = CASE WHEN ${input.name !== undefined} THEN ${input.name} ELSE name END,
          address = CASE WHEN ${input.address !== undefined} THEN ${input.address} ELSE address END,
          timezone = CASE WHEN ${input.timezone !== undefined} THEN ${input.timezone} ELSE timezone END,
          min_stay_nights = CASE WHEN ${input.minStayNights !== undefined} THEN ${input.minStayNights} ELSE min_stay_nights END,
          max_stay_nights = CASE WHEN ${input.maxStayNights !== undefined} THEN ${input.maxStayNights} ELSE max_stay_nights END,
          check_in_time = CASE WHEN ${input.checkInTime !== undefined} THEN ${input.checkInTime} ELSE check_in_time END,
          check_out_time = CASE WHEN ${input.checkOutTime !== undefined} THEN ${input.checkOutTime} ELSE check_out_time END,
          advance_booking_days = CASE WHEN ${input.advanceBookingDays !== undefined} THEN ${input.advanceBookingDays} ELSE advance_booking_days END
        WHERE id = ${propertyId}::uuid
        RETURNING id, name, address, timezone,
          min_stay_nights AS "minStayNights", max_stay_nights AS "maxStayNights",
          check_in_time AS "checkInTime", check_out_time AS "checkOutTime",
          advance_booking_days AS "advanceBookingDays", public_website_origin AS "publicWebsiteOrigin",
          json_build_object('stripe', stripe_enabled, 'pokpay', pokpay_enabled, 'payAtHotel', pay_at_hotel_enabled) AS "paymentGateways"
      `;
      await this.audit.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId,
        action: 'property.updated',
        targetType: 'property',
        targetId: propertyId,
      });
      return rows[0];
    });
  }
  async updatePublicWebsiteOrigin(
    tenantId: string,
    propertyId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<Property> {
    const origin = this.publicWebsiteOrigin(body);
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      const rows = await tx.$queryRaw<Property[]>`
        UPDATE properties
        SET public_website_origin = ${origin}
        WHERE id = ${propertyId}::uuid
        RETURNING id, name, address, timezone,
          min_stay_nights AS "minStayNights", max_stay_nights AS "maxStayNights",
          check_in_time AS "checkInTime", check_out_time AS "checkOutTime",
          advance_booking_days AS "advanceBookingDays", public_website_origin AS "publicWebsiteOrigin",
          json_build_object('stripe', stripe_enabled, 'pokpay', pokpay_enabled, 'payAtHotel', pay_at_hotel_enabled) AS "paymentGateways"
      `;
      if (!rows[0]) throw new BadRequestException('Property not found.');
      await this.audit.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId,
        action: 'property.public_website_origin_updated',
        targetType: 'property',
        targetId: propertyId,
      });
      return rows[0];
    });
  }
  async updatePaymentGateways(
    tenantId: string,
    propertyId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<Property> {
    const gateways = this.paymentGateways(body);
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      const rows = await tx.$queryRaw<Property[]>`
        UPDATE properties
        SET stripe_enabled = ${gateways.stripe}, pokpay_enabled = ${gateways.pokpay},
          pay_at_hotel_enabled = ${gateways.payAtHotel}
        WHERE id = ${propertyId}::uuid
        RETURNING id, name, address, timezone,
          min_stay_nights AS "minStayNights", max_stay_nights AS "maxStayNights",
          check_in_time AS "checkInTime", check_out_time AS "checkOutTime",
          advance_booking_days AS "advanceBookingDays", public_website_origin AS "publicWebsiteOrigin",
          json_build_object('stripe', stripe_enabled, 'pokpay', pokpay_enabled, 'payAtHotel', pay_at_hotel_enabled) AS "paymentGateways"
      `;
      if (!rows[0]) throw new BadRequestException('Property not found.');
      await this.audit.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId,
        action: 'property.payment_gateways_updated',
        targetType: 'property',
        targetId: propertyId,
        details: gateways,
      });
      return rows[0];
    });
  }
  private publicWebsiteOrigin(body: unknown): string | null {
    const value = (body as Record<string, unknown>)?.publicWebsiteOrigin;
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string')
      throw new BadRequestException('publicWebsiteOrigin must be an origin or null.');
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new BadRequestException('publicWebsiteOrigin must be a valid origin.');
    }
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    )
      throw new BadRequestException(
        'publicWebsiteOrigin must contain only scheme, host, and optional port.',
      );
    return parsed.origin;
  }
  private input(body: unknown): { name: string; address: string; timezone: string } {
    const v = body as Record<string, unknown>;
    const field = (k: string) => (typeof v?.[k] === 'string' && v[k].trim() ? v[k].trim() : null);
    const name = field('name'),
      address = field('address'),
      timezone = field('timezone');
    if (!name || !address || !timezone)
      throw new BadRequestException('name, address, and timezone are required.');
    if (name.length > 200 || address.length > 500 || timezone.length > 100)
      throw new BadRequestException('Invalid property details.');
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
    } catch {
      throw new BadRequestException('timezone must be a valid IANA timezone.');
    }
    return { name, address, timezone };
  }
  private paymentGateways(body: unknown): {
    stripe: boolean;
    pokpay: boolean;
    payAtHotel: boolean;
  } {
    const value = body as Record<string, unknown>;
    if (
      typeof value?.stripe !== 'boolean' ||
      typeof value?.pokpay !== 'boolean' ||
      typeof value?.payAtHotel !== 'boolean'
    ) {
      throw new BadRequestException('stripe, pokpay, and payAtHotel must be booleans.');
    }
    return { stripe: value.stripe, pokpay: value.pokpay, payAtHotel: value.payAtHotel };
  }
  private updateInput(body: unknown): {
    name?: string;
    address?: string;
    timezone?: string;
    minStayNights?: number | null;
    maxStayNights?: number | null;
    checkInTime?: string | null;
    checkOutTime?: string | null;
    advanceBookingDays?: number | null;
  } {
    if (!body || typeof body !== 'object')
      throw new BadRequestException('Property updates are required.');
    const value = body as Record<string, unknown>;
    const has = (key: string) => Object.hasOwn(value, key);
    if (
      ![
        'name',
        'address',
        'timezone',
        'minStayNights',
        'maxStayNights',
        'checkInTime',
        'checkOutTime',
        'advanceBookingDays',
      ].some(has)
    )
      throw new BadRequestException('At least one property field is required.');
    const text = (key: 'name' | 'address' | 'timezone', maxLength: number) => {
      if (!has(key)) return undefined;
      if (
        typeof value[key] !== 'string' ||
        !value[key].trim() ||
        value[key].trim().length > maxLength
      )
        throw new BadRequestException(`Invalid ${key}.`);
      return value[key].trim();
    };
    const name = text('name', 200);
    const address = text('address', 500);
    const timezone = text('timezone', 100);
    if (timezone) {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: timezone });
      } catch {
        throw new BadRequestException('timezone must be a valid IANA timezone.');
      }
    }
    const optionalInteger = (key: 'minStayNights' | 'maxStayNights' | 'advanceBookingDays') => {
      if (!has(key)) return undefined;
      const number = value[key];
      if (number === null) return null;
      if (
        typeof number !== 'number' ||
        !Number.isInteger(number) ||
        (key === 'advanceBookingDays' ? number < 0 : number < 1)
      )
        throw new BadRequestException(
          `${key} must be ${key === 'advanceBookingDays' ? 'a non-negative' : 'a positive'} integer or null.`,
        );
      return number;
    };
    const optionalText = (key: 'checkInTime' | 'checkOutTime') => {
      if (!has(key)) return undefined;
      if (value[key] === null) return null;
      if (typeof value[key] !== 'string')
        throw new BadRequestException(`${key} must be a string or null.`);
      return value[key];
    };
    return {
      name,
      address,
      timezone,
      minStayNights: optionalInteger('minStayNights'),
      maxStayNights: optionalInteger('maxStayNights'),
      checkInTime: optionalText('checkInTime'),
      checkOutTime: optionalText('checkOutTime'),
      advanceBookingDays: optionalInteger('advanceBookingDays'),
    };
  }
}
