import { Injectable } from '@nestjs/common';

import type { MailProvider } from './mail.provider';

const resendEmailsUrl = 'https://api.resend.com/emails';

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

  private async send(message: {
    to: string;
    subject: string;
    html: string;
    text: string;
    idempotencyKey: string;
  }): Promise<void> {
    const response = await fetch(resendEmailsUrl, {
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
