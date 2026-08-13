import { Injectable } from '@nestjs/common';

import type { MailProvider } from './mail.provider';
import { MUST_BOOKING_BRAND, renderBrandedEmail } from './email-layout';

function resendEmailsUrl(): string {
  const configuredBaseUrl = process.env.RESEND_API_BASE_URL?.trim();
  return configuredBaseUrl
    ? new URL('/emails', configuredBaseUrl).toString()
    : 'https://api.resend.com/emails';
}

@Injectable()
export class ResendMailProvider implements MailProvider {
  async sendVerificationEmail(command: {
    userId: string;
    to: string;
    organizationName: string;
    verificationUrl: string;
  }): Promise<void> {
    const organizationName = this.escapeHtml(command.organizationName);
    const verificationUrl = this.escapeHtml(command.verificationUrl);
    await this.send({
      to: command.to,
      subject: 'Verify your MUST Booking email address',
      html: renderBrandedEmail({
        subject: 'Verify your MUST Booking email address',
        brand: MUST_BOOKING_BRAND,
        heading: 'Verify your email address',
        content: `<p>Welcome to MUST Booking, ${organizationName}.</p><p><a href="${verificationUrl}">Verify your email address</a></p>`,
      }),
      text: `Welcome to MUST Booking, ${command.organizationName}. Verify your email address: ${command.verificationUrl}`,
      idempotencyKey: `email-verification/${command.userId}/${this.tokenFromUrl(command.verificationUrl)}`,
    });
  }

  async sendWelcomeEmail(command: {
    userId: string;
    to: string;
    organizationName: string;
  }): Promise<void> {
    const organizationName = this.escapeHtml(command.organizationName);
    await this.send({
      to: command.to,
      subject: 'Welcome to MUST Booking',
      html: renderBrandedEmail({
        subject: 'Welcome to MUST Booking',
        brand: MUST_BOOKING_BRAND,
        heading: 'Welcome to MUST Booking',
        content: `<p>Your email is verified. Welcome to MUST Booking, ${organizationName}.</p>`,
      }),
      text: `Your email is verified. Welcome to MUST Booking, ${command.organizationName}.`,
      idempotencyKey: `welcome/${command.userId}`,
    });
  }

  async sendPasswordResetEmail(command: {
    userId: string;
    to: string;
    resetUrl: string;
  }): Promise<void> {
    const resetUrl = this.escapeHtml(command.resetUrl);
    await this.send({
      to: command.to,
      subject: 'Reset your MUST Booking password',
      html: renderBrandedEmail({
        subject: 'Reset your MUST Booking password',
        brand: MUST_BOOKING_BRAND,
        heading: 'Reset your password',
        content: `<p>We received a request to reset your MUST Booking password.</p><p><a href="${resetUrl}">Create a new password</a></p><p>This link expires automatically and can be used once.</p>`,
      }),
      text: `Reset your MUST Booking password: ${command.resetUrl}\nThis link expires automatically and can be used once.`,
      idempotencyKey: `password-reset/${command.userId}/${this.tokenFromUrl(command.resetUrl)}`,
    });
  }

  async sendPaymentConfirmationEmail(command: {
    bookingId: string;
    bookingReference: string;
    paymentId: string;
    to: string;
    amount: { amount: string; currency: string };
    brand: Parameters<MailProvider['sendPaymentConfirmationEmail']>[0]['brand'];
    paymentMethod: Parameters<MailProvider['sendPaymentConfirmationEmail']>[0]['paymentMethod'];
    guest: Parameters<MailProvider['sendPaymentConfirmationEmail']>[0]['guest'];
    stay: Parameters<MailProvider['sendPaymentConfirmationEmail']>[0]['stay'];
    roomName: string;
    guestCount: number;
    nightlyRates?: Parameters<MailProvider['sendPaymentConfirmationEmail']>[0]['nightlyRates'];
    cancellationUrl?: string;
    specialRequests?: string | null;
  }): Promise<void> {
    const amount = this.escapeHtml(`${command.amount.currency} ${command.amount.amount}`);
    const cancellationUrl = command.cancellationUrl ? this.escapeHtml(command.cancellationUrl) : '';
    const specialRequests = command.specialRequests?.trim()
      ? this.escapeHtml(command.specialRequests).replace(/\r?\n/g, '<br>')
      : '';
    const paid = command.paymentMethod === 'stripe' || command.paymentMethod === 'pokpay';
    const hotelName = command.brand.name || 'your hotel';
    await this.send({
      to: command.to,
      subject: `${hotelName} booking confirmed — ${command.bookingReference}`,
      html: renderBrandedEmail({
        subject: `${hotelName} booking confirmed — ${command.bookingReference}`,
        brand: command.brand,
        heading: 'Booking confirmed',
        greeting: `Hello ${command.guest.name}`,
        content: `<p>Your booking is confirmed. ${paid ? `We received your payment of <strong>${amount}</strong>.` : 'Payment will be collected at the hotel.'}</p>${specialRequests ? `<p><strong>Special requests</strong><br>${specialRequests}</p>` : ''}`,
        summaryRows: this.bookingSummaryRows(command),
        cta: cancellationUrl ? { url: command.cancellationUrl!, label: 'Review or cancel booking' } : null,
      }),
      text: `${paid ? `We received your payment of ${command.amount.currency} ${command.amount.amount}.` : 'Payment will be collected at the hotel.'} Booking ${command.bookingReference}: ${command.roomName}, ${command.stay.startsOn} to ${command.stay.endsOn}, ${command.guestCount} guest${command.guestCount === 1 ? '' : 's'}.${command.specialRequests?.trim() ? ` Special requests: ${command.specialRequests.trim()}` : ''}${command.cancellationUrl ? ` Cancel: ${command.cancellationUrl}` : ''}`,
      idempotencyKey: `payment-confirmation/${command.paymentId}`,
    });
  }

  async sendNewBookingStaffNotification(command: {
    bookingId: string;
    bookingReference: string;
    paymentId: string;
    staffUserId: string;
    to: string;
    guest: { name: string; email: string; phone: string | null };
    stay: { startsOn: string; endsOn: string };
    roomName: string;
    amount: { amount: string; currency: string };
    brand: Parameters<MailProvider['sendNewBookingStaffNotification']>[0]['brand'];
    guestCount: number;
    paymentMethod: Parameters<MailProvider['sendNewBookingStaffNotification']>[0]['paymentMethod'];
    nightlyRates?: Parameters<MailProvider['sendNewBookingStaffNotification']>[0]['nightlyRates'];
    specialRequests?: string | null;
  }): Promise<void> {
    const guestName = this.escapeHtml(command.guest.name);
    const guestEmail = this.escapeHtml(command.guest.email);
    const guestPhone = command.guest.phone ? this.escapeHtml(command.guest.phone) : '';
    const startsOn = this.escapeHtml(command.stay.startsOn);
    const endsOn = this.escapeHtml(command.stay.endsOn);
    const roomName = this.escapeHtml(command.roomName);
    const amount = this.escapeHtml(`${command.amount.currency} ${command.amount.amount}`);
    const specialRequests = command.specialRequests?.trim()
      ? this.escapeHtml(command.specialRequests).replace(/\r?\n/g, '<br>')
      : '';
    await this.send({
      to: command.to,
      subject: `${guestName} — new booking ${command.bookingReference}`,
      html: renderBrandedEmail({
        subject: `${guestName} — new booking ${command.bookingReference}`,
        brand: command.brand,
        heading: 'New booking received',
        content: `<strong>Guest</strong><br>${guestName}<br>${guestEmail}${guestPhone ? `<br>${guestPhone}` : ''}<br><br><strong>Stay</strong><br>${startsOn} to ${endsOn}<br><br><strong>Room</strong><br>${roomName}<br><br><strong>Total</strong><br>${amount}${specialRequests ? `<br><br><strong>Special requests</strong><br>${specialRequests}` : ''}`,
        summaryRows: this.bookingSummaryRows(command),
      }),
      text: `New booking received\nBooking reference: ${command.bookingReference}\nGuest: ${command.guest.name}\nEmail: ${command.guest.email}${command.guest.phone ? `\nPhone: ${command.guest.phone}` : ''}\nStay: ${command.stay.startsOn} to ${command.stay.endsOn}\nRoom: ${command.roomName}\nTotal: ${command.amount.currency} ${command.amount.amount}${command.specialRequests?.trim() ? `\nSpecial requests: ${command.specialRequests.trim()}` : ''}`,
      idempotencyKey: `new-booking-staff/${command.paymentId}/${command.staffUserId}`,
    });
  }

  async sendRefundConfirmationEmail(command: {
    bookingId: string;
    bookingReference: string;
    refundId: string;
    to: string;
    amount: { amount: string; currency: string };
    brand: Parameters<MailProvider['sendRefundConfirmationEmail']>[0]['brand'];
    guest: Parameters<MailProvider['sendRefundConfirmationEmail']>[0]['guest'];
    stay: Parameters<MailProvider['sendRefundConfirmationEmail']>[0]['stay'];
    roomName: string;
    guestCount: number;
    nightlyRates?: Parameters<MailProvider['sendRefundConfirmationEmail']>[0]['nightlyRates'];
  }): Promise<void> {
    const amount = this.escapeHtml(`${command.amount.currency} ${command.amount.amount}`);
    await this.send({
      to: command.to,
      subject: `${command.brand.name || 'Hotel'} refund processed — ${command.bookingReference}`,
      html: renderBrandedEmail({
        subject: `${command.brand.name || 'Hotel'} refund processed — ${command.bookingReference}`,
        brand: command.brand,
        heading: 'Refund processed',
        greeting: `Hello ${command.guest.name}`,
        content: `<p>Your refund of <strong>${amount}</strong> has been processed.</p>`,
        summaryRows: this.bookingSummaryRows(command),
      }),
      text: `Your refund of ${command.amount.currency} ${command.amount.amount} for booking ${command.bookingReference} has been processed.`,
      idempotencyKey: `refund-confirmation/${command.refundId}`,
    });
  }

  async sendBookingCancelledEmail(
    command: Parameters<MailProvider['sendBookingCancelledEmail']>[0],
  ): Promise<void> {
    const subject = `${command.brand.name || 'Hotel'} booking cancelled — ${command.bookingReference}`;
    await this.send({
      to: command.to,
      subject,
      html: renderBrandedEmail({
        subject,
        brand: command.brand,
        heading: 'Booking cancelled',
        greeting: `Hello ${command.guest.name}`,
        content: '<p>Your booking has been cancelled. Please contact the hotel if you need any help.</p>',
        summaryRows: this.bookingSummaryRows(command),
      }),
      text: `Your booking ${command.bookingReference} has been cancelled. ${command.roomName}, ${command.stay.startsOn} to ${command.stay.endsOn}.`,
      idempotencyKey: `booking-cancelled/guest/${command.bookingId}`,
    });
  }

  async sendBookingCancelledStaffNotification(
    command: Parameters<MailProvider['sendBookingCancelledStaffNotification']>[0],
  ): Promise<void> {
    const subject = `${command.guest.name} — booking cancelled ${command.bookingReference}`;
    await this.send({
      to: command.to,
      subject,
      html: renderBrandedEmail({
        subject,
        brand: command.brand,
        heading: 'Booking cancelled',
        content: `<p><strong>Guest</strong><br>${this.escapeHtml(command.guest.name)}<br>${this.escapeHtml(command.guest.email)}${command.guest.phone ? `<br>${this.escapeHtml(command.guest.phone)}` : ''}</p>`,
        summaryRows: this.bookingSummaryRows(command),
      }),
      text: `${command.guest.name}'s booking ${command.bookingReference} has been cancelled.`,
      idempotencyKey: `booking-cancelled/staff/${command.bookingId}/${command.staffUserId}`,
    });
  }

  private bookingSummaryRows(command: {
    bookingReference: string;
    roomName: string;
    stay: { startsOn: string; endsOn: string };
    guestCount: number;
    paymentMethod?: string;
    nightlyRates?: Array<{ date: string; amount: string }>;
  }): Array<{ label: string; value: string }> {
    const rows = [
      { label: 'Booking reference', value: command.bookingReference },
      { label: 'Room', value: command.roomName },
      { label: 'Dates', value: `${command.stay.startsOn} to ${command.stay.endsOn}` },
      { label: 'Guests', value: String(command.guestCount) },
    ];
    if (command.nightlyRates && command.nightlyRates.length > 1)
      rows.push(
        ...command.nightlyRates.map((rate) => ({ label: rate.date, value: rate.amount })),
      );
    if (command.paymentMethod)
      rows.push({ label: 'Payment method', value: this.paymentMethodLabel(command.paymentMethod) });
    return rows;
  }

  private paymentMethodLabel(paymentMethod: string): string {
    return (
      {
        stripe: 'Card payment',
        pokpay: 'PokPay',
        pay_at_hotel: 'Pay at hotel',
      }[paymentMethod] ?? paymentMethod
    );
  }

  private async send(message: {
    to: string;
    subject: string;
    html: string;
    text: string;
    idempotencyKey: string;
  }): Promise<void> {
    const response = await fetch(resendEmailsUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.requiredEnvironment('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': message.idempotencyKey,
        'User-Agent': 'must-booking-platform/0.0.0',
      },
      body: JSON.stringify({
        from: this.requiredEnvironment('MAIL_FROM_EMAIL'),
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    });

    if (!response.ok) {
      throw new Error(`Resend email delivery failed with status ${response.status}.`);
    }
  }

  private requiredEnvironment(name: 'RESEND_API_KEY' | 'MAIL_FROM_EMAIL'): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} must be configured before sending email.`);
    return value;
  }

  private tokenFromUrl(url: string): string {
    return new URL(url).searchParams.get('token') ?? 'missing-token';
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>'"]/g, (character) => {
      const entities: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
      };
      return entities[character];
    });
  }
}
