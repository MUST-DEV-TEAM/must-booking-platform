import { Inject, Injectable, Logger } from '@nestjs/common';

import { MAIL_PROVIDER, type MailProvider } from './mail.provider';

@Injectable()
export class PaymentNotificationService {
  private readonly logger = new Logger(PaymentNotificationService.name);

  constructor(@Inject(MAIL_PROVIDER) private readonly mail: MailProvider) {}

  async sendPaymentConfirmationEmailSafely(
    command: Parameters<MailProvider['sendPaymentConfirmationEmail']>[0],
  ): Promise<void> {
    try {
      await this.mail.sendPaymentConfirmationEmail(command);
    } catch (error) {
      this.logMailFailure('payment confirmation', command.bookingId, error);
    }
  }

  async sendNewBookingStaffNotificationSafely(
    command: Parameters<MailProvider['sendNewBookingStaffNotification']>[0],
  ): Promise<void> {
    try {
      await this.mail.sendNewBookingStaffNotification(command);
    } catch (error) {
      this.logMailFailure('new booking staff notification', command.bookingId, error);
    }
  }

  async sendRefundConfirmationEmailSafely(
    command: Parameters<MailProvider['sendRefundConfirmationEmail']>[0],
  ): Promise<void> {
    try {
      await this.mail.sendRefundConfirmationEmail(command);
    } catch (error) {
      this.logMailFailure('refund confirmation', command.bookingId, error);
    }
  }

  private logMailFailure(kind: string, bookingId: string, error: unknown): void {
    this.logger.error(
      `Unable to send ${kind} email for booking ${bookingId}; continuing core action.`,
      error instanceof Error ? error.stack : String(error),
    );
  }
}
