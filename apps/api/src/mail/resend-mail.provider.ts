import { Injectable } from '@nestjs/common';

import type { MailBrand, MailProvider, NightlyRate } from '@must/domain-contracts';
import {
  MUST_BOOKING_BRAND,
  escapeHtml,
  renderBrandedEmail,
  type SupportLink,
} from './email-layout';

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
    const organizationName = escapeHtml(command.organizationName);
    await this.send({
      to: command.to,
      subject: 'Verify your MUST Booking email address',
      html: renderBrandedEmail({
        subject: 'Verify your MUST Booking email address',
        brand: MUST_BOOKING_BRAND,
        preheader: 'Confirm your email to activate your MUST Booking account.',
        eyebrow: 'Account security',
        heading: 'Verify your email address',
        content: `<p style="margin:0 0 18px 0;">Welcome to MUST Booking, <strong>${organizationName}</strong>. Confirm this email address to activate your account and start setting up your property.</p>`,
        cta: { url: command.verificationUrl, label: 'Verify email address' },
        supportStyle: 'plain',
        supportLinks: this.systemSupportLinks(true),
        showBrandFooter: false,
        footerNote: "You&#39;re receiving this email because this address was used to sign up for MUST Booking. If this wasn&#39;t you, you can safely ignore it.",
        platformFooter: 'MUST Booking Platform',
      }),
      text: `Welcome to MUST Booking, ${command.organizationName}. Confirm this email address to activate your account: ${command.verificationUrl}`,
      idempotencyKey: `email-verification/${command.userId}/${this.tokenFromUrl(command.verificationUrl)}`,
    });
  }

  async sendWelcomeEmail(command: {
    userId: string;
    to: string;
    organizationName: string;
  }): Promise<void> {
    const organizationName = escapeHtml(command.organizationName);
    await this.send({
      to: command.to,
      subject: 'Welcome to MUST Booking',
      html: renderBrandedEmail({
        subject: 'Welcome to MUST Booking',
        brand: MUST_BOOKING_BRAND,
        preheader: "You're verified — your MUST Booking dashboard is ready.",
        eyebrow: 'Welcome',
        heading: 'Welcome to MUST Booking',
        content: `<p style="margin:0 0 18px 0;">Your email is verified. Welcome to MUST Booking, <strong>${organizationName}</strong> — you're all set to add your first property, configure rooms and rates, and start taking bookings online.</p>`,
        cta: this.appUrl('/dashboard') ? { url: this.appUrl('/dashboard')!, label: 'Go to dashboard' } : null,
        supportStyle: 'plain',
        supportLinks: this.systemSupportLinks(false),
        showBrandFooter: false,
        footerNote: this.systemFooterNote('You verified a MUST Booking account.'),
        platformFooter: 'MUST Booking Platform',
      }),
      text: `Your email is verified. Welcome to MUST Booking, ${command.organizationName} — you're all set to add your first property, configure rooms and rates, and start taking bookings online.`,
      idempotencyKey: `welcome/${command.userId}`,
    });
  }

  async sendPasswordResetEmail(command: {
    userId: string;
    to: string;
    resetUrl: string;
  }): Promise<void> {
    await this.send({
      to: command.to,
      subject: 'Reset your MUST Booking password',
      html: renderBrandedEmail({
        subject: 'Reset your MUST Booking password',
        brand: MUST_BOOKING_BRAND,
        preheader: 'Use this link to set a new MUST Booking password.',
        eyebrow: 'Account security',
        heading: 'Reset your password',
        content: "<p style=\"margin:0 0 18px 0;\">We received a request to reset the password on your MUST Booking account. Click below to create a new one.</p><p style=\"margin:0;color:#58544a;font-size:14px;\">This link can only be used once. If you didn't request this, you can ignore this email — your password won't change.</p>",
        cta: { url: command.resetUrl, label: 'Create a new password' },
        supportStyle: 'plain',
        supportLinks: this.systemSupportLinks(false),
        showBrandFooter: false,
        footerNote: 'You&#39;re receiving this email because a password reset was requested for this MUST Booking account.',
        platformFooter: 'MUST Booking Platform',
      }),
      text: `We received a request to reset the password on your MUST Booking account. Create a new password: ${command.resetUrl}\nThis link can only be used once. If you didn't request this, you can ignore this email — your password won't change.`,
      idempotencyKey: `password-reset/${command.userId}/${this.tokenFromUrl(command.resetUrl)}`,
    });
  }

  async sendPaymentConfirmationEmail(command: Parameters<MailProvider['sendPaymentConfirmationEmail']>[0]): Promise<void> {
    const paid = command.paymentMethod === 'stripe' || command.paymentMethod === 'pokpay';
    const hotelName = command.brand.name || 'your hotel';
    const subject = `${hotelName} booking confirmed — ${command.bookingReference}`;
    await this.send({
      to: command.to,
      subject,
      html: renderBrandedEmail({
        subject,
        brand: command.brand,
        preheader: paid
          ? 'Your payment was received and your stay is confirmed.'
          : 'Your stay is confirmed. Payment is collected at the hotel.',
        heading: 'Your stay is confirmed',
        content: `<p style="margin:0 0 18px 0;">Hello <strong>${escapeHtml(command.guest.name)}</strong>, ${paid ? `thank you for choosing ${escapeHtml(hotelName)}. We've received your payment and your reservation is confirmed.` : `your reservation at ${escapeHtml(hotelName)} is confirmed. Payment will be collected at the hotel on arrival.`}</p>${this.specialRequests(command.specialRequests)}`,
        summaryRows: this.bookingSummaryRows(command, {
          paymentMethod: command.paymentMethod,
          amountLabel: paid ? 'Paid' : 'Due at hotel',
          dateFormat: paid ? 'gb' : 'us',
        }),
        cta: command.cancellationUrl
          ? { url: command.cancellationUrl, label: 'Review or cancel booking' }
          : null,
        footerNote: `You&#39;re receiving this email because you made a reservation at ${escapeHtml(hotelName)}.`,
      }),
      text: `${paid ? `Your payment of ${this.money(command.amount)} was received and your reservation is confirmed.` : 'Your reservation is confirmed. Payment will be collected at the hotel on arrival.'} Booking ${command.bookingReference}: ${command.roomName}, ${command.stay.startsOn} to ${command.stay.endsOn}, ${command.guestCount} guest${command.guestCount === 1 ? '' : 's'}.${command.specialRequests?.trim() ? ` Special requests: ${command.specialRequests.trim()}` : ''}${command.cancellationUrl ? ` Review or cancel: ${command.cancellationUrl}` : ''}`,
      idempotencyKey: `payment-confirmation/${command.paymentId}`,
    });
  }

  async sendNewBookingStaffNotification(command: Parameters<MailProvider['sendNewBookingStaffNotification']>[0]): Promise<void> {
    const guestName = escapeHtml(command.guest.name);
    const subject = `${command.guest.name} — new booking ${command.bookingReference}`;
    await this.send({
      to: command.to,
      subject,
      html: renderBrandedEmail({
        subject,
        brand: command.brand,
        preheader: `A new ${command.paymentMethod === 'pay_at_hotel' ? '' : 'paid '}booking just came in for ${command.roomName}.`,
        heading: 'New booking received',
        content: `<p style="margin:0 0 4px 0;"><strong>Guest</strong><br>${guestName}<br>${escapeHtml(command.guest.email)}${command.guest.phone ? `<br>${escapeHtml(command.guest.phone)}` : ''}</p>${this.specialRequests(command.specialRequests, true)}`,
        summaryRows: this.bookingSummaryRows(command, {
          paymentMethod: command.paymentMethod,
          amountLabel: 'Total',
          dateFormat: 'us',
        }),
        cta: this.dashboardReservationUrl(command.bookingReference)
          ? { url: this.dashboardReservationUrl(command.bookingReference)!, label: 'Open reservation' }
          : null,
        supportStyle: 'plain',
        supportLinks: this.dashboardSupportLinks(),
        showBrandFooter: false,
        footerNote: this.staffFooterNote(command.brand.name),
        platformFooter: 'MUST Booking Platform',
      }),
      text: `New booking received\nBooking reference: ${command.bookingReference}\nGuest: ${command.guest.name}\nEmail: ${command.guest.email}${command.guest.phone ? `\nPhone: ${command.guest.phone}` : ''}\nRoom: ${command.roomName}\nDates: ${command.stay.startsOn} to ${command.stay.endsOn}\nTotal: ${this.money(command.amount)}${command.specialRequests?.trim() ? `\nSpecial requests: ${command.specialRequests.trim()}` : ''}`,
      idempotencyKey: `new-booking-staff/${command.paymentId}/${command.staffUserId}`,
    });
  }

  async sendRefundConfirmationEmail(command: Parameters<MailProvider['sendRefundConfirmationEmail']>[0]): Promise<void> {
    const hotelName = command.brand.name || 'your hotel';
    const subject = `${hotelName} refund processed — ${command.bookingReference}`;
    await this.send({
      to: command.to,
      subject,
      html: renderBrandedEmail({
        subject,
        brand: command.brand,
        preheader: 'Your refund has been processed and is on its way.',
        heading: 'Refund processed',
        content: `<p style="margin:0 0 18px 0;">Hello <strong>${escapeHtml(command.guest.name)}</strong>, your refund has been processed. It may take a few business days to appear on your original payment method.</p>`,
        summaryRows: this.bookingSummaryRows(command, {
          amountLabel: 'Refund amount',
          dateFormat: 'us',
        }),
        footerNote: `You&#39;re receiving this email because a refund was issued for a reservation at ${escapeHtml(hotelName)}.`,
      }),
      text: `Your refund of ${this.money(command.amount)} for booking ${command.bookingReference} has been processed. It may take a few business days to appear on your original payment method.`,
      idempotencyKey: `refund-confirmation/${command.refundId}`,
    });
  }

  async sendBookingCancelledEmail(command: Parameters<MailProvider['sendBookingCancelledEmail']>[0]): Promise<void> {
    const hotelName = command.brand.name || 'your hotel';
    const subject = `Booking ${command.bookingReference} cancelled`;
    await this.send({
      to: command.to,
      subject,
      html: renderBrandedEmail({
        subject,
        brand: command.brand,
        preheader: `Your reservation at ${hotelName} has been cancelled.`,
        heading: 'Your booking was cancelled',
        content: `<p style="margin:0 0 18px 0;">Hello <strong>${escapeHtml(command.guest.name)}</strong>, your booking has been cancelled as requested. If you need help planning a new stay, we're here for you.</p>`,
        summaryRows: this.bookingSummaryRows(command, { includeGuests: false, dateFormat: 'us' }),
        cta: this.guestBookingUrl(command.brand, command.bookingReference)
          ? { url: this.guestBookingUrl(command.brand, command.bookingReference)!, label: 'Review booking' }
          : null,
        footerNote: `You&#39;re receiving this email because a reservation at ${escapeHtml(hotelName)} under your name was cancelled.`,
      }),
      text: `Your booking ${command.bookingReference} has been cancelled as requested. ${command.roomName}, ${command.stay.startsOn} to ${command.stay.endsOn}.`,
      idempotencyKey: `booking-cancelled/guest/${command.bookingId}`,
    });
  }

  async sendBookingCancelledStaffNotification(command: Parameters<MailProvider['sendBookingCancelledStaffNotification']>[0]): Promise<void> {
    const subject = `${command.guest.name} — booking cancelled ${command.bookingReference}`;
    await this.send({
      to: command.to,
      subject,
      html: renderBrandedEmail({
        subject,
        brand: command.brand,
        preheader: `A reservation for ${command.roomName} was just cancelled.`,
        heading: 'Booking cancelled',
        content: `<p style="margin:0 0 4px 0;"><strong>Guest</strong><br>${escapeHtml(command.guest.name)}<br>${escapeHtml(command.guest.email)}${command.guest.phone ? `<br>${escapeHtml(command.guest.phone)}` : ''}</p>`,
        summaryRows: this.bookingSummaryRows(command, { includeGuests: false, dateFormat: 'us' }),
        cta: this.dashboardReservationUrl(command.bookingReference)
          ? { url: this.dashboardReservationUrl(command.bookingReference)!, label: 'Open reservation' }
          : null,
        supportStyle: 'plain',
        supportLinks: this.dashboardSupportLinks(),
        showBrandFooter: false,
        footerNote: this.staffFooterNote(command.brand.name),
        platformFooter: 'MUST Booking Platform',
      }),
      text: `${command.guest.name}'s booking ${command.bookingReference} has been cancelled.`,
      idempotencyKey: `booking-cancelled/staff/${command.bookingId}/${command.staffUserId}`,
    });
  }

  private bookingSummaryRows(
    command: {
      bookingReference: string;
      roomName: string;
      stay: { startsOn: string; endsOn: string };
      guestCount: number;
      nightlyRates?: NightlyRate[];
      amount?: { amount: string; currency: string };
    },
    options: {
      includeGuests?: boolean;
      paymentMethod?: string;
      amountLabel?: string;
      dateFormat: 'gb' | 'us';
    },
  ): Array<{ label: string; value: string }> {
    const currency = command.amount?.currency;
    const dates = command.nightlyRates?.length
      ? command.nightlyRates
          .map((rate) => `${this.formatDate(rate.date, options.dateFormat)} — ${rate.amount}${currency ? ` ${currency}` : ''}`)
          .join('\n')
      : `${this.formatDate(command.stay.startsOn, options.dateFormat)} – ${this.formatDate(command.stay.endsOn, options.dateFormat)}`;
    const rows = [
      { label: 'Booking reference', value: command.bookingReference },
      { label: 'Room', value: command.roomName },
      { label: 'Dates', value: dates },
    ];
    if (options.includeGuests ?? true) rows.push({ label: 'Guests', value: String(command.guestCount) });
    if (options.paymentMethod)
      rows.push({ label: 'Payment method', value: this.paymentMethodLabel(options.paymentMethod) });
    if (options.amountLabel && command.amount)
      rows.push({ label: options.amountLabel, value: this.money(command.amount) });
    return rows;
  }

  private specialRequests(value: string | null | undefined, compact = false): string {
    if (!value?.trim()) return '';
    const body = escapeHtml(value.trim()).replace(/\r?\n/g, '<br>');
    return `<p style="margin:${compact ? '16px 0 0 0' : '0 0 18px 0'};"><strong>Special requests</strong><br>${body}</p>`;
  }

  private paymentMethodLabel(paymentMethod: string): string {
    return { stripe: 'Card payment – Stripe', pokpay: 'PokPay', pay_at_hotel: 'Pay at hotel' }[paymentMethod] ?? paymentMethod;
  }

  private money(value: { amount: string; currency: string }): string { return `${value.amount} ${value.currency}`; }

  private formatDate(value: string, format: 'gb' | 'us'): string {
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.valueOf())) return value;
    return new Intl.DateTimeFormat(format === 'gb' ? 'en-GB' : 'en-US', {
      day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
    }).format(parsed);
  }

  private appUrl(path: string): string | null {
    const base = process.env.WEB_APP_URL?.trim();
    if (!base) return null;
    try { return new URL(path, base).toString(); } catch { return null; }
  }

  private dashboardReservationUrl(reference: string): string | null {
    return this.appUrl(`/dashboard/reservations/${encodeURIComponent(reference)}`);
  }

  private guestBookingUrl(brand: MailBrand, reference: string): string | null {
    if (!brand.websiteUrl) return null;
    try {
      const url = new URL('/booking/confirmation', brand.websiteUrl);
      url.searchParams.set('booking', reference);
      return url.toString();
    } catch { return null; }
  }

  private systemSupportLinks(includeWebsite: boolean): SupportLink[] {
    const links: SupportLink[] = [{ href: 'mailto:support@mustbooking.com', label: 'support@mustbooking.com' }];
    if (includeWebsite) links.push({ href: 'https://mustbooking.com', label: 'mustbooking.com' });
    return links;
  }

  private dashboardSupportLinks(): SupportLink[] {
    const dashboardUrl = this.appUrl('/dashboard');
    return dashboardUrl ? [{ href: dashboardUrl, label: dashboardUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') }] : [];
  }

  private systemFooterNote(reason: string): string {
    const preferencesUrl = this.appUrl('/settings/notifications');
    return `You&#39;re receiving this email because ${reason}${preferencesUrl ? ` <a href="${escapeHtml(preferencesUrl)}" style="color:#a39a86;text-decoration:underline;">Manage email preferences</a>.` : ''}`;
  }

  private staffFooterNote(hotelName: string): string {
    const preferencesUrl = this.appUrl('/settings/notifications');
    return `You&#39;re receiving this email because you manage bookings for ${escapeHtml(hotelName || 'this hotel')} on MUST Booking.${preferencesUrl ? ` <a href="${escapeHtml(preferencesUrl)}" style="color:#a39a86;text-decoration:underline;">Manage email preferences</a>.` : ''}`;
  }

  private async send(message: { to: string; subject: string; html: string; text: string; idempotencyKey: string }): Promise<void> {
    const response = await fetch(resendEmailsUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.requiredEnvironment('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': message.idempotencyKey,
        'User-Agent': 'must-booking-platform/0.0.0',
      },
      body: JSON.stringify({
        from: this.requiredEnvironment('MAIL_FROM_EMAIL'), to: [message.to], subject: message.subject,
        html: message.html, text: message.text,
      }),
    });
    if (!response.ok) throw new Error(`Resend email delivery failed with status ${response.status}.`);
  }

  private requiredEnvironment(name: 'RESEND_API_KEY' | 'MAIL_FROM_EMAIL'): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} must be configured before sending email.`);
    return value;
  }

  private tokenFromUrl(url: string): string { return new URL(url).searchParams.get('token') ?? 'missing-token'; }
}
