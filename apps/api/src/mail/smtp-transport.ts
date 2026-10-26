import type { SendMailOptions, SMTPTransportOptions } from 'nodemailer';
import { createSmtpConnection } from './smtp-connection';
import { resolveSmtpEndpoint, type SmtpLookup } from './smtp-network-policy';
import { MailDeliveryError } from './mail-delivery-error';

export type SmtpSettings = {
  host: string;
  port: 465 | 587 | 2525;
  security: 'TLS' | 'STARTTLS';
  username: string;
  password: string;
};
type Address = string | { name: string; address: string };
type Receipt = { messageId: string; accepted: Address[]; rejected: Address[] };
export type SmtpConnection = {
  verify(): Promise<true>;
  sendMail(message: SendMailOptions): Promise<Receipt>;
  close(): void;
};
export type SmtpConnectionFactory = (options: SMTPTransportOptions) => SmtpConnection;
export type PreparedTransportMessage = {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  messageId: string;
};

/** A DATA timeout may have delivered mail: do not automatically retry or fall back. */
export class SmtpTransportError extends MailDeliveryError {
  constructor(
    readonly acceptance: 'rejected' | 'unknown',
    retryable: boolean,
  ) {
    super(
      acceptance === 'unknown'
        ? 'SMTP acceptance is unknown. Automatic retry and fallback are stopped to avoid duplicate mail.'
        : 'SMTP did not accept the message. Check the sending configuration.',
      retryable,
    );
    this.name = 'SmtpTransportError';
  }
}

function failure(error: unknown): SmtpTransportError {
  const info =
    error && typeof error === 'object'
      ? (error as { code?: unknown; command?: unknown; responseCode?: unknown })
      : {};
  const status = typeof info.responseCode === 'number' ? info.responseCode : undefined;
  // Explicit negative replies prove rejection, even at DATA. A missing/unknown command does not.
  if (status && status >= 400 && status <= 599)
    return new SmtpTransportError('rejected', status < 500);
  if (
    [
      'CONN',
      'EHLO',
      'HELO',
      'STARTTLS',
      'AUTH',
      'AUTH PLAIN',
      'AUTH LOGIN',
      'MAIL FROM',
      'RCPT TO',
    ].includes(String(info.command))
  )
    return new SmtpTransportError(
      'rejected',
      !['EAUTH', 'ETLS', 'EENVELOPE'].includes(String(info.code)),
    );
  return new SmtpTransportError('unknown', false);
}

/** Public-DNS-pinned TLS SMTP adapter; credentials and wire responses never enter errors/logs. */
export class SmtpTransport {
  constructor(
    private readonly resolve?: SmtpLookup,
    private readonly connect: SmtpConnectionFactory = createSmtpConnection,
  ) {}
  private async connection(settings: SmtpSettings): Promise<SmtpConnection> {
    if (
      !([465, 587, 2525] as number[]).includes(settings.port) ||
      (settings.port === 465 ? settings.security !== 'TLS' : settings.security !== 'STARTTLS') ||
      !settings.username ||
      settings.username.length > 320 ||
      !settings.password ||
      settings.password.length > 4096 ||
      /[\r\n\0]/.test(settings.username)
    )
      throw new SmtpTransportError('rejected', false);
    const endpoint = await resolveSmtpEndpoint(settings.host, this.resolve);
    try {
      return this.connect({
        host: endpoint.address,
        port: settings.port,
        secure: settings.security === 'TLS',
        requireTLS: true,
        ignoreTLS: false,
        opportunisticTLS: false,
        tls: { servername: endpoint.hostname, rejectUnauthorized: true, minVersion: 'TLSv1.2' },
        auth: { user: settings.username, pass: settings.password },
        pool: false,
        logger: false,
        debug: false,
        transactionLog: false,
        disableFileAccess: true,
        disableUrlAccess: true,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 30_000,
        maxRecipients: 100,
      });
    } catch {
      throw new SmtpTransportError('rejected', false);
    }
  }
  async check(settings: SmtpSettings): Promise<void> {
    const connection = await this.connection(settings);
    try {
      await connection.verify();
    } catch {
      throw new SmtpTransportError('rejected', false);
    } finally {
      connection.close();
    }
  }
  async send(settings: SmtpSettings, message: PreparedTransportMessage) {
    const recipients = [...message.to, ...(message.cc ?? []), ...(message.bcc ?? [])];
    if (
      !message.to.length ||
      recipients.length > 100 ||
      [message.from, message.subject, message.messageId, message.replyTo ?? '', ...recipients].some(
        (value) => /[\r\n\0]/.test(value),
      )
    )
      throw new SmtpTransportError('rejected', false);
    const connection = await this.connection(settings);
    try {
      const receipt = await connection.sendMail({
        from: message.from,
        to: message.to,
        cc: message.cc,
        bcc: message.bcc,
        replyTo: message.replyTo,
        subject: message.subject,
        html: message.html,
        text: message.text,
        messageId: message.messageId,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      return {
        provider: 'smtp' as const,
        providerMessageId: receipt.messageId,
        accepted: receipt.accepted.map((address) =>
          typeof address === 'string' ? address : address.address,
        ),
        rejected: receipt.rejected.map((address) =>
          typeof address === 'string' ? address : address.address,
        ),
      };
    } catch (error) {
      throw failure(error);
    } finally {
      connection.close();
    }
  }
}
