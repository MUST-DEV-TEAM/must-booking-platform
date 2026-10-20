import net, { type Socket } from 'node:net';
import tls from 'node:tls';
import nodemailer, { type SMTPTransportOptions } from 'nodemailer';
import type { SmtpConnection } from './smtp-transport';
import { isPublicSmtpAddress, smtpHostname } from './smtp-network-policy';

type SocketTarget = { address: string; port: number; secure: boolean; servername: string };
export type SmtpSocketFactory = (target: SocketTarget) => Socket;
type MailerFactory = (options: SMTPTransportOptions) => SmtpConnection;
const openSocket: SmtpSocketFactory = (target) =>
  target.secure
    ? tls.connect({
        host: target.address,
        port: target.port,
        servername: target.servername,
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
      })
    : net.createConnection({ host: target.address, port: target.port });

/** Own the pinned socket so operation deadlines actually close it, including during MIME work. */
export function createSmtpConnection(
  options: SMTPTransportOptions,
  sockets: SmtpSocketFactory = openSocket,
  mailers: MailerFactory = (options) => nodemailer.createTransport(options),
): SmtpConnection {
  let socket: Socket | undefined,
    closed = false;
  const address = options.host ?? '',
    port = options.port ?? 0;
  if (
    typeof port !== 'number' ||
    !isPublicSmtpAddress(address) ||
    ![465, 587, 2525].includes(port) ||
    (port === 465 ? options.secure !== true : !!options.secure)
  )
    throw new Error('Invalid checked SMTP endpoint.');
  const servername = smtpHostname(options.tls?.servername ?? '');
  const auth = options.auth;
  if (
    !auth ||
    typeof auth !== 'object' ||
    !('user' in auth) ||
    typeof auth.user !== 'string' ||
    !('pass' in auth) ||
    typeof auth.pass !== 'string'
  )
    throw new Error('Invalid SMTP credentials.');
  const configuration: SMTPTransportOptions = {
    host: address,
    port,
    secure: !!options.secure,
    auth: { user: auth.user, pass: auth.pass },
    tls: { servername, rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    requireTLS: true,
    ignoreTLS: false,
    opportunisticTLS: false,
    logger: false,
    debug: false,
    transactionLog: false,
    pool: false,
    disableFileAccess: true,
    disableUrlAccess: true,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    maxRecipients: 100,
    getSocket: (_options, done) => {
      if (closed || socket) {
        done(new Error('SMTP connection is unavailable for reuse.'));
        return;
      }
      let finished = false;
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true;
        socket?.removeListener('error', failed);
        socket?.removeListener(options.secure ? 'secureConnect' : 'connect', ready);
        if (error) {
          socket?.destroy();
          done(error);
        } else done(null, { connection: socket, secured: !!options.secure });
      };
      const failed = (error: Error) => {
        const code = 'code' in error ? String(error.code) : '';
        finish(
          Object.assign(new Error('SMTP connection failed.'), {
            command: 'CONN',
            code: /CERT|TLS/.test(code) ? 'ETLS' : 'ECONNECTION',
          }),
        );
      };
      const ready = () => finish();
      try {
        socket = sockets({ address, port, secure: !!options.secure, servername });
        socket.once('error', failed);
        socket.once(options.secure ? 'secureConnect' : 'connect', ready);
      } catch {
        finish(new Error('SMTP connection failed.'));
      }
    },
  };
  let transport: SmtpConnection;
  try {
    transport = mailers(configuration);
  } catch {
    socket?.destroy();
    throw new Error('SMTP transport could not be created.');
  }
  const close = () => {
    if (closed) return;
    closed = true;
    try {
      socket?.destroy();
    } catch {
      /* Closing cannot turn acceptance into a resend. */
    }
    try {
      transport.close();
    } catch {
      /* No raw transport errors or duplicate sends after acceptance. */
    }
  };
  async function bounded<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            close();
            reject(new Error('SMTP operation timed out.'));
          }, timeoutMs);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return {
    verify: () => bounded(() => transport.verify(), 30_000),
    sendMail: (message) => bounded(() => transport.sendMail(message), 60_000),
    close,
  };
}
