import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { TenantDatabaseService } from './tenant-database.service';
import { AuditLogService } from './audit-log.service';

type Property = {
  id: string;
  name: string;
  address: string;
  timezone: string;
  publicWebsiteOrigin: string | null;
  paymentGateways: { stripe: boolean; pokpay: boolean; payAtHotel: boolean };
};
@Injectable()
export class PropertiesService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}
  list(tenantId: string): Promise<Property[]> {
    return this.database.withTenantTransaction(
      { tenantId },
      (tx) =>
        tx.$queryRaw<
          Property[]
        >`SELECT id, name, address, timezone, public_website_origin AS "publicWebsiteOrigin",
          json_build_object('stripe', stripe_enabled, 'pokpay', pokpay_enabled, 'payAtHotel', pay_at_hotel_enabled) AS "paymentGateways"
          FROM properties ORDER BY created_at`,
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
      >`INSERT INTO properties (id, tenant_id, name, slug, address, timezone) VALUES (${id}::uuid, ${tenantId}::uuid, ${input.name}, ${slug}, ${input.address}, ${input.timezone}) RETURNING id, name, address, timezone, public_website_origin AS "publicWebsiteOrigin", json_build_object('stripe', stripe_enabled, 'pokpay', pokpay_enabled, 'payAtHotel', pay_at_hotel_enabled) AS "paymentGateways"`;
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
        RETURNING id, name, address, timezone, public_website_origin AS "publicWebsiteOrigin",
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
        RETURNING id, name, address, timezone, public_website_origin AS "publicWebsiteOrigin",
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
}
