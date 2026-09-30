import { Inject, Injectable } from '@nestjs/common';

import { MailDeliveryService } from './mail-delivery.service';
import type { QueuedMailCommands } from './mail-descriptors';

/** The tenant/property an email belongs to; used to scope its `email_messages` row. */
export type NotificationContext = { tenantId: string; propertyId: string };

/**
 * Booking/payment email entry points. Each call records the email in the email log and
 * hands it to the durable delivery queue (retries, failure visibility). None of them
 * throws: a notification problem must never fail the core booking or payment action.
 */
@Injectable()
export class PaymentNotificationService {
  constructor(@Inject(MailDeliveryService) private readonly delivery: MailDeliveryService) {}

  sendPaymentConfirmationEmailSafely(
    command: QueuedMailCommands['paymentConfirmation'],
    context: NotificationContext,
  ): Promise<void> {
    return this.delivery.dispatch('paymentConfirmation', command, this.scope(context));
  }

  sendNewBookingStaffNotificationSafely(
    command: QueuedMailCommands['newBookingStaff'],
    context: NotificationContext,
  ): Promise<void> {
    return this.delivery.dispatch('newBookingStaff', command, this.scope(context));
  }

  sendRefundConfirmationEmailSafely(
    command: QueuedMailCommands['refundConfirmation'],
    context: NotificationContext,
  ): Promise<void> {
    return this.delivery.dispatch('refundConfirmation', command, this.scope(context));
  }

  sendBookingCancelledEmailSafely(
    command: QueuedMailCommands['bookingCancelled'],
    context: NotificationContext,
  ): Promise<void> {
    return this.delivery.dispatch('bookingCancelled', command, this.scope(context));
  }

  sendBookingCancelledStaffNotificationSafely(
    command: QueuedMailCommands['bookingCancelledStaff'],
    context: NotificationContext,
  ): Promise<void> {
    return this.delivery.dispatch('bookingCancelledStaff', command, this.scope(context));
  }

  private scope(context: NotificationContext): NotificationContext {
    return { tenantId: context.tenantId, propertyId: context.propertyId };
  }
}
