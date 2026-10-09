import { Inject, Injectable, Logger } from '@nestjs/common';
import type { MailTemplateOverride } from '@must/domain-contracts';

import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { MailDeliveryService } from './mail-delivery.service';
import type { QueuedMailCommands } from './mail-descriptors';
import {
  renderTemplate,
  savedTemplate,
  stayTemplateValues,
  type EmailTemplateKey,
  type TemplateValues,
} from './email-templates';
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
    const paid = command.paymentMethod === 'stripe' || command.paymentMethod === 'pokpay';
    const guest = await this.guestSetup(
      context,
      'new_booking',
      'booking_confirmed',
      command,
      () => ({
        payment_note: paid
          ? "We've received your payment."
          : 'Payment will be collected at the hotel on arrival.',
      }),
    );
    if (!guest.enabled) return;
    return this.delivery.dispatch(
      'paymentConfirmation',
      { ...command, ...(guest.template ? { template: guest.template } : {}) },
      this.scope(context),
    );
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
    const guest = await this.guestSetup(
      context,
      'refund_processed',
      'refund_processed',
      command,
      () => ({
        refund_amount: `${command.amount.amount} ${command.amount.currency}`,
      }),
    );
    if (!guest.enabled) return;
    return this.delivery.dispatch(
      'refundConfirmation',
      { ...command, ...(guest.template ? { template: guest.template } : {}) },
      this.scope(context),
    );
  }

  async sendBookingCancelledEmailSafely(
    command: QueuedMailCommands['bookingCancelled'],
    context: NotificationContext,
  ): Promise<void> {
    const guest = await this.guestSetup(context, 'booking_cancelled', 'booking_cancelled', command);
    if (!guest.enabled) return;
    return this.delivery.dispatch(
      'bookingCancelled',
      { ...command, ...(guest.template ? { template: guest.template } : {}) },
      this.scope(context),
    );
  }

  sendBookingCancelledStaffNotificationSafely(
    command: QueuedMailCommands['bookingCancelledStaff'],
    context: NotificationContext,
  ): Promise<void> {
    return this.delivery.dispatch('bookingCancelledStaff', command, this.scope(context));
  }

  /**
   * Whether the guest email is switched on, and the property's own wording for it when
   * it saved one (otherwise the built-in email is sent unchanged). Never throws: if the
   * settings can't be read, the default guest email still goes out.
   */
  private async guestSetup(
    context: NotificationContext,
    topic: NotificationTopic,
    templateKey: EmailTemplateKey,
    command: {
      bookingReference: string;
      brand: { name: string };
      guest: { name: string };
      stay: { startsOn: string; endsOn: string };
      roomName: string;
      guestCount: number;
    },
    /** Email-specific values, read only when a saved template needs them. */
    extra: () => TemplateValues = () => ({}),
  ): Promise<{ enabled: boolean; template: MailTemplateOverride | null }> {
    try {
      return await this.database.withTenantTransaction(context, async (tx) => {
        if (!(await guestNotificationEnabled(tx, context, topic)))
          return { enabled: false, template: null };
        const saved = await savedTemplate(tx, context, templateKey);
        if (!saved) return { enabled: true, template: null };
        const values = {
          ...stayTemplateValues({
            guestName: command.guest.name,
            hotelName: command.brand.name || 'the hotel',
            reference: command.bookingReference,
            startsOn: command.stay.startsOn,
            endsOn: command.stay.endsOn,
            roomName: command.roomName,
            guestCount: command.guestCount,
          }),
          ...extra(),
        };
        return { enabled: true, template: renderTemplate(templateKey, saved, values) };
      });
    } catch (error) {
      this.logger.error(
        `Could not read the guest email settings for ${topic}; sending the default email.`,
        error instanceof Error ? error.stack : String(error),
      );
      return { enabled: true, template: null };
    }
  }

  private scope(context: NotificationContext): NotificationContext {
    return { tenantId: context.tenantId, propertyId: context.propertyId };
  }
}
