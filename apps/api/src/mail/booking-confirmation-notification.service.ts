import { Inject, Injectable } from '@nestjs/common';
import type { PaymentProviderContext } from '@must/domain-contracts';

import { CancellationLinkService } from '../booking/cancellation-link.service';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { PaymentNotificationService } from './payment-notification.service';

type BookingEmailRow = {
  email: string;
  guestSessionId: string;
  guestReturnUrl: string | null;
  amount: string;
  currency: string;
  externalReference: string;
  specialRequests: string | null;
};

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
    const row = await this.database.withTenantTransaction(context, async (tx) => {
      const rows = await tx.$queryRaw<BookingEmailRow[]>`
        SELECT g.email, b.guest_session_id AS "guestSessionId", b.guest_return_url AS "guestReturnUrl",
          b.total_amount::text AS amount, rp.currency, b.external_reference AS "externalReference",
          b.special_requests AS "specialRequests"
        FROM bookings b
        JOIN guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
        JOIN rate_plans rp ON rp.tenant_id = b.tenant_id AND rp.property_id = b.property_id AND rp.id = b.rate_plan_id
        WHERE b.id = ${bookingId}::uuid AND b.tenant_id = ${context.tenantId}::uuid
          AND b.property_id = ${context.propertyId}::uuid
      `;
      return rows[0] ?? null;
    });
    if (!row) return;
    await this.notifications.sendPaymentConfirmationEmailSafely({
      bookingId,
      bookingReference: row.externalReference,
      paymentId,
      to: row.email,
      amount: { amount: row.amount, currency: row.currency },
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
  }

  private cancellationUrl(base: string, bookingId: string, cancellationToken: string): string {
    const url = new URL(base);
    url.searchParams.set('booking_id', bookingId);
    url.searchParams.set('cancellationToken', cancellationToken);
    url.searchParams.set('must_action', 'cancel');
    return url.toString();
  }
}
