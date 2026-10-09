import { Inject, Injectable, Logger } from '@nestjs/common';
import type { MailBrand } from '@must/domain-contracts';

import { TenantDatabaseService, type TenantTransaction } from '../tenancy/tenant-database.service';
import {
  bookingChangedEmail,
  paymentNotCompletedEmail,
  type GuestStay,
} from './booking-update-email-content';
import {
  renderTemplate,
  savedTemplate,
  stayTemplateValues,
  type EmailTemplateKey,
  type SavedTemplate,
} from './email-templates';
import { MailDeliveryService } from './mail-delivery.service';
import { guestNotificationEnabled } from './notification-recipients';

type Context = { tenantId: string; propertyId: string };
type StayRow = {
  id: string;
  reference: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  startsOn: string;
  endsOn: string;
  roomName: string;
  guestCount: number;
};

/** What a booking looked like before the hotel changed it. */
export type PreviousStay = { startsOn: string; endsOn: string; roomTypeId: string };

/**
 * Guest emails about a booking that changed after it was made (email plan Step 2c):
 * the hotel moved its dates or room type, or the guest never completed the payment.
 * Direct bookings only: Clock-imported reservations (CLOCK-…) can come from other
 * sales channels whose guests we may not email. Never throws.
 */
@Injectable()
export class BookingUpdateNotificationService {
  private readonly logger = new Logger(BookingUpdateNotificationService.name);

  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(MailDeliveryService) private readonly delivery: MailDeliveryService,
  ) {}

  async sendBookingChanged(
    context: Context,
    bookingId: string,
    previous: PreviousStay,
  ): Promise<void> {
    try {
      const work = await this.database.withTenantTransaction(context, async (tx) => {
        if (!(await guestNotificationEnabled(tx, context, 'booking_changed'))) return null;
        const rows = await this.stayRows(tx, context, 'b.id = $3::uuid', bookingId, 'CONFIRMED');
        const row = rows[0];
        if (!row) return null;
        const [previousRoom] = await tx.$queryRaw<Array<{ name: string }>>`
          SELECT name FROM room_types WHERE tenant_id = ${context.tenantId}::uuid
            AND property_id = ${context.propertyId}::uuid AND id = ${previous.roomTypeId}::uuid
        `;
        return {
          row,
          previousRoom: previousRoom?.name ?? '',
          brand: await this.brand(tx, context),
          template: await savedTemplate(tx, context, 'booking_changed'),
        };
      });
      if (!work) return;
      const stay = this.stay([work.row]);
      const email = bookingChangedEmail(
        stay,
        {
          startsOn: previous.startsOn,
          endsOn: previous.endsOn,
          // Same room type as before: only the dates changed.
          roomName:
            previous.roomTypeId === work.row.roomTypeId
              ? stay.rooms[0]!.roomName
              : work.previousRoom,
        },
        work.brand,
        this.message('booking_changed', work.template, stay, work.brand),
      );
      await this.delivery.dispatch(
        'rendered',
        {
          ...email,
          idempotencyKey: `booking-changed/${bookingId}/${stay.startsOn}/${stay.endsOn}/${work.row.roomTypeId}`,
        },
        context,
      );
    } catch (error) {
      this.logger.error(
        `Could not send the booking-changed email for booking ${bookingId}.`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** One email per booking or multi-room order whose payment window ran out. */
  async sendPaymentNotCompleted(context: Context, bookingId: string): Promise<void> {
    try {
      const work = await this.database.withTenantTransaction(context, async (tx) => {
        if (!(await guestNotificationEnabled(tx, context, 'payment_not_completed'))) return null;
        const rows = await this.stayRows(
          tx,
          context,
          `(b.id = $3::uuid OR b.order_reference = (
             SELECT order_reference FROM bookings WHERE tenant_id = $1::uuid AND property_id = $2::uuid AND id = $3::uuid))`,
          bookingId,
          'EXPIRED',
        );
        if (!rows.length) return null;
        return {
          rows,
          brand: await this.brand(tx, context),
          template: await savedTemplate(tx, context, 'payment_not_completed'),
        };
      });
      if (!work) return;
      const stay = this.stay(work.rows);
      await this.delivery.dispatch(
        'rendered',
        {
          ...paymentNotCompletedEmail(
            stay,
            work.brand,
            this.message('payment_not_completed', work.template, stay, work.brand),
          ),
          idempotencyKey: `payment-not-completed/${stay.reference}`,
        },
        context,
      );
    } catch (error) {
      this.logger.error(
        `Could not send the payment-not-completed email for booking ${bookingId}.`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private stayRows(
    tx: TenantTransaction,
    context: Context,
    where: string,
    bookingId: string,
    status: string,
  ): Promise<Array<StayRow & { roomTypeId: string }>> {
    return tx.$queryRawUnsafe(
      `SELECT b.id::text, COALESCE(b.order_reference, b.external_reference) AS reference,
         g.email, g.first_name AS "firstName", g.last_name AS "lastName",
         b.starts_on::text AS "startsOn", b.ends_on::text AS "endsOn",
         COALESCE(r.name, rt.name) AS "roomName", (b.adults + b.children)::int AS "guestCount",
         b.room_type_id::text AS "roomTypeId"
       FROM bookings b
       JOIN guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
       JOIN room_types rt ON rt.tenant_id = b.tenant_id AND rt.property_id = b.property_id AND rt.id = b.room_type_id
       LEFT JOIN rooms r ON r.tenant_id = b.tenant_id AND r.property_id = b.property_id AND r.id = b.room_id
       WHERE b.tenant_id = $1::uuid AND b.property_id = $2::uuid AND ${where}
         AND b.status = $4::"BookingStatus" AND b.external_reference NOT LIKE 'CLOCK-%'
         AND COALESCE(g.email, '') <> ''
       ORDER BY b.order_room_number NULLS FIRST, b.id`,
      context.tenantId,
      context.propertyId,
      bookingId,
      status,
    );
  }

  private message(
    key: EmailTemplateKey,
    template: SavedTemplate | null,
    stay: GuestStay,
    brand: MailBrand,
  ) {
    return renderTemplate(
      key,
      template,
      stayTemplateValues({
        guestName: stay.guestName,
        hotelName: brand.name || 'the hotel',
        reference: stay.reference,
        startsOn: stay.startsOn,
        endsOn: stay.endsOn,
        roomName: stay.rooms.map((room) => room.roomName).join(', '),
        guestCount: stay.rooms.reduce((sum, room) => sum + room.guestCount, 0),
      }),
    );
  }

  private stay(rows: StayRow[]): GuestStay {
    const first = rows[0]!;
    return {
      bookingId: first.id,
      reference: first.reference,
      guestEmail: first.email!,
      guestName: [first.firstName, first.lastName].filter(Boolean).join(' ').trim() || first.email!,
      startsOn: first.startsOn,
      endsOn: first.endsOn,
      rooms: rows.map((row) => ({ roomName: row.roomName, guestCount: Number(row.guestCount) })),
    };
  }

  private async brand(tx: TenantTransaction, context: Context): Promise<MailBrand> {
    const rows = await tx.$queryRaw<MailBrand[]>`
      SELECT name, logo_url AS "logoUrl", support_email AS "supportEmail", phone,
        public_website_origin AS "websiteUrl", address
      FROM properties WHERE tenant_id = ${context.tenantId}::uuid AND id = ${context.propertyId}::uuid
    `;
    return rows[0]!;
  }
}
