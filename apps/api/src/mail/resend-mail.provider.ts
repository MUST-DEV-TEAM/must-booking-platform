import { Injectable } from '@nestjs/common';

import type { MailProvider } from './mail.provider';

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
      html: `<p>Welcome to MUST Booking, ${organizationName}.</p><p><a href="${verificationUrl}">Verify your email address</a></p>`,
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
      html: `<p>Your email is verified. Welcome to MUST Booking, ${organizationName}.</p>`,
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
      html: `<p>We received a request to reset your MUST Booking password.</p><p><a href="${resetUrl}">Create a new password</a></p><p>This link expires automatically and can be used once.</p>`,
      text: `Reset your MUST Booking password: ${command.resetUrl}\nThis link expires automatically and can be used once.`,
      idempotencyKey: `password-reset/${command.userId}/${this.tokenFromUrl(command.resetUrl)}`,
    });
  }

  async sendPaymentConfirmationEmail(command: {
    bookingId: string;
    paymentId: string;
    to: string;
    amount: { amount: string; currency: string };
    cancellationUrl?: string;
  }): Promise<void> {
    const bookingId = this.escapeHtml(command.bookingId);
    const amount = this.escapeHtml(`${command.amount.currency} ${command.amount.amount}`);
    const cancellationUrl = command.cancellationUrl ? this.escapeHtml(command.cancellationUrl) : '';
    await this.send({
      to: command.to,
      subject: 'Booking confirmed',
      html: this.bookingEmailLayout({
        heading: 'Booking confirmed',
        content: `Your booking is confirmed. We received your payment of <strong>${amount}</strong>.`,
        bookingId,
        ctaUrl: cancellationUrl,
        ctaLabel: 'Review or cancel booking',
      }),
      text: `We received your payment of ${command.amount.currency} ${command.amount.amount} for booking ${command.bookingId}.${command.cancellationUrl ? ` Cancel: ${command.cancellationUrl}` : ''}`,
      idempotencyKey: `payment-confirmation/${command.paymentId}`,
    });
  }

  private bookingEmailLayout(command: {
    heading: string;
    content: string;
    bookingId: string;
    ctaUrl: string;
    ctaLabel: string;
  }): string {
    return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f1ea;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ea;border-collapse:collapse;"><tr><td align="center" style="padding:32px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#fff;border-collapse:collapse;"><tr><td style="padding:32px 32px 20px;font-family:Arial,sans-serif;color:#141414;"><div style="margin:0 0 24px;font-size:18px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">MUST Booking</div><h1 style="margin:0 0 18px;font-size:30px;line-height:1.2;">${command.heading}</h1><div style="font-size:16px;line-height:1.7;">${command.content}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;border-collapse:collapse;border:1px solid #d8d2c4;"><tr><td colspan="2" style="padding:12px 16px;background:#f7f4ec;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">Booking Summary</td></tr><tr><td style="padding:12px 16px;width:38%;font-size:14px;font-weight:600;color:#58544a;">Booking reference</td><td style="padding:12px 16px;font-size:14px;">${command.bookingId}</td></tr></table>${command.ctaUrl ? `<p style="margin:24px 0 0;"><a href="${command.ctaUrl}" style="display:inline-block;padding:14px 24px;background:#141414;color:#fff;text-decoration:none;font-family:Arial,sans-serif;font-size:15px;font-weight:600;">${command.ctaLabel}</a></p>` : ''}<div style="margin-top:28px;padding:16px 18px;border:1px solid #ddd6c8;background:#faf7f0;font-size:14px;line-height:1.7;"><strong style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;">Need Help?</strong><br>Contact your hotel directly for assistance.</div></td></tr><tr><td style="padding:0 32px 28px;font-family:Arial,sans-serif;font-size:13px;line-height:1.7;color:#5f5a50;">MUST Booking</td></tr></table></td></tr></table></body></html>`;
  }

  async sendRefundConfirmationEmail(command: {
    bookingId: string;
    refundId: string;
    to: string;
    amount: { amount: string; currency: string };
  }): Promise<void> {
    const bookingId = this.escapeHtml(command.bookingId);
    const amount = this.escapeHtml(`${command.amount.currency} ${command.amount.amount}`);
    await this.send({
      to: command.to,
      subject: 'Refund processed for your booking',
      html: `<p>Your refund of ${amount} for booking ${bookingId} has been processed.</p>`,
      text: `Your refund of ${command.amount.currency} ${command.amount.amount} for booking ${command.bookingId} has been processed.`,
      idempotencyKey: `refund-confirmation/${command.refundId}`,
    });
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
