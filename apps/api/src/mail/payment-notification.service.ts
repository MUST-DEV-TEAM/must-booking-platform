import type { RecipientEnvelope } from './recipient-envelope';
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
      paid ? 'booking_confirmed' : 'booking_confirmed_pay_at_hotel',
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

  async sendNewBookingStaffNotificationSafely(
    command: QueuedMailCommands['newBookingStaff'] & { recipientEnvelope?: RecipientEnvelope },
    context: NotificationContext,
  ): Promise<void> {
    const template = await this.staffTemplate(context, 'staff_new_booking', command);
    const { recipientEnvelope, ...content } = command;
    return this.delivery.dispatch(
      'newBookingStaff',
      { ...content, template },
      this.scope(context),
      { recipientEnvelope },
    );
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

  async sendBookingCancelledStaffNotificationSafely(
    command: QueuedMailCommands['bookingCancelledStaff'] & {
      recipientEnvelope?: RecipientEnvelope;
    },
    context: NotificationContext,
  ): Promise<void> {
    const template = await this.staffTemplate(context, 'staff_booking_cancelled', command);
    const { recipientEnvelope, ...content } = command;
    return this.delivery.dispatch(
      'bookingCancelledStaff',
      { ...content, template },
      this.scope(context),
      { recipientEnvelope },
    );
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
      brand: {
        name: string;
        supportEmail?: string | null;
        phone?: string | null;
        address?: string | null;
      };
      nightlyRates?: readonly { date: string; amount: string }[];
      amount?: { currency: string };
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
        const saved =
          (await savedTemplate(tx, context, templateKey)) ??
          (templateKey === 'booking_confirmed_pay_at_hotel'
            ? await savedTemplate(tx, context, 'booking_confirmed')
            : null);
        const [property] = await tx.$queryRaw<
          { checkInTime: string | null; address: string | null }[]
        >`SELECT check_in_time AS "checkInTime",address FROM properties WHERE tenant_id=${context.tenantId}::uuid AND id=${context.propertyId}::uuid`;
        const values = {
          ...stayTemplateValues({
            guestName: command.guest.name,
            hotelName: command.brand.name || 'the hotel',
            reference: command.bookingReference,
            startsOn: command.stay.startsOn,
            endsOn: command.stay.endsOn,
            roomName: command.roomName,
            guestCount: command.guestCount,
            language: saved?.language,
            nightlyRates: command.nightlyRates,
            currency: command.amount?.currency,
            hotelContact: command.brand.supportEmail ?? command.brand.phone ?? undefined,
            checkInTime: property?.checkInTime ?? undefined,
            directions: property?.address ?? undefined,
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

  private async staffTemplate(
    context: NotificationContext,
    key: EmailTemplateKey,
    command: {
      guest: { name: string };
      brand: { name: string; supportEmail?: string | null; phone?: string | null };
      bookingReference: string;
      stay: { startsOn: string; endsOn: string };
      roomName: string;
      guestCount: number;
      paymentMethod?: string;
      nightlyRates?: readonly { date: string; amount: string }[];
      amount?: { currency: string };
    },
  ): Promise<MailTemplateOverride | undefined> {
    try {
      return await this.database.withTenantTransaction(context, async (tx) => {
        const saved = await savedTemplate(tx, context, key);
        return renderTemplate(key, saved, {
          ...stayTemplateValues({
            guestName: command.guest.name,
            hotelName: command.brand.name,
            reference: command.bookingReference,
            startsOn: command.stay.startsOn,
            endsOn: command.stay.endsOn,
            roomName: command.roomName,
            guestCount: command.guestCount,
            language: saved?.language,
            nightlyRates: command.nightlyRates,
            currency: command.amount?.currency,
            hotelContact: command.brand.supportEmail ?? command.brand.phone ?? undefined,
          }),
          payment_note:
            command.paymentMethod === 'pay_at_hotel'
              ? 'Payment is due at the hotel.'
              : 'Check the recorded payment status in MUST.',
        });
      });
    } catch {
      this.logger.error('Could not load staff email wording; using the built-in email.');
      return undefined;
    }
  }
  private scope(context: NotificationContext): NotificationContext {
    return { tenantId: context.tenantId, propertyId: context.propertyId };
  }
}
