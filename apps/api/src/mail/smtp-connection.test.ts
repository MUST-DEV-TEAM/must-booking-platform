import net, { Socket } from 'node:net';
import type { SMTPTransportOptions } from 'nodemailer';
import { expect, it, vi } from 'vitest';
import { createSmtpConnection } from './smtp-connection';
import type { SmtpConnection } from './smtp-transport';

const options: SMTPTransportOptions = {
  host: '8.8.8.8',
  port: 587,
  secure: false,
  tls: { servername: 'smtp.gmail.com' },
  auth: { user: 'test-user', pass: 'test-password' },
};
const mail = {
  from: 'hotel@example.test',
  to: ['guest@example.test'],
  subject: 'test',
  text: 'test',
};
function fixture(pending = false) {
  const socket = new Socket(),
    sockets = vi.fn(() => socket);
  const transport: SmtpConnection = {
    verify: vi.fn(() => (pending ? new Promise<true>(() => {}) : Promise.resolve(true as const))),
    sendMail: vi.fn(() =>
      pending
        ? new Promise<Awaited<ReturnType<SmtpConnection['sendMail']>>>(() => {})
        : Promise.resolve({ messageId: 'receipt', accepted: [], rejected: [] }),
    ),
    close: vi.fn(),
  };
  const factory = vi.fn<(options: SMTPTransportOptions) => SmtpConnection>(() => transport);
  return { socket, sockets, transport, factory };
}
it('pins the checked socket target and ignores weaker TLS, proxy/service and logging options', async () => {
  const f = fixture(),
    connection = createSmtpConnection(
      {
        ...options,
        ignoreTLS: true,
        opportunisticTLS: true,
        debug: true,
        logger: true,
        service: 'untrusted-service',
        proxy: 'http://127.0.0.1',
        tls: { servername: 'smtp.gmail.com', rejectUnauthorized: false },
      },
      f.sockets,
      f.factory,
    );
  const config = f.factory.mock.calls[0][0];
  expect(config).toMatchObject({
    host: '8.8.8.8',
    port: 587,
    secure: false,
    requireTLS: true,
    ignoreTLS: false,
    opportunisticTLS: false,
    debug: false,
    logger: false,
    tls: { servername: 'smtp.gmail.com', rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    disableUrlAccess: true,
    disableFileAccess: true,
    pool: false,
  });
  expect(config.proxy).toBeUndefined();
  expect(config.service).toBeUndefined();
  const ready = vi.fn();
  config.getSocket?.({ host: 'attacker.internal', port: 25 }, ready);
  expect(f.sockets).toHaveBeenCalledWith({
    address: '8.8.8.8',
    port: 587,
    secure: false,
    servername: 'smtp.gmail.com',
  });
  f.socket.emit('connect');
  expect(ready).toHaveBeenCalledWith(null, { connection: f.socket, secured: false });
  const reuse = vi.fn();
  config.getSocket?.({}, reuse);
  expect(reuse.mock.calls[0][0]).toBeInstanceOf(Error);
  expect(f.sockets).toHaveBeenCalledOnce();
  await connection.verify();
  connection.close();
  connection.close();
  expect(f.socket.destroyed).toBe(true);
  expect(f.transport.close).toHaveBeenCalledOnce();
});
it('redacts raw socket errors and never opens another socket after close', () => {
  const f = fixture(),
    connection = createSmtpConnection(options, f.sockets, f.factory),
    config = f.factory.mock.calls[0][0],
    ready = vi.fn();
  config.getSocket?.({}, ready);
  f.socket.emit('error', new Error('test-password'));
  expect(ready.mock.calls[0][0].message).not.toContain('test-password');
  expect(f.socket.destroyed).toBe(true);
  connection.close();
  const closed = vi.fn();
  config.getSocket?.({}, closed);
  expect(closed.mock.calls[0][0]).toBeInstanceOf(Error);
  expect(f.sockets).toHaveBeenCalledOnce();
});
it('destroys a stalled socket at the absolute verification/send deadline and clears timers', async () => {
  vi.useFakeTimers();
  try {
    for (const kind of ['verify', 'send'] as const) {
      const f = fixture(true),
        connection = createSmtpConnection(options, f.sockets, f.factory),
        config = f.factory.mock.calls[0][0];
      config.getSocket?.({}, vi.fn());
      f.socket.emit('connect');
      const result = expect(
        kind === 'verify' ? connection.verify() : connection.sendMail(mail),
      ).rejects.toThrow('SMTP operation timed out.');
      await vi.advanceTimersByTimeAsync(kind === 'verify' ? 30_000 : 60_000);
      await result;
      expect(f.socket.destroyed).toBe(true);
      expect(f.transport.close).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    }
  } finally {
    vi.useRealTimers();
  }
});
it('clears successful operation timers and never turns a cleanup error into a resend', async () => {
  vi.useFakeTimers();
  try {
    const f = fixture(),
      connection = createSmtpConnection(options, f.sockets, () => ({
        ...f.transport,
        close: () => {
          throw new Error('private cleanup detail');
        },
      }));
    await expect(connection.verify()).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await expect(connection.sendMail(mail)).resolves.toMatchObject({ messageId: 'receipt' });
    expect(vi.getTimerCount()).toBe(0);
    expect(() => connection.close()).not.toThrow();
  } finally {
    vi.useRealTimers();
  }
});
it('fails closed before constructing a transport for private endpoints or wrong TLS/port combinations', () => {
  for (const patch of [
    { host: '127.0.0.1' },
    { host: 'smtp.gmail.com' },
    { port: 25 },
    { port: '587' },
    { port: 465, secure: false },
    { port: 587, secure: true },
    { tls: { servername: 'localhost' } },
  ]) {
    const f = fixture();
    expect(() => createSmtpConnection({ ...options, ...patch }, f.sockets, f.factory)).toThrow();
    expect(f.sockets).not.toHaveBeenCalled();
    expect(f.factory).not.toHaveBeenCalled();
    f.socket.destroy();
  }
});
it('uses the real SMTP parser against a local fake server and refuses AUTH when STARTTLS is unavailable', async () => {
  const commands: string[] = [],
    accepted = new Set<Socket>();
  const server = net.createServer((socket) => {
    accepted.add(socket);
    socket.on('close', () => accepted.delete(socket));
    socket.on('error', () => {});
    socket.write('220 local-test ESMTP\r\n');
    let pending = '';
    socket.on('data', (chunk) => {
      pending += chunk.toString();
      let end: number;
      while ((end = pending.indexOf('\r\n')) >= 0) {
        const command = pending.slice(0, end);
        pending = pending.slice(end + 2);
        commands.push(command);
        if (command.startsWith('EHLO')) socket.write('250-local-test\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (command === 'STARTTLS') socket.write('502 TLS is unavailable\r\n');
        else socket.write('500 Unexpected test command\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local test server has no port.');
  const connection = createSmtpConnection(options, () =>
    net.createConnection({ host: '127.0.0.1', port: address.port }),
  );
  try {
    await expect(connection.verify()).rejects.toThrow();
    expect(commands.some((command) => command.startsWith('EHLO'))).toBe(true);
    expect(commands).toContain('STARTTLS');
    expect(commands.some((command) => command.startsWith('AUTH'))).toBe(false);
    expect(commands.join('\n')).not.toContain('test-password');
  } finally {
    connection.close();
    for (const socket of accepted) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
