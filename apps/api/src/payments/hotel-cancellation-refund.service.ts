import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PaymentProviderContext } from '@must/domain-contracts';

import { ClockBookingService } from '../integrations/clock/clock-booking.service';
import { ManualReviewService } from '../integrations/manual-review.service';
import { PaymentNotificationService } from '../mail/payment-notification.service';
import { reportOperationalFailure } from '../observability/error-tracking';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { PaymentRefundService, type RefundConfirmation } from './payment-refund.service';

type HotelCancellationRow = {
  policy: string;
  status: string;
  cutoffAt: Date | null;
  sameArrival: boolean | null;
  cancelledAt: Date;
  cancelledByMust: boolean;
  externalBookingId: string | null;
};

/**
 * Milestone 27 Task 19: the hotel cancelled a booking inside Clock. MUST learns it from the Clock webhook
 * (hydration lands the local row as CANCELLED) and, when the property's `clock_cancel_refund_policy` asks for
 * it, returns the guest's online payment through the same path as a staff refund: gateway refund, REFUND row,
 * negative payment on the Clock deposit folio, refund email, review item on failure.
 *
 * - NEVER: nothing happens; staff decide.
 * - FREE_WINDOW: refund in full only when the cancellation falls inside the booking's frozen free window.
 * - ALWAYS: refund in full.
 *
 * When the policy says refund (so no fee is kept), the room charges are voided too, exactly as for a free
 * cancellation made in MUST, so Balance and Deposit/Payment both end at 0. When the policy says nothing happens, the
 * hotel decides about any fee in Clock. A cancellation MUST started itself is skipped (its own path already decided
 * about the money), and the refund counts earlier refunds, so nothing is ever paid twice.
 */
@Injectable()
export class HotelCancellationRefundService {
  private readonly logger = new Logger(HotelCancellationRefundService.name);

  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(PaymentRefundService) private readonly refunds: PaymentRefundService,
    @Inject(PaymentNotificationService) private readonly notifications: PaymentNotificationService,
    @Inject(ManualReviewService) private readonly manualReview: ManualReviewService,
    @Inject(ClockBookingService) private readonly clockBooking: ClockBookingService,
  ) {}

  /** Never throws: the cancellation has already been recorded, a refund problem becomes a review item. */
  async refundAfterHotelCancellation(
    context: PaymentProviderContext,
    bookingId: string,
  ): Promise<void> {
    try {
      let confirmation: RefundConfirmation | null = null;
      let clearRoomCharges: string | null = null;
      await this.database.withTenantTransaction(
        context,
        async (tx) => {
          const rows = await tx.$queryRaw<HotelCancellationRow[]>`
            SELECT p.clock_cancel_refund_policy AS policy, b.status::text AS status,
              (b.cancellation_terms->>'cutoffAt')::timestamptz AS "cutoffAt",
              (b.cancellation_terms->>'arrivalDate') = b.starts_on::text AS "sameArrival",
              COALESCE(b.pms_source_updated_at, CURRENT_TIMESTAMP) AS "cancelledAt",
              b.external_booking_id AS "externalBookingId",
              EXISTS(SELECT 1 FROM audit_logs a WHERE a.tenant_id = b.tenant_id
                AND a.target_type = 'booking' AND a.target_id = b.id::text
                AND a.action = 'booking.cancelled') AS "cancelledByMust"
            FROM bookings b
            JOIN properties p ON p.tenant_id = b.tenant_id AND p.id = b.property_id
            WHERE b.tenant_id = ${context.tenantId}::uuid AND b.property_id = ${context.propertyId}::uuid
              AND b.id = ${bookingId}::uuid
          `;
          const row = rows[0];
          if (!row || row.status !== 'CANCELLED' || row.cancelledByMust) return;
          if (!this.refundAllowed(row)) return;
          // The same decision means no cancellation fee is kept, so the room price must leave the bill too.
          clearRoomCharges = row.externalBookingId;
          const refunded = await this.refunds.refundRemainingChargeForBooking(
            tx,
            context,
            bookingId,
            `hotel-cancellation-refund:${bookingId}`,
            row.policy === 'ALWAYS'
              ? 'Refunded automatically: the hotel cancelled the booking in Clock.'
              : 'Refunded automatically: the hotel cancelled the booking in Clock inside the free-cancellation window.',
          );
          if (!refunded.result.ok) {
            await this.manualReview.recordInTransaction(tx, {
              tenantId: context.tenantId,
              propertyId: context.propertyId,
              category: 'UNKNOWN_RESULT',
              referenceType: 'booking',
              referenceId: bookingId,
              message: `The hotel cancelled this booking in Clock, but the automatic refund needs manual action: ${refunded.result.error.message}`,
              context: {
                automaticRefund: true,
                hotelCancellation: true,
                errorCode: refunded.result.error.code,
                retryable: refunded.result.error.retryable,
              },
            });
            return;
          }
          confirmation = refunded.confirmation;
        },
        // Gateway refund plus the Clock negative payment can exceed the default timeout.
        { timeoutMs: 90_000 },
      );
      if (confirmation)
        await this.notifications.sendRefundConfirmationEmailSafely(confirmation, context);
      // Outside the database transaction: it is a series of Clock calls. Safe to repeat, never undoes anything.
      if (clearRoomCharges) await this.clearRoomCharges(context, bookingId, clearRoomCharges);
    } catch (error) {
      this.logger.error(
        `Refund after a hotel cancellation failed for booking ${bookingId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      reportOperationalFailure(error, {
        component: 'payments',
        operation: 'hotel-cancellation-refund',
        tenantId: context.tenantId,
        propertyId: context.propertyId,
      });
    }
  }

  /** Voids the open, non-deposit folios so Balance returns to 0. A failure leaves a note; it never undoes the refund. */
  private async clearRoomCharges(
    context: PaymentProviderContext,
    bookingId: string,
    externalBookingId: string,
  ): Promise<void> {
    const cleared = await this.clockBooking.voidRoomChargeFolios(context, externalBookingId);
    if (cleared.ok) return;
    if (cleared.error.code === 'CLOCK_RIGHT_MISSING') {
      this.logger.warn(
        `Room charges not cleared for booking ${bookingId}: ${cleared.error.message}`,
      );
      return;
    }
    await this.manualReview.record({
      tenantId: context.tenantId,
      propertyId: context.propertyId,
      category: 'UNKNOWN_RESULT',
      referenceType: 'booking',
      referenceId: bookingId,
      message: `The hotel cancelled this booking in Clock, but its room charges could not be cleared: ${cleared.error.message} Void the room folio in Clock by hand.`,
      context: { externalBookingId, errorCode: cleared.error.code },
    });
  }

  private refundAllowed(row: HotelCancellationRow): boolean {
    if (row.policy === 'ALWAYS') return true;
    if (row.policy !== 'FREE_WINDOW') return false;
    // Only bookings that froze their terms at creation have a window to compare against.
    if (!row.cutoffAt || row.sameArrival !== true) return false;
    return new Date(row.cancelledAt).valueOf() <= new Date(row.cutoffAt).valueOf();
  }
}
