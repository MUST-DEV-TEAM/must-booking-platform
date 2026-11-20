import {
  hotelColumns,
  propertyColumns,
  hotelFields,
  hotelInput,
  hotelUpdates,
  checkHotelSettings,
  type HotelSettings,
} from './hotel-settings';
import { Prisma } from '@prisma/client';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  checkBookingLimit,
  checkProfileField,
  normaliseProfileValue,
} from '@must/domain-contracts';
import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';
import { AuditLogService } from './audit-log.service';
import { PropertyRoleTemplatesService } from './property-role-templates.service';
import { settingsReadiness, type SettingsReadiness } from './settings-readiness';
import {
  saveSettingsOverviewHidden,
  settingsOverviewExtras,
  type SettingsAttentionItem,
  type SettingsOverviewHidden,
} from './settings-attention';

export type ClockCancelRefundPolicy = 'NEVER' | 'FREE_WINDOW' | 'ALWAYS';
export type ClockPaymentFolio = 'DEPOSIT' | 'MAIN';
const CLOCK_PAYMENT_FOLIOS: ClockPaymentFolio[] = ['DEPOSIT', 'MAIN'];
const CLOCK_CANCEL_REFUND_POLICIES: ClockCancelRefundPolicy[] = ['NEVER', 'FREE_WINDOW', 'ALWAYS'];
type BookingMode = 'ROOM_TYPE_ONLY' | 'INDIVIDUAL_ROOM_ONLY' | 'MIXED';
type Property = HotelSettings & {
  id: string;
  name: string;
  address: string;
  timezone: string;
  onlinePaymentHoldMinutes: number;
  autoRefundOnFreeCancellation: boolean;
  /** A refund the guest asked for keeps back the payment provider's fee (the hotel's terms say so). */
  deductPaymentFeeOnGuestRefund: boolean;
  clockCancelRefundPolicy: ClockCancelRefundPolicy;
  /** Where a website payment is posted in Clock: a deposit folio (converted to an advance invoice by the hotel) or the booking's own folio. */
  clockPaymentFolio: ClockPaymentFolio;
  brandColour: string | null;
  emailFooterText: string | null;
  termsUrl: string | null;
  logoUrl: string | null;
  phone: string | null;
  supportEmail: string | null;
  bookingMode: BookingMode;
  publicWebsiteOrigin: string | null;
  minStayNights: number | null;
  maxStayNights: number | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  rules: string | null;
  advanceBookingDays: number | null;
  freeCancellationDaysBeforeArrival: number;
  paymentGateways: { stripe: boolean; pokpay: boolean; payAtHotel: boolean };
  wordpressConnectedAt: Date | null;
};
type PropertyListItem = Property & {
  staffCount: number;
  pmsSource: 'MUST' | 'CLOCK_PMS';
  connectedProviders: string[];
  /** Active rooms, counted from Accommodations (or the PMS import); never typed. */
  roomCount: number;
  /** True once the hotel has any booking; a time zone change then needs a confirmation. */
  hasBookings: boolean;
  readiness: SettingsReadiness;
};
type PropertyDeleteBlocker = { resource: string; count: number };
/**
 * The accounting email and main contact are for MUST and the hotel's accountant. Only the account's owners and
 * admins receive them; front desk and other staff who can open the hotel get them blanked.
 */
function withoutInternalContacts<T extends object>(row: T, manager: boolean): T {
  if (manager) return row;
  return {
    ...row,
    accountingEmail: null,
    mainContactName: null,
    mainContactRole: null,
    mainContactPhone: null,
    mainContactEmail: null,
  };
}

@Injectable()
export class PropertiesService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(PropertyRoleTemplatesService) private readonly templates: PropertyRoleTemplatesService,
  ) {}
  /** The hotels this user may see, each with its "ready to take bookings" status worked out here. */
  async list(tenantId: string, userId: string): Promise<PropertyListItem[]> {
    const rows = await this.listRows(tenantId, userId);
    const manager = await this.isOwnerOrAdmin(tenantId, userId);
    return rows.map((row) => {
      const visible = withoutInternalContacts(row, manager);
      return { ...visible, readiness: settingsReadiness(visible) };
    });
  }
  /** One hotel's saved settings and its "ready to take bookings" status; refused if not visible. */
  async settingsSummary(
    tenantId: string,
    userId: string,
    propertyId: string,
  ): Promise<
    SettingsReadiness & {
      hotel: PropertyListItem;
      attention: SettingsAttentionItem[];
      hidden: SettingsOverviewHidden;
    }
  > {
    const manager = await this.isOwnerOrAdmin(tenantId, userId);
    const found = (await this.listRows(tenantId, userId)).find((item) => item.id === propertyId);
    if (!found) throw new NotFoundException('Property not found.');
    const listed = withoutInternalContacts(found, manager);
    const { emailProviderActive, attention, hidden } = await settingsOverviewExtras(
      this.database,
      { tenantId, propertyId },
      userId,
    );
    // The email step needs this hotel's sending profile, which only a single-hotel read may see.
    const readiness = settingsReadiness({ ...listed, emailProviderActive });
    // Live problems (refunds, payments, email failures) are for the people who run Settings: the account's
    // owners and admins, as on the dashboard. Hotel staff and restaurant staff who can open this hotel get none.
    return {
      ...readiness,
      attention: manager ? attention : [],
      hidden,
      hotel: { ...listed, readiness },
    };
  }
  private async isOwnerOrAdmin(tenantId: string, userId: string): Promise<boolean> {
    const rows = await this.database.withTenantTransaction(
      { tenantId },
      (tx) =>
        tx.$queryRaw<Array<{ manager: boolean }>>`
        SELECT EXISTS(SELECT 1 FROM tenant_memberships WHERE tenant_id=${tenantId}::uuid
          AND user_id=${userId}::uuid AND role IN ('OWNER','ADMIN')) AS manager`,
    );
    return rows[0]?.manager === true;
  }
  /** "Hide for now" on the setup guide, or "Got it" on the ready notice, for this person and hotel. */
  async setSettingsOverviewHidden(
    tenantId: string,
    userId: string,
    propertyId: string,
    input: unknown,
  ): Promise<SettingsOverviewHidden> {
    if ((await this.listRows(tenantId, userId)).every((item) => item.id !== propertyId))
      throw new NotFoundException('Property not found.');
    return saveSettingsOverviewHidden(this.database, { tenantId, propertyId }, userId, input);
  }
  private listRows(
    tenantId: string,
    userId: string,
  ): Promise<Omit<PropertyListItem, 'readiness'>[]> {
    return this.database.withTenantTransaction(
      { tenantId },
      (tx) =>
        tx.$queryRaw<Omit<PropertyListItem, 'readiness'>[]>`SELECT id, name, address, timezone,
          (SELECT count(*)::int FROM tenant_memberships members
           WHERE members.tenant_id=p.tenant_id AND (members.role IN ('OWNER','ADMIN') OR EXISTS (
             SELECT 1 FROM property_staff_assignments assignments
             WHERE assignments.tenant_id=p.tenant_id AND assignments.property_id=p.id
               AND assignments.user_id=members.user_id AND assignments.suspended_at IS NULL
           ))) AS "staffCount",
          CASE WHEN EXISTS (
            SELECT 1 FROM property_integration_connections pic
            JOIN integration_connections ic ON ic.tenant_id=pic.tenant_id AND ic.id=pic.connection_id
            WHERE pic.tenant_id=p.tenant_id AND pic.property_id=p.id AND pic.enabled
              AND pic.kind='PMS' AND ic.provider='CLOCK_PMS'
          ) THEN 'CLOCK_PMS' ELSE 'MUST' END AS "pmsSource",
          ARRAY(SELECT DISTINCT ic.provider::text FROM property_integration_connections pic
            JOIN integration_connections ic ON ic.tenant_id=pic.tenant_id AND ic.id=pic.connection_id
            WHERE pic.tenant_id=p.tenant_id AND pic.property_id=p.id AND pic.enabled AND ic.status='CONNECTED'
            ORDER BY ic.provider::text) AS "connectedProviders",
          EXISTS(SELECT 1 FROM rate_rules rr WHERE rr.tenant_id=p.tenant_id AND rr.property_id=p.id UNION ALL SELECT 1 FROM pricing_daily_prices dp WHERE dp.tenant_id=p.tenant_id AND dp.property_id=p.id UNION ALL SELECT 1 FROM room_price_overrides ro WHERE ro.tenant_id=p.tenant_id AND ro.property_id=p.id UNION ALL SELECT 1 FROM property_exchange_rates fx WHERE fx.tenant_id=p.tenant_id AND fx.property_id=p.id) AS "defaultCurrencyLocked",
          online_payment_hold_minutes AS "onlinePaymentHoldMinutes",auto_refund_on_free_cancellation AS "autoRefundOnFreeCancellation",deduct_payment_fee_on_guest_refund AS "deductPaymentFeeOnGuestRefund",clock_cancel_refund_policy AS "clockCancelRefundPolicy",clock_payment_folio AS "clockPaymentFolio",brand_colour AS "brandColour",email_footer_text AS "emailFooterText",terms_url AS "termsUrl",${hotelColumns},logo_url AS "logoUrl", logo_dark_url AS "logoDarkUrl", icon_url AS "iconUrl", favicon_url AS "faviconUrl", cover_url AS "coverUrl", phone, support_email AS "supportEmail",
          booking_mode AS "bookingMode",
          min_stay_nights AS "minStayNights", max_stay_nights AS "maxStayNights",
          check_in_time AS "checkInTime", check_out_time AS "checkOutTime",
          rules,
          advance_booking_days AS "advanceBookingDays",
          free_cancellation_days_before_arrival AS "freeCancellationDaysBeforeArrival",
          public_website_origin AS "publicWebsiteOrigin",
          wordpress_connected_at AS "wordpressConnectedAt",
          (SELECT count(*)::int FROM rooms r WHERE r.tenant_id=p.tenant_id AND r.property_id=p.id AND r.is_active) AS "roomCount",
          EXISTS(SELECT 1 FROM bookings b WHERE b.tenant_id=p.tenant_id AND b.property_id=p.id) AS "hasBookings",
          json_build_object('stripe', stripe_enabled, 'pokpay', pokpay_enabled, 'payAtHotel', pay_at_hotel_enabled) AS "paymentGateways"
          FROM properties p
          WHERE p.tenant_id=${tenantId}::uuid AND EXISTS (
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
                -- Restaurant staff reach the hotel their restaurant belongs to, so the dashboard has a
                -- hotel to open; the hotel's own pages stay behind their usual permissions.
                OR EXISTS (
                  SELECT 1
                  FROM venue_staff_assignments vsa
                  JOIN venues v ON v.tenant_id = vsa.tenant_id AND v.id = vsa.venue_id
                  WHERE vsa.tenant_id = p.tenant_id
                    AND vsa.user_id = ${userId}::uuid
                    AND vsa.suspended_at IS NULL
                    AND v.active
                    AND v.property_id = p.id
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
      >`INSERT INTO properties (id, tenant_id, name, slug, address, timezone, logo_url, phone, support_email) VALUES (${id}::uuid, ${tenantId}::uuid, ${input.name}, ${slug}, ${input.address}, ${input.timezone}, ${input.logoUrl}, ${input.phone}, ${input.supportEmail}) RETURNING id, name, address, timezone, ${propertyColumns}`;
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
      await tx.$queryRaw`SELECT id FROM properties WHERE tenant_id=${tenantId}::uuid AND id=${propertyId}::uuid FOR UPDATE`;
      const existing = await tx.$queryRaw<Array<Property>>`
        SELECT id, name, address, timezone, ${propertyColumns}
        FROM properties WHERE id = ${propertyId}::uuid
      `;
      if (!existing[0]) throw new BadRequestException('Property not found.');
      for (const url of [
        input.logoUrl,
        input.logoDarkUrl,
        input.iconUrl,
        input.faviconUrl,
        input.coverUrl,
      ]) {
        const ownedImage = url ? this.serverLogoKey(new URL(url)) : null;
        if (!ownedImage) continue;
        const images = await tx.$queryRaw<
          Array<{ id: string }>
        >`SELECT l.id FROM property_library_images l JOIN server_media_uploads u ON u.tenant_id=l.tenant_id AND u.property_id=l.property_id AND u.object_key=l.object_key AND u.uploaded_at IS NOT NULL WHERE l.tenant_id=${tenantId}::uuid AND l.property_id=${propertyId}::uuid AND l.object_key=${ownedImage} AND l.confirmed_at IS NOT NULL`;
        if (!images[0])
          throw new BadRequestException('Choose a confirmed image from this hotel photo library.');
      }

      checkHotelSettings({ ...existing[0], ...input }, Object.keys(input));
      if (
        input.defaultCurrency !== undefined &&
        input.defaultCurrency !== existing[0].defaultCurrency
      ) {
        const prices = await tx.$queryRaw<
          { locked: boolean }[]
        >`SELECT EXISTS(SELECT 1 FROM rate_rules WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid UNION ALL SELECT 1 FROM pricing_daily_prices WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid UNION ALL SELECT 1 FROM room_price_overrides WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid UNION ALL SELECT 1 FROM property_exchange_rates WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid) AS locked`;
        if (prices[0]?.locked)
          throw new ConflictException(
            'Prices or hotel exchange rates already exist. Their currency cannot be changed here.',
          );
      }
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
        SET ${Object.keys(hotelInput(body as Record<string, unknown>)).length ? Prisma.sql`${hotelUpdates(input)},` : Prisma.empty} stripe_enabled=COALESCE(${input.paymentGateways?.stripe},stripe_enabled),pokpay_enabled=COALESCE(${input.paymentGateways?.pokpay},pokpay_enabled),pay_at_hotel_enabled=COALESCE(${input.paymentGateways?.payAtHotel},pay_at_hotel_enabled),
          online_payment_hold_minutes=COALESCE(${input.onlinePaymentHoldMinutes},online_payment_hold_minutes),
          auto_refund_on_free_cancellation=COALESCE(${input.autoRefundOnFreeCancellation},auto_refund_on_free_cancellation),
          deduct_payment_fee_on_guest_refund=COALESCE(${input.deductPaymentFeeOnGuestRefund},deduct_payment_fee_on_guest_refund),
          clock_cancel_refund_policy=COALESCE(${input.clockCancelRefundPolicy},clock_cancel_refund_policy),
          clock_payment_folio=COALESCE(${input.clockPaymentFolio},clock_payment_folio),
          brand_colour=CASE WHEN ${input.brandColour !== undefined} THEN ${input.brandColour} ELSE brand_colour END,
          email_footer_text=CASE WHEN ${input.emailFooterText !== undefined} THEN ${input.emailFooterText} ELSE email_footer_text END,
          terms_url=CASE WHEN ${input.termsUrl !== undefined} THEN ${input.termsUrl} ELSE terms_url END,
          name = CASE WHEN ${input.name !== undefined} THEN ${input.name} ELSE name END,
          address = CASE WHEN ${input.address !== undefined} THEN ${input.address} ELSE address END,
          timezone = CASE WHEN ${input.timezone !== undefined} THEN ${input.timezone} ELSE timezone END,
          logo_url = CASE WHEN ${input.logoUrl !== undefined} THEN ${input.logoUrl} ELSE logo_url END,
          logo_dark_url = CASE WHEN ${input.logoDarkUrl !== undefined} THEN ${input.logoDarkUrl} ELSE logo_dark_url END,
          icon_url = CASE WHEN ${input.iconUrl !== undefined} THEN ${input.iconUrl} ELSE icon_url END,
          favicon_url = CASE WHEN ${input.faviconUrl !== undefined} THEN ${input.faviconUrl} ELSE favicon_url END,
          cover_url = CASE WHEN ${input.coverUrl !== undefined} THEN ${input.coverUrl} ELSE cover_url END,
          phone = CASE WHEN ${input.phone !== undefined} THEN ${input.phone} ELSE phone END,
          support_email = CASE WHEN ${input.supportEmail !== undefined} THEN ${input.supportEmail} ELSE support_email END,
          booking_mode = CASE WHEN ${input.bookingMode !== undefined} THEN ${input.bookingMode}::"PropertyBookingMode" ELSE booking_mode END,
          min_stay_nights = CASE WHEN ${input.minStayNights !== undefined} THEN ${input.minStayNights} ELSE min_stay_nights END,
          max_stay_nights = CASE WHEN ${input.maxStayNights !== undefined} THEN ${input.maxStayNights} ELSE max_stay_nights END,
          check_in_time = CASE WHEN ${input.checkInTime !== undefined} THEN ${input.checkInTime} ELSE check_in_time END,
          check_out_time = CASE WHEN ${input.checkOutTime !== undefined} THEN ${input.checkOutTime} ELSE check_out_time END,
          rules = CASE WHEN ${input.rules !== undefined} THEN ${input.rules} ELSE rules END,
          advance_booking_days = CASE WHEN ${input.advanceBookingDays !== undefined} THEN ${input.advanceBookingDays} ELSE advance_booking_days END,
          free_cancellation_days_before_arrival = CASE WHEN ${input.freeCancellationDaysBeforeArrival !== undefined} THEN ${input.freeCancellationDaysBeforeArrival} ELSE free_cancellation_days_before_arrival END
        WHERE id = ${propertyId}::uuid
        RETURNING id, name, address, timezone, ${propertyColumns}
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

  async remove(
    tenantId: string,
    propertyId: string,
    actorUserId: string,
    body: unknown,
    actorType: 'TENANT_USER' | 'PLATFORM_ADMIN' = 'TENANT_USER',
  ): Promise<{ deleted: true }> {
    const confirmationName = this.deleteConfirmationName(body);
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const properties = await tx.$queryRaw<Array<{ id: string; name: string }>>`
        SELECT id, name FROM properties
        WHERE tenant_id = ${tenantId}::uuid AND id = ${propertyId}::uuid
        FOR UPDATE
      `;
      const property = properties[0];
      if (!property) throw new NotFoundException('Property not found.');
      if (property.name !== confirmationName)
        throw new BadRequestException('Type the exact property name to confirm deletion.');

      const blockers = await this.propertyDeleteBlockers(tx, tenantId, propertyId);
      if (blockers.length > 0) {
        throw new ConflictException({
          message: 'This property cannot be deleted because dependent records still exist.',
          blockers,
        });
      }

      const deleted = await tx.$queryRaw<Array<{ id: string }>>`
        DELETE FROM properties
        WHERE tenant_id = ${tenantId}::uuid AND id = ${propertyId}::uuid
        RETURNING id
      `;
      if (!deleted[0]) throw new NotFoundException('Property not found.');
      await this.audit.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId,
        actorType,
        action: 'properties.remove',
        targetType: 'property',
        targetId: propertyId,
        details: { name: property.name },
      });
      return { deleted: true };
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
        RETURNING id, name, address, timezone, ${propertyColumns}
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
        RETURNING id, name, address, timezone, ${propertyColumns}
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

  private deleteConfirmationName(body: unknown): string {
    const value = (body ?? {}) as Record<string, unknown>;
    if (typeof value.confirmationName !== 'string' || value.confirmationName.trim() === '')
      throw new BadRequestException('Type the exact property name to confirm deletion.');
    return value.confirmationName.trim();
  }

  private async propertyDeleteBlockers(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
  ): Promise<PropertyDeleteBlocker[]> {
    const rows = await tx.$queryRaw<PropertyDeleteBlocker[]>`
      SELECT resource, count FROM (
        SELECT 'property role templates' AS resource, COUNT(*)::int AS count FROM property_role_templates WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        UNION ALL SELECT 'staff assignments', COUNT(*)::int FROM property_staff_assignments WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        UNION ALL SELECT 'notifications', COUNT(*)::int FROM notifications WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        UNION ALL SELECT 'room types', COUNT(*)::int FROM room_types WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        UNION ALL SELECT 'rooms', COUNT(*)::int FROM rooms WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        UNION ALL SELECT 'room availability records', COUNT(*)::int FROM room_availability WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        UNION ALL SELECT 'availability blocks', COUNT(*)::int FROM availability_blocks WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        UNION ALL SELECT 'inventory units', COUNT(*)::int FROM inventory_units WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        UNION ALL SELECT 'rate plans', COUNT(*)::int FROM rate_plans WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        UNION ALL SELECT 'rate rules', COUNT(*)::int FROM rate_rules WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        UNION ALL SELECT 'room price overrides', COUNT(*)::int FROM room_price_overrides WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        UNION ALL SELECT 'bookings', COUNT(*)::int FROM bookings WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        UNION ALL SELECT 'payments', COUNT(*)::int FROM payments WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        UNION ALL SELECT 'payment provider sessions', COUNT(*)::int FROM payment_provider_sessions WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        UNION ALL SELECT 'integration operations', COUNT(*)::int FROM integration_operations WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        UNION ALL SELECT 'integration connections', COUNT(*)::int FROM property_integration_connections WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        UNION ALL SELECT 'Clock catalog mappings', COUNT(*)::int FROM clock_catalog_mappings WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        UNION ALL SELECT 'manual review items', COUNT(*)::int FROM manual_review_items WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        UNION ALL SELECT 'provider events', COUNT(*)::int FROM provider_events WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        UNION ALL SELECT 'linked restaurants', COUNT(*)::int FROM venues WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        UNION ALL SELECT 'amenities', COUNT(*)::int FROM amenities WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        UNION ALL SELECT 'room type amenities', COUNT(*)::int FROM room_type_amenities WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        UNION ALL SELECT 'room amenities', COUNT(*)::int FROM room_amenities WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
      ) blockers
      WHERE count > 0
      ORDER BY resource
    `;
    return rows;
  }
  private input(body: unknown): {
    name: string;
    address: string;
    timezone: string;
    logoUrl: string | null;
    phone: string | null;
    supportEmail: string | null;
  } {
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
    return {
      name,
      address,
      timezone,
      logoUrl: this.optionalImageUrl(v, 'logoUrl', false) ?? null,
      phone: this.optionalBrandText(v, 'phone', 100, false) ?? null,
      supportEmail: this.optionalSupportEmail(v, false) ?? null,
    };
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
  private updateInput(body: unknown): HotelSettings & {
    name?: string;
    address?: string;
    timezone?: string;
    bookingMode?: BookingMode;
    minStayNights?: number | null;
    maxStayNights?: number | null;
    checkInTime?: string | null;
    checkOutTime?: string | null;
    rules?: string | null;
    advanceBookingDays?: number | null;
    freeCancellationDaysBeforeArrival?: number;
    paymentGateways?: Property['paymentGateways'];
    onlinePaymentHoldMinutes?: number;
    autoRefundOnFreeCancellation?: boolean;
    deductPaymentFeeOnGuestRefund?: boolean;
    clockCancelRefundPolicy?: ClockCancelRefundPolicy;
    clockPaymentFolio?: ClockPaymentFolio;
    brandColour?: string | null;
    emailFooterText?: string | null;
    termsUrl?: string | null;
    logoUrl?: string | null;
    logoDarkUrl?: string | null;
    iconUrl?: string | null;
    faviconUrl?: string | null;
    coverUrl?: string | null;
    phone?: string | null;
    supportEmail?: string | null;
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
        'bookingMode',
        'minStayNights',
        'maxStayNights',
        'checkInTime',
        'checkOutTime',
        'rules',
        'advanceBookingDays',
        'freeCancellationDaysBeforeArrival',
        'paymentGateways',
        'onlinePaymentHoldMinutes',
        'autoRefundOnFreeCancellation',
        'deductPaymentFeeOnGuestRefund',
        'clockCancelRefundPolicy',
        'clockPaymentFolio',
        'brandColour',
        'emailFooterText',
        'termsUrl',
        'logoUrl',
        'logoDarkUrl',
        'iconUrl',
        'faviconUrl',
        'coverUrl',
        'phone',
        'supportEmail',
      ]
        .concat(hotelFields.map((f) => f.key))
        .some(has)
    )
      throw new BadRequestException('At least one property field is required.');
    if (
      has('onlinePaymentHoldMinutes') &&
      (!Number.isInteger(value.onlinePaymentHoldMinutes) ||
        Number(value.onlinePaymentHoldMinutes) < 10 ||
        Number(value.onlinePaymentHoldMinutes) > 1440)
    )
      throw new BadRequestException('Choose a payment hold between 10 and 1440 minutes.');
    if (
      has('deductPaymentFeeOnGuestRefund') &&
      typeof value.deductPaymentFeeOnGuestRefund !== 'boolean'
    )
      throw new BadRequestException(
        'Choose whether a refund the guest asked for keeps back the payment fee.',
      );
    if (
      has('autoRefundOnFreeCancellation') &&
      typeof value.autoRefundOnFreeCancellation !== 'boolean'
    )
      throw new BadRequestException(
        'Choose whether free cancellations are refunded automatically.',
      );
    if (
      has('clockCancelRefundPolicy') &&
      !CLOCK_CANCEL_REFUND_POLICIES.includes(
        value.clockCancelRefundPolicy as ClockCancelRefundPolicy,
      )
    )
      throw new BadRequestException(
        'Choose whether a cancellation made in Clock is never, only inside the free window, or always refunded.',
      );
    if (
      has('clockPaymentFolio') &&
      !CLOCK_PAYMENT_FOLIOS.includes(value.clockPaymentFolio as ClockPaymentFolio)
    )
      throw new BadRequestException(
        'Choose whether website payments are posted to a deposit folio or to the main folio.',
      );
    const brandColour = this.optionalBrandText(value, 'brandColour', 7, true);
    if (brandColour && !/^#[0-9a-fA-F]{6}$/.test(brandColour))
      throw new BadRequestException('Enter a colour such as #123ABC.');
    const emailFooterText = this.optionalBrandText(value, 'emailFooterText', 300, true);
    const termsUrl = this.optionalBrandText(value, 'termsUrl', 2048, true);
    if (termsUrl) {
      try {
        const u = new URL(termsUrl);
        if (u.protocol !== 'https:' || u.username || u.password) throw new Error();
      } catch {
        throw new BadRequestException('Enter a full https terms and conditions link.');
      }
    }
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
    const bookingMode = (() => {
      if (!has('bookingMode')) return undefined;
      const mode = value.bookingMode;
      if (mode === 'ROOM_TYPE_ONLY' || mode === 'INDIVIDUAL_ROOM_ONLY' || mode === 'MIXED')
        return mode;
      throw new BadRequestException('bookingMode must be a valid booking mode.');
    })();
    const optionalInteger = (key: 'minStayNights' | 'maxStayNights' | 'advanceBookingDays') => {
      if (!has(key)) return undefined;
      const number = value[key];
      if (number === null) return null;
      const message = checkBookingLimit(key, number);
      if (message) throw new BadRequestException(message);
      return number as number | undefined;
    };
    const freeCancellationDaysBeforeArrival = (() => {
      if (!has('freeCancellationDaysBeforeArrival')) return undefined;
      const number = value.freeCancellationDaysBeforeArrival;
      if (typeof number !== 'number' || !Number.isInteger(number) || number < 0)
        throw new BadRequestException(
          'freeCancellationDaysBeforeArrival must be a non-negative integer.',
        );
      return number;
    })();
    const optionalText = (key: 'checkInTime' | 'checkOutTime') => {
      if (!has(key)) return undefined;
      if (value[key] === null) return null;
      if (typeof value[key] !== 'string')
        throw new BadRequestException(`${key} must be a string or null.`);
      return value[key];
    };
    const rules = (() => {
      if (!has('rules')) return undefined;
      if (value.rules === null) return null;
      if (typeof value.rules !== 'string')
        throw new BadRequestException('rules must be a string or null.');
      return value.rules.trim() || null;
    })();
    return {
      name,
      address,
      timezone,
      bookingMode,
      minStayNights: optionalInteger('minStayNights'),
      maxStayNights: optionalInteger('maxStayNights'),
      checkInTime: optionalText('checkInTime'),
      checkOutTime: optionalText('checkOutTime'),
      rules,
      advanceBookingDays: optionalInteger('advanceBookingDays'),
      freeCancellationDaysBeforeArrival,
      ...hotelInput(value),
      paymentGateways: has('paymentGateways')
        ? this.paymentGateways(value.paymentGateways)
        : undefined,
      onlinePaymentHoldMinutes: has('onlinePaymentHoldMinutes')
        ? (value.onlinePaymentHoldMinutes as number)
        : undefined,
      autoRefundOnFreeCancellation: has('autoRefundOnFreeCancellation')
        ? (value.autoRefundOnFreeCancellation as boolean)
        : undefined,
      deductPaymentFeeOnGuestRefund: has('deductPaymentFeeOnGuestRefund')
        ? (value.deductPaymentFeeOnGuestRefund as boolean)
        : undefined,
      clockCancelRefundPolicy: has('clockCancelRefundPolicy')
        ? (value.clockCancelRefundPolicy as ClockCancelRefundPolicy)
        : undefined,
      clockPaymentFolio: has('clockPaymentFolio')
        ? (value.clockPaymentFolio as ClockPaymentFolio)
        : undefined,
      brandColour,
      emailFooterText,
      termsUrl,
      logoUrl: this.optionalImageUrl(value, 'logoUrl', true),
      logoDarkUrl: this.optionalImageUrl(value, 'logoDarkUrl', true),
      iconUrl: this.optionalImageUrl(value, 'iconUrl', true),
      faviconUrl: this.optionalImageUrl(value, 'faviconUrl', true),
      coverUrl: this.optionalImageUrl(value, 'coverUrl', true),
      phone: this.optionalBrandText(value, 'phone', 100, true),
      supportEmail: this.optionalSupportEmail(value, true),
    };
  }

  private serverLogoKey(url: URL): string | null {
    const configured = process.env.MEDIA_PUBLIC_BASE_URL?.replace(/\/$/, '');
    if (!configured) return null;
    const base = new URL(configured);
    const key = url.searchParams.get('key');
    return url.origin === base.origin &&
      url.pathname === base.pathname + '/image' &&
      !url.hash &&
      [...url.searchParams.keys()].length === 1 &&
      key &&
      /^server-v1\/library\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:png|jpe?g|webp)$/i.test(
        key,
      )
      ? key
      : null;
  }

  /** A brand image address: one from this hotel's photo library, or a public https PNG, JPG or WebP. */
  private optionalImageUrl(
    value: Record<string, unknown>,
    field: 'logoUrl' | 'logoDarkUrl' | 'iconUrl' | 'faviconUrl' | 'coverUrl',
    allowAbsent: boolean,
  ): string | null | undefined {
    if (!Object.hasOwn(value, field)) return allowAbsent ? undefined : null;
    const logoUrl = value[field];
    if (logoUrl === null || logoUrl === '') return null;
    if (typeof logoUrl !== 'string' || logoUrl.trim().length > 2048)
      throw new BadRequestException(`Invalid ${field}.`);
    try {
      const url = new URL(logoUrl.trim());
      if (this.serverLogoKey(url) && !url.username && !url.password) return url.toString();
      // Local development serves photos from http://localhost; production only ever accepts https.
      const localDev =
        process.env.NODE_ENV !== 'production' &&
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(url.hostname);
      if (
        (url.protocol !== 'https:' && !localDev) ||
        url.username ||
        url.password ||
        !/\.(png|jpe?g|webp)$/i.test(url.pathname)
      )
        throw new Error();
      return url.toString();
    } catch {
      throw new BadRequestException(
        'Choose a public https PNG, JPG or WebP logo from the photo library.',
      );
    }
  }

  private optionalBrandText(
    value: Record<string, unknown>,
    key: 'phone' | 'brandColour' | 'emailFooterText' | 'termsUrl',
    maxLength: number,
    allowAbsent: boolean,
  ): string | null | undefined {
    if (!Object.hasOwn(value, key)) return allowAbsent ? undefined : null;
    const text = value[key];
    if (text === null || text === '') return null;
    if (typeof text !== 'string' || !text.trim() || text.trim().length > maxLength)
      throw new BadRequestException(`Invalid ${key}.`);
    if (key === 'phone') {
      const phone = normaliseProfileValue('phone', text.trim());
      const message = checkProfileField('phone', phone, { year: new Date().getFullYear() });
      if (message) throw new BadRequestException(message);
      return phone as string;
    }
    return text.trim();
  }

  private optionalSupportEmail(
    value: Record<string, unknown>,
    allowAbsent: boolean,
  ): string | null | undefined {
    if (!Object.hasOwn(value, 'supportEmail')) return allowAbsent ? undefined : null;
    const email = value.supportEmail;
    if (email === null || email === '') return null;
    if (
      typeof email !== 'string' ||
      !email.trim() ||
      email.trim().length > 320 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    )
      throw new BadRequestException('supportEmail must be a valid email address.');
    return email.trim().toLowerCase();
  }
}
