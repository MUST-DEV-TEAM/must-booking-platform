import { emailBrandExtraP } from './email-brand-columns';
import { bookingContactSql } from '../booking/booking-contact';
import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { maskEmail } from '../booking/mask-email';
import type { MailOrderRoom, PaymentProviderContext } from '@must/domain-contracts';

import { CancellationLinkService } from '../booking/cancellation-link.service';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { PaymentNotificationService } from './payment-notification.service';
import { staffDeliveryGroups, staffRecipients } from './notification-recipients';

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
  brandColour: string | null;
  emailFooterText: string | null;
  legalName: string | null;
  taxNumber: string | null;
  latitude: number | null;
  longitude: number | null;
  directions: string | null;
  dateFormat: string | null;
  onlineProfiles: Record<string, string> | null;
  termsUrl: string | null;
  logoUrl: string | null;
  supportEmail: string | null;
  propertyPhone: string | null;
  publicWebsiteOrigin: string | null;
  wordpressConnectedAt: Date | null;
  propertyAddress: string | null;
  orderReference: string | null;
};

/** The hotel's own website address for the manage link, only when no WordPress plugin is connected to it. */
function customSiteOrigin(
  row: Pick<BookingEmailRow, 'publicWebsiteOrigin' | 'wordpressConnectedAt'>,
) {
  return row.publicWebsiteOrigin && !row.wordpressConnectedAt ? row.publicWebsiteOrigin : null;
}

type OrderRoomRow = { roomName: string; guestCount: number; amount: string; orderTotal: string };

@Injectable()
export class BookingConfirmationNotificationService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(CancellationLinkService) private readonly cancellations: CancellationLinkService,
    @Inject(PaymentNotificationService) private readonly notifications: PaymentNotificationService,
  ) {}

  /** The address a booking's emails go to, masked for the guest ("a***@icloud.com"); null when there is none. */
  async emailHint(context: PaymentProviderContext, bookingId: string): Promise<string | null> {
    const rows = await this.database.withTenantTransaction(
      context,
      (tx) => tx.$queryRaw<Array<{ email: string | null }>>`
        SELECT ${bookingContactSql.email} AS email
        FROM bookings b LEFT JOIN guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
        WHERE b.id = ${bookingId}::uuid AND b.tenant_id = ${context.tenantId}::uuid
          AND b.property_id = ${context.propertyId}::uuid`,
    );
    return maskEmail(rows[0]?.email);
  }

  /**
   * Sends the guest the confirmation again, to the address on the booking or to another one the guest or staff typed
   * (G-96). A delivered email can still sit in a junk folder or go to an address nobody checks. Only a confirmed
   * booking has a confirmation, and at most 3 resends a day per booking keep this from being used to spam an address.
   * Staff are not notified again.
   */
  async resendToGuest(
    context: PaymentProviderContext,
    bookingId: string,
    to?: string,
  ): Promise<
    | { ok: true; sentTo: string | null }
    | { ok: false; code: 'NOT_CONFIRMED' | 'NO_ADDRESS' | 'RESEND_LIMIT'; message: string }
  > {
    const state = await this.database.withTenantTransaction(context, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ status: string; email: string | null }>>`
        SELECT b.status::text AS status, ${bookingContactSql.email} AS email
        FROM bookings b LEFT JOIN guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
        WHERE b.id = ${bookingId}::uuid AND b.tenant_id = ${context.tenantId}::uuid
          AND b.property_id = ${context.propertyId}::uuid`;
      const recent = await tx.$queryRaw<Array<{ count: number }>>`
        SELECT count(*)::int AS count FROM email_messages
        WHERE tenant_id = ${context.tenantId}::uuid AND property_id = ${context.propertyId}::uuid
          AND booking_id = ${bookingId}::uuid AND idempotency_key LIKE 'payment-confirmation/resend:%'
          AND created_at > now() - interval '24 hours'`;
      return { row: rows[0] ?? null, recent: recent[0]?.count ?? 0 };
    });
    if (!state.row || state.row.status !== 'CONFIRMED')
      return {
        ok: false,
        code: 'NOT_CONFIRMED',
        message: 'Only a confirmed booking has a confirmation to send again.',
      };
    const address = (to ?? state.row.email ?? '').trim();
    if (!address)
      return {
        ok: false,
        code: 'NO_ADDRESS',
        message: 'There is no email address on this booking.',
      };
    if (state.recent >= 3)
      return {
        ok: false,
        code: 'RESEND_LIMIT',
        message:
          'The confirmation was already sent again 3 times today. Please try again tomorrow.',
      };
    await this.sendAfterConfirmation(context, bookingId, `resend:${bookingId}:${randomUUID()}`, {
      guestOnly: true,
      to: address,
    });
    return { ok: true, sentTo: maskEmail(address) };
  }

  async sendAfterConfirmation(
    context: PaymentProviderContext,
    bookingId: string,
    paymentId: string,
    options: { guestOnly?: boolean; to?: string } = {},
  ): Promise<void> {
    const notification = await this.database.withTenantTransaction(context, async (tx) => {
      const rows = await tx.$queryRaw<BookingEmailRow[]>`
        SELECT ${bookingContactSql.email} AS email, ${bookingContactSql.firstName} AS "firstName", ${bookingContactSql.lastName} AS "lastName", ${bookingContactSql.phone} AS phone,
          b.guest_session_id AS "guestSessionId", b.guest_return_url AS "guestReturnUrl",
          b.total_amount::text AS amount, rp.currency, b.external_reference AS "externalReference",
          b.special_requests AS "specialRequests", b.starts_on::text AS "startsOn", b.ends_on::text AS "endsOn",
          COALESCE(r.name, rt.name) AS "roomName", b.payment_method AS "paymentMethod",
          (b.adults + b.children) AS "guestCount",
          b.nightly_rates AS "nightlyRates",
          p.name AS "propertyName", p.brand_colour AS "brandColour",p.email_footer_text AS "emailFooterText",p.terms_url AS "termsUrl",p.logo_url AS "logoUrl", p.support_email AS "supportEmail",
          p.phone AS "propertyPhone", p.public_website_origin AS "publicWebsiteOrigin", p.wordpress_connected_at AS "wordpressConnectedAt",
          p.address AS "propertyAddress", ${emailBrandExtraP}, b.order_reference AS "orderReference"
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
      if (!row.guestSessionId) {
        const access = await tx.$queryRaw<
          Array<{ session: string }>
        >`UPDATE bookings SET guest_session_id=COALESCE(guest_session_id,gen_random_uuid()) WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND id=${bookingId}::uuid RETURNING guest_session_id AS session`;
        row.guestSessionId = access[0].session;
      }

      // A multi-room order is paid and confirmed as one, so it gets one email that
      // lists every room, not one email per room (or only the first room).
      const orderRooms = row.orderReference
        ? await tx.$queryRaw<OrderRoomRow[]>`
            SELECT COALESCE(r.name, rt.name) AS "roomName", (b.adults + b.children) AS "guestCount",
              b.total_amount::text AS amount, SUM(b.total_amount) OVER ()::text AS "orderTotal"
            FROM bookings b
            JOIN room_types rt ON rt.tenant_id = b.tenant_id AND rt.property_id = b.property_id AND rt.id = b.room_type_id
            LEFT JOIN rooms r ON r.tenant_id = b.tenant_id AND r.property_id = b.property_id AND r.id = b.room_id
            WHERE b.tenant_id = ${context.tenantId}::uuid AND b.property_id = ${context.propertyId}::uuid
              AND b.order_reference = ${row.orderReference} AND b.status <> 'CANCELLED'::"BookingStatus"
            ORDER BY b.order_room_number, b.id
          `
        : [];
      const staff = await staffRecipients(tx, context, 'new_booking');
      return { row, orderRooms, staff };
    });
    if (!notification) return;
    const { orderRooms, staff } = notification;
    const row =
      orderRooms.length > 1 ? this.orderSummary(notification.row, orderRooms) : notification.row;
    const rooms: MailOrderRoom[] | undefined =
      orderRooms.length > 1
        ? orderRooms.map((room) => ({
            roomName: room.roomName,
            guestCount: Number(room.guestCount),
            amount: { amount: room.amount, currency: row.currency },
          }))
        : undefined;
    const brand = {
      name: row.propertyName,
      brandColour: row.brandColour,
      emailFooterText: row.emailFooterText,
      legalName: row.legalName,
      taxNumber: row.taxNumber,
      latitude: row.latitude,
      longitude: row.longitude,
      directions: row.directions,
      dateFormat: row.dateFormat,
      onlineProfiles: row.onlineProfiles,
      termsUrl: row.termsUrl,
      logoUrl: row.logoUrl,
      supportEmail: row.supportEmail,
      phone: row.propertyPhone,
      websiteUrl: row.publicWebsiteOrigin,
      address: row.propertyAddress,
    };
    const guestName = [row.firstName, row.lastName].filter(Boolean).join(' ').trim() || row.email;
    await this.notifications.sendPaymentConfirmationEmailSafely(
      {
        bookingId,
        bookingReference: row.externalReference,
        paymentId,
        to: options.to ?? row.email,
        amount: { amount: row.amount, currency: row.currency },
        brand,
        paymentMethod: this.guestPaymentMethod(row.paymentMethod),
        guest: { name: guestName },
        stay: { startsOn: row.startsOn, endsOn: row.endsOn },
        roomName: row.roomName,
        guestCount: row.guestCount,
        nightlyRates: row.nightlyRates ?? undefined,
        rooms,
        specialRequests: row.specialRequests,
        cancellationUrl: row.guestSessionId
          ? this.manageUrl(
              context,
              bookingId,
              row.guestSessionId,
              row.endsOn,
              customSiteOrigin(row),
            )
          : undefined,
      },
      context,
    );
    if (options.guestOnly) return;
    for (const recipient of staffDeliveryGroups(staff)) {
      await this.notifications.sendNewBookingStaffNotificationSafely(
        {
          bookingId,
          bookingReference: row.externalReference,
          paymentId,
          staffUserId: recipient.staffUserId,
          ...(recipient.envelope ? { recipientEnvelope: recipient.envelope } : {}),
          to: recipient.email,
          guest: { name: guestName, email: row.email, phone: row.phone },
          stay: { startsOn: row.startsOn, endsOn: row.endsOn },
          roomName: row.roomName,
          amount: { amount: row.amount, currency: row.currency },
          brand,
          guestCount: row.guestCount,
          paymentMethod: this.guestPaymentMethod(row.paymentMethod),
          nightlyRates: row.nightlyRates ?? undefined,
          rooms,
          specialRequests: row.specialRequests,
        },
        context,
      );
    }
  }

  /** The order as a whole: its reference, total and guests; per-room nightly rates
   * differ, so the email shows the stay dates instead. */
  private orderSummary(row: BookingEmailRow, rooms: OrderRoomRow[]): BookingEmailRow {
    return {
      ...row,
      externalReference: row.orderReference ?? row.externalReference,
      amount: rooms[0]!.orderTotal,
      roomName: `${rooms.length} rooms`,
      guestCount: rooms.reduce((sum, room) => sum + Number(room.guestCount), 0),
      nightlyRates: null,
    };
  }

  private manageUrl(
    context: { tenantId: string; propertyId: string },
    bookingId: string,
    guestSessionId: string,
    endsOn: string,
    siteOrigin: string | null,
  ) {
    // A custom website (no WordPress plugin) hosts its own manage page and already knows the hotel.
    const url = new URL(
      '/booking/manage',
      siteOrigin ?? (process.env.WEB_APP_URL || 'http://localhost:3001'),
    );
    // The ids stay in the link: harmless for a custom site, and the dashboard's own manage page needs them.
    url.searchParams.set('tenant', context.tenantId);
    url.searchParams.set('property', context.propertyId);
    url.searchParams.set('booking', bookingId);
    url.searchParams.set(
      'token',
      this.cancellations.create(
        { ...context, bookingId, guestSessionId },
        undefined,
        new Date(Date.parse(endsOn + 'T23:59:59Z') + 86400000).toISOString(),
      ),
    );
    return url.toString();
  }

  private guestPaymentMethod(value: string): 'stripe' | 'pokpay' | 'pay_at_hotel' {
    if (value === 'POKPAY') return 'pokpay';
    if (value === 'PAY_AT_HOTEL') return 'pay_at_hotel';
    return 'stripe';
  }
}
