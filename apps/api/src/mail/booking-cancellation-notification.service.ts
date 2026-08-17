import { Inject, Injectable } from '@nestjs/common';
import type { PaymentProviderContext } from '@must/domain-contracts';

import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { PaymentNotificationService } from './payment-notification.service';

type CancellationRow = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  externalReference: string;
  startsOn: string;
  endsOn: string;
  guestCount: number;
  nightlyRates: Array<{ date: string; amount: string }> | null;
  roomName: string;
  propertyName: string;
  logoUrl: string | null;
  supportEmail: string | null;
  propertyPhone: string | null;
  publicWebsiteOrigin: string | null;
  propertyAddress: string | null;
};

type StaffRecipient = { staffUserId: string; email: string };

type CancellationRefund = {
  refundAmount: string | null;
  refundCurrency: string | null;
  chargeAmount: string | null;
  chargeCurrency: string | null;
  paymentProvider: string | null;
  paymentMethod: string | null;
  needsManualAction: boolean;
};

@Injectable()
export class BookingCancellationNotificationService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(PaymentNotificationService) private readonly notifications: PaymentNotificationService,
  ) {}

  async sendAfterCancellation(context: PaymentProviderContext, bookingId: string): Promise<void> {
    const notification = await this.database.withTenantTransaction(context, async (tx) => {
      const rows = await tx.$queryRaw<CancellationRow[]>`
        SELECT g.email, g.first_name AS "firstName", g.last_name AS "lastName", g.phone,
          b.external_reference AS "externalReference", b.starts_on::text AS "startsOn",
          b.ends_on::text AS "endsOn", b.guest_count AS "guestCount", b.nightly_rates AS "nightlyRates",
          COALESCE(r.name, rt.name) AS "roomName", p.name AS "propertyName",
          p.logo_url AS "logoUrl", p.support_email AS "supportEmail", p.phone AS "propertyPhone",
          p.public_website_origin AS "publicWebsiteOrigin", p.address AS "propertyAddress"
        FROM bookings b
        JOIN properties p ON p.tenant_id = b.tenant_id AND p.id = b.property_id
        JOIN guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
        JOIN room_types rt ON rt.tenant_id = b.tenant_id AND rt.property_id = b.property_id AND rt.id = b.room_type_id
        LEFT JOIN rooms r ON r.tenant_id = b.tenant_id AND r.property_id = b.property_id AND r.id = b.room_id
        WHERE b.id = ${bookingId}::uuid AND b.tenant_id = ${context.tenantId}::uuid
          AND b.property_id = ${context.propertyId}::uuid AND b.status = 'CANCELLED'::"BookingStatus"
      `;
      const row = rows[0];
      if (!row) return null;
      const staff = await tx.$queryRaw<StaffRecipient[]>`
        SELECT psa.user_id AS "staffUserId", u.email
        FROM property_staff_assignments psa JOIN users u ON u.id = psa.user_id
        WHERE psa.tenant_id = ${context.tenantId}::uuid AND psa.property_id = ${context.propertyId}::uuid
      `;
      const refunds = await tx.$queryRaw<CancellationRefund[]>`
        SELECT refunded.amount::text AS "refundAmount", refunded.currency AS "refundCurrency",
          charged.amount::text AS "chargeAmount", charged.currency AS "chargeCurrency",
          charged.provider AS "paymentProvider", charged.method AS "paymentMethod",
          EXISTS (
            SELECT 1 FROM manual_review_items mri
            WHERE mri.tenant_id = ${context.tenantId}::uuid
              AND mri.property_id = ${context.propertyId}::uuid
              AND mri.reference_type = 'booking' AND mri.reference_id = ${bookingId}
              AND mri.context @> '{"automaticRefund":true}'::jsonb
          ) AS "needsManualAction"
        FROM (SELECT 1) seed
        LEFT JOIN LATERAL (
          SELECT amount, currency FROM payments
          WHERE tenant_id = ${context.tenantId}::uuid AND property_id = ${context.propertyId}::uuid
            AND booking_id = ${bookingId}::uuid AND kind = 'REFUND'::"PaymentKind"
            AND status = 'REFUNDED'
          ORDER BY created_at DESC LIMIT 1
        ) refunded ON TRUE
        LEFT JOIN LATERAL (
          SELECT provider, method, amount, currency FROM payments
          WHERE tenant_id = ${context.tenantId}::uuid AND property_id = ${context.propertyId}::uuid
            AND booking_id = ${bookingId}::uuid AND kind = 'CHARGE'::"PaymentKind"
          ORDER BY created_at DESC LIMIT 1
        ) charged ON TRUE
      `;
      return { row, staff, refund: refunds[0] };
    });
    if (!notification) return;
    const { row, staff, refund } = notification;
    const guestName = [row.firstName, row.lastName].filter(Boolean).join(' ').trim() || row.email;
    const brand = {
      name: row.propertyName,
      logoUrl: row.logoUrl,
      supportEmail: row.supportEmail,
      phone: row.propertyPhone,
      websiteUrl: row.publicWebsiteOrigin,
      address: row.propertyAddress,
    };
    const details = {
      bookingId,
      bookingReference: row.externalReference,
      brand,
      guest: { name: guestName },
      stay: { startsOn: row.startsOn, endsOn: row.endsOn },
      roomName: row.roomName,
      guestCount: row.guestCount,
      nightlyRates: row.nightlyRates ?? undefined,
    };
    const refundDetails = refund?.needsManualAction
      ? (refund.refundAmount ?? refund.chargeAmount) &&
        (refund.refundCurrency ?? refund.chargeCurrency)
        ? {
            status: 'manual_action' as const,
            amount: {
              amount: refund.refundAmount ?? refund.chargeAmount!,
              currency: refund.refundCurrency ?? refund.chargeCurrency!,
            },
            paymentMethod: refund.paymentMethod ?? refund.paymentProvider,
          }
        : undefined
      : refund?.refundAmount && refund.refundCurrency
        ? {
            status: 'processed' as const,
            amount: { amount: refund.refundAmount, currency: refund.refundCurrency },
            paymentMethod: refund.paymentMethod ?? refund.paymentProvider,
          }
        : undefined;
    await this.notifications.sendBookingCancelledEmailSafely({ to: row.email, ...details });
    for (const recipient of staff)
      await this.notifications.sendBookingCancelledStaffNotificationSafely({
        ...details,
        staffUserId: recipient.staffUserId,
        to: recipient.email,
        guest: { name: guestName, email: row.email, phone: row.phone },
        ...(refundDetails ? { refund: refundDetails } : {}),
      });
  }
}
