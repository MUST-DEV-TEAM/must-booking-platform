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
          b.ends_on::text AS "endsOn", b.nightly_rates AS "nightlyRates",
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
      return { row, staff };
    });
    if (!notification) return;
    const { row, staff } = notification;
    const guestName = [row.firstName, row.lastName].filter(Boolean).join(' ').trim() || row.email;
    const brand = {
      name: row.propertyName, logoUrl: row.logoUrl, supportEmail: row.supportEmail,
      phone: row.propertyPhone, websiteUrl: row.publicWebsiteOrigin, address: row.propertyAddress,
    };
    const details = {
      bookingId, bookingReference: row.externalReference, brand, guest: { name: guestName },
      stay: { startsOn: row.startsOn, endsOn: row.endsOn }, roomName: row.roomName,
      guestCount: 1, nightlyRates: row.nightlyRates ?? undefined,
    };
    await this.notifications.sendBookingCancelledEmailSafely({ to: row.email, ...details });
    for (const recipient of staff)
      await this.notifications.sendBookingCancelledStaffNotificationSafely({
        ...details, staffUserId: recipient.staffUserId, to: recipient.email,
        guest: { name: guestName, email: row.email, phone: row.phone },
      });
  }
}
