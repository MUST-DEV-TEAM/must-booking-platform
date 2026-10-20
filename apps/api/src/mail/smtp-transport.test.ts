import { describe, expect, it, vi } from 'vitest';
import type { SendMailOptions } from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer';
import { SmtpTransport, SmtpTransportError, type SmtpSettings } from './smtp-transport';

const settings: SmtpSettings = {
  host: 'smtp.gmail.com',
  port: 587,
  security: 'STARTTLS',
  username: 'owner@example.test',
  password: 'test-only-secret',
};
const message = {
  from: 'Hotel <hotel@example.test>',
  to: ['guest@example.test'],
  cc: ['staff@example.test'],
  bcc: ['owner@example.test'],
  replyTo: 'replies@example.test',
  subject: 'Your booking',
  html: '<p>Your booking</p>',
  text: 'Your booking',
  messageId: '<stable-logical-id@mustbooking.com>',
};
function setup() {
  const dns = vi.fn().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  const connection = {
    verify: vi.fn().mockResolvedValue(true),
    sendMail: vi
      .fn<
        (message: SendMailOptions) => Promise<{
          messageId: string;
          accepted: Array<string | { name: string; address: string }>;
          rejected: string[];
        }>
      >()
      .mockResolvedValue({ messageId: 'smtp-receipt', accepted: message.to, rejected: [] }),
    close: vi.fn(),
  };
  const connect = vi.fn(() => connection);
  return { dns, connection, connect, transport: new SmtpTransport(dns, connect) };
}
describe('SMTP adapter with mocked connections', () => {
  it('whitelists message fields so extra envelope/auth/header options cannot redirect an approved delivery', async () => {
    const { transport, connection } = setup();
    const injected = {
      ...message,
      envelope: { to: ['attacker@example.test'] },
      auth: { user: 'attacker', pass: 'secret' },
      headers: { Bcc: 'attacker@example.test' },
    };
    await transport.send(settings, injected);
    expect(connection.sendMail).toHaveBeenCalledWith({
      ...message,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  });
  it('serializes real MIME To/CC without exposing BCC or credentials, without opening a network connection', async () => {
    let wire = '';
    const transport = new SmtpTransport(
      async () => [{ address: '8.8.8.8', family: 4 }],
      () => ({
        verify: async () => true,
        sendMail: async (options) => {
          // SMTP uses the compiler's default hidden BCC. Nodemailer's debug stream transport
          // deliberately keeps BCC and is therefore not a faithful SMTP serializer here.
          const mime = new MailComposer(options).compile();
          wire = (await mime.build()).toString();
          expect(mime.getEnvelope().to).toEqual([...message.to, ...message.cc, ...message.bcc]);
          return { messageId: message.messageId, accepted: mime.getEnvelope().to, rejected: [] };
        },
        close: () => {},
      }),
    );
    await transport.send(settings, message);
    expect(wire).toContain('To: guest@example.test');
    expect(wire).toContain('Cc: staff@example.test');
    expect(wire).toContain('Message-ID: ' + message.messageId);
    expect(wire).not.toMatch(/^Bcc:/im);
    expect(wire).not.toContain(message.bcc[0]);
    expect(wire).not.toContain(settings.password);
    expect(wire).toContain('multipart/alternative');
  });
  it('redacts constructor failures without exposing credentials', async () => {
    const transport = new SmtpTransport(
      async () => [{ address: '8.8.8.8', family: 4 }],
      () => {
        throw new Error(settings.password);
      },
    );
    await expect(transport.check(settings)).rejects.toMatchObject({
      acceptance: 'rejected',
      retryable: false,
    });
    await expect(transport.send(settings, message)).rejects.not.toThrow(settings.password);
  });
  it('pins checked DNS, requires TLS/certificate validation and disables content access and logging', async () => {
    const { transport, connection, connect } = setup();
    await transport.check(settings);
    expect(connection.verify).toHaveBeenCalledOnce();
    expect(connection.sendMail).not.toHaveBeenCalled();
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        host: '8.8.8.8',
        port: 587,
        secure: false,
        requireTLS: true,
        ignoreTLS: false,
        opportunisticTLS: false,
        tls: { servername: 'smtp.gmail.com', rejectUnauthorized: true, minVersion: 'TLSv1.2' },
        disableFileAccess: true,
        disableUrlAccess: true,
        logger: false,
        debug: false,
        transactionLog: false,
        pool: false,
        maxRecipients: 100,
      }),
    );
    expect(connection.close).toHaveBeenCalledOnce();
  });
  it('uses implicit TLS only on 465, preserves actual To/CC/BCC, stable Message-ID and partial rejection evidence', async () => {
    const { transport, connection, connect } = setup();
    connection.sendMail.mockResolvedValue({
      messageId: 'smtp-receipt',
      accepted: [{ name: 'Guest', address: message.to[0] }],
      rejected: message.cc,
    });
    const receipt = await transport.send({ ...settings, port: 465, security: 'TLS' }, message);
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ secure: true, port: 465 }));
    expect(connection.sendMail).toHaveBeenCalledWith({
      ...message,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    expect(receipt).toEqual({
      provider: 'smtp',
      providerMessageId: 'smtp-receipt',
      accepted: message.to,
      rejected: message.cc,
    });
    expect(connection.close).toHaveBeenCalledOnce();
  });
  it('re-resolves on each connection and blocks rebinding without creating a socket', async () => {
    const { transport, dns, connect } = setup();
    await transport.check(settings);
    dns.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    await expect(transport.send(settings, message)).rejects.toThrow('public SMTP');
    expect(connect).toHaveBeenCalledOnce();
  });
  it.each([
    { port: 25 },
    { port: 465, security: 'STARTTLS' },
    { port: 587, security: 'TLS' },
    { username: '' },
    { password: '' },
    { username: 'injected\r\nAUTH' },
  ])('fails closed on invalid settings %o', async (patch) => {
    const { transport, dns, connect } = setup();
    await expect(transport.check({ ...settings, ...patch } as SmtpSettings)).rejects.toThrow(
      SmtpTransportError,
    );
    expect(connect).not.toHaveBeenCalled();
    expect(dns).not.toHaveBeenCalled();
  });
  it.each([
    { command: 'DATA', code: 'ETIMEDOUT' },
    { code: 'ECONNRESET' },
    new Error('secret raw server response'),
  ])('stops retries for uncertain acceptance and redacts wire errors', async (error) => {
    const { transport, connection } = setup();
    connection.sendMail.mockRejectedValue(error);
    await expect(transport.send(settings, message)).rejects.toMatchObject({
      acceptance: 'unknown',
      retryable: false,
    });
    await expect(transport.send(settings, message)).rejects.not.toThrow(
      'secret raw server response',
    );
    expect(connection.close).toHaveBeenCalledTimes(2);
  });
  it.each([
    { error: { command: 'DATA', responseCode: 451 }, retryable: true },
    { error: { command: 'DATA', responseCode: 550 }, retryable: false },
    { error: { command: 'CONN', code: 'ECONNREFUSED' }, retryable: true },
    { error: { command: 'AUTH PLAIN', code: 'EAUTH' }, retryable: false },
    { error: { command: 'STARTTLS', code: 'ETLS' }, retryable: false },
  ])(
    'allows only proven rejection to be considered for fallback: %o',
    async ({ error, retryable }) => {
      const { transport, connection } = setup();
      connection.sendMail.mockRejectedValue(error);
      await expect(transport.send(settings, message)).rejects.toMatchObject({
        acceptance: 'rejected',
        retryable,
      });
      expect(connection.close).toHaveBeenCalledOnce();
    },
  );
  it('redacts failed connection checks, closes transport and never sends a message', async () => {
    const { transport, connection } = setup();
    connection.verify.mockRejectedValue(new Error(settings.password));
    await expect(transport.check(settings)).rejects.toMatchObject({
      acceptance: 'rejected',
      retryable: false,
    });
    expect(connection.close).toHaveBeenCalledOnce();
    expect(connection.sendMail).not.toHaveBeenCalled();
  });
  it('rejects header injection and oversized recipient sets before connecting', async () => {
    const { transport, connect } = setup();
    for (const patch of [
      { subject: 'Hello\r\nBcc: stolen@example.test' },
      { to: [] },
      { bcc: Array(100).fill('extra@example.test') },
    ])
      await expect(transport.send(settings, { ...message, ...patch })).rejects.toThrow(
        SmtpTransportError,
      );
    expect(connect).not.toHaveBeenCalled();
  });
});
