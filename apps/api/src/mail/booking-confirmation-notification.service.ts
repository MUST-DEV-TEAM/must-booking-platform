import { Inject, Injectable } from '@nestjs/common';
import type { PaymentProviderContext } from '@must/domain-contracts';

import { CancellationLinkService } from '../booking/cancellation-link.service';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { PaymentNotificationService } from './payment-notification.service';

type BookingEmailRow = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  guestSessionId: string;
  guestReturnUrl: string | null;
  amount: string;
  currency: string;
  externalReference: string;
  specialRequests: string | null;
  startsOn: string;
  endsOn: string;
  roomName: string;
  paymentMethod: string;
  guestCount: number;
  nightlyRates: Array<{ date: string; amount: string }> | null;
  propertyName: string;
  logoUrl: string | null;
  supportEmail: string | null;
  propertyPhone: string | null;
  publicWebsiteOrigin: string | null;
  propertyAddress: string | null;
};

type StaffRecipient = { staffUserId: string; email: string };

@Injectable()
export class BookingConfirmationNotificationService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(CancellationLinkService) private readonly cancellations: CancellationLinkService,
    @Inject(PaymentNotificationService) private readonly notifications: PaymentNotificationService,
  ) {}

  async sendAfterConfirmation(
    context: PaymentProviderContext,
    bookingId: string,
    paymentId: string,
  ): Promise<void> {
    const notification = await this.database.withTenantTransaction(context, async (tx) => {
      const rows = await tx.$queryRaw<BookingEmailRow[]>`
        SELECT g.email, g.first_name AS "firstName", g.last_name AS "lastName", g.phone,
          b.guest_session_id AS "guestSessionId", b.guest_return_url AS "guestReturnUrl",
          b.total_amount::text AS amount, rp.currency, b.external_reference AS "externalReference",
          b.special_requests AS "specialRequests", b.starts_on::text AS "startsOn", b.ends_on::text AS "endsOn",
          COALESCE(r.name, rt.name) AS "roomName", b.payment_method AS "paymentMethod", b.guest_count AS "guestCount",
          b.nightly_rates AS "nightlyRates",
          p.name AS "propertyName", p.logo_url AS "logoUrl", p.support_email AS "supportEmail",
          p.phone AS "propertyPhone", p.public_website_origin AS "publicWebsiteOrigin",
          p.address AS "propertyAddress"
        FROM bookings b
        JOIN properties p ON p.tenant_id = b.tenant_id AND p.id = b.property_id
        JOIN guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
        JOIN rate_plans rp ON rp.tenant_id = b.tenant_id AND rp.property_id = b.property_id AND rp.id = b.rate_plan_id
        JOIN room_types rt ON rt.tenant_id = b.tenant_id AND rt.property_id = b.property_id AND rt.id = b.room_type_id
        LEFT JOIN rooms r ON r.tenant_id = b.tenant_id AND r.property_id = b.property_id AND r.id = b.room_id
        WHERE b.id = ${bookingId}::uuid AND b.tenant_id = ${context.tenantId}::uuid
          AND b.property_id = ${context.propertyId}::uuid
      `;
      const row = rows[0] ?? null;
      if (!row) return null;
      const staff = await tx.$queryRaw<StaffRecipient[]>`
        SELECT psa.user_id AS "staffUserId", u.email
        FROM property_staff_assignments psa
        JOIN users u ON u.id = psa.user_id
        WHERE psa.tenant_id = ${context.tenantId}::uuid
          AND psa.property_id = ${context.propertyId}::uuid
      `;
      return { row, staff };
    });
    if (!notification) return;
    const { row, staff } = notification;
    const brand = {
      name: row.propertyName,
      logoUrl: row.logoUrl,
      supportEmail: row.supportEmail,
      phone: row.propertyPhone,
      websiteUrl: row.publicWebsiteOrigin,
      address: row.propertyAddress,
    };
    const guestName = [row.firstName, row.lastName].filter(Boolean).join(' ').trim() || row.email;
    await this.notifications.sendPaymentConfirmationEmailSafely({
      bookingId,
      bookingReference: row.externalReference,
      paymentId,
      to: row.email,
      amount: { amount: row.amount, currency: row.currency },
      brand,
      paymentMethod: this.guestPaymentMethod(row.paymentMethod),
      guest: { name: guestName },
      stay: { startsOn: row.startsOn, endsOn: row.endsOn },
      roomName: row.roomName,
      guestCount: row.guestCount,
      nightlyRates: row.nightlyRates ?? undefined,
      specialRequests: row.specialRequests,
      cancellationUrl: row.guestReturnUrl
        ? this.cancellationUrl(
            row.guestReturnUrl,
            bookingId,
            this.cancellations.create({
              ...context,
              bookingId,
              guestSessionId: row.guestSessionId,
            }),
          )
        : undefined,
    });
    for (const recipient of staff) {
      await this.notifications.sendNewBookingStaffNotificationSafely({
        bookingId,
        bookingReference: row.externalReference,
        paymentId,
        staffUserId: recipient.staffUserId,
        to: recipient.email,
        guest: { name: guestName, email: row.email, phone: row.phone },
        stay: { startsOn: row.startsOn, endsOn: row.endsOn },
        roomName: row.roomName,
        amount: { amount: row.amount, currency: row.currency },
        brand,
        guestCount: row.guestCount,
        paymentMethod: this.guestPaymentMethod(row.paymentMethod),
        nightlyRates: row.nightlyRates ?? undefined,
        specialRequests: row.specialRequests,
      });
    }
  }

  private cancellationUrl(base: string, bookingId: string, cancellationToken: string): string {
    const url = new URL(base);
    url.searchParams.set('booking_id', bookingId);
    url.searchParams.set('cancellationToken', cancellationToken);
    url.searchParams.set('must_action', 'cancel');
    return url.toString();
  }

  private guestPaymentMethod(value: string): 'stripe' | 'pokpay' | 'pay_at_hotel' {
    if (value === 'POKPAY') return 'pokpay';
    if (value === 'PAY_AT_HOTEL') return 'pay_at_hotel';
    return 'stripe';
  }
}
