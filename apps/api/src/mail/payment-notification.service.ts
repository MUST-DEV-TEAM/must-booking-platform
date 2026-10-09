import { Inject, Injectable, Logger } from '@nestjs/common';

import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { MailDeliveryService } from './mail-delivery.service';
import type { QueuedMailCommands } from './mail-descriptors';
import { guestNotificationEnabled } from './notification-recipients';
import type { NotificationTopic } from './notification-topics';

/** The tenant/property an email belongs to; used to scope its `email_messages` row. */
export type NotificationContext = { tenantId: string; propertyId: string };

/**
 * Booking/payment email entry points. Each call records the email in the email log and
 * hands it to the durable delivery queue (retries, failure visibility). None of them
 * throws: a notification problem must never fail the core booking or payment action.
 * Guest emails are skipped when the property switched that guest email off.
 */
@Injectable()
export class PaymentNotificationService {
  private readonly logger = new Logger(PaymentNotificationService.name);

  constructor(
    @Inject(MailDeliveryService) private readonly delivery: MailDeliveryService,
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
  ) {}

  async sendPaymentConfirmationEmailSafely(
    command: QueuedMailCommands['paymentConfirmation'],
    context: NotificationContext,
  ): Promise<void> {
    if (!(await this.guestEnabled(context, 'new_booking'))) return;
    return this.delivery.dispatch('paymentConfirmation', command, this.scope(context));
  }

  sendNewBookingStaffNotificationSafely(
    command: QueuedMailCommands['newBookingStaff'],
    context: NotificationContext,
  ): Promise<void> {
    return this.delivery.dispatch('newBookingStaff', command, this.scope(context));
  }

  async sendRefundConfirmationEmailSafely(
    command: QueuedMailCommands['refundConfirmation'],
    context: NotificationContext,
  ): Promise<void> {
    if (!(await this.guestEnabled(context, 'refund_processed'))) return;
    return this.delivery.dispatch('refundConfirmation', command, this.scope(context));
  }

  async sendBookingCancelledEmailSafely(
    command: QueuedMailCommands['bookingCancelled'],
    context: NotificationContext,
  ): Promise<void> {
    if (!(await this.guestEnabled(context, 'booking_cancelled'))) return;
    return this.delivery.dispatch('bookingCancelled', command, this.scope(context));
  }

  sendBookingCancelledStaffNotificationSafely(
    command: QueuedMailCommands['bookingCancelledStaff'],
    context: NotificationContext,
  ): Promise<void> {
    return this.delivery.dispatch('bookingCancelledStaff', command, this.scope(context));
  }

  /** Never throws: if the setting can't be read, the guest email still goes out. */
  private async guestEnabled(
    context: NotificationContext,
    topic: NotificationTopic,
  ): Promise<boolean> {
    try {
      return await this.database.withTenantTransaction(context, (tx) =>
        guestNotificationEnabled(tx, context, topic),
      );
    } catch (error) {
      this.logger.error(
        `Could not read the guest email setting for ${topic}; sending anyway.`,
        error instanceof Error ? error.stack : String(error),
      );
      return true;
    }
  }

  private scope(context: NotificationContext): NotificationContext {
    return { tenantId: context.tenantId, propertyId: context.propertyId };
  }
}
