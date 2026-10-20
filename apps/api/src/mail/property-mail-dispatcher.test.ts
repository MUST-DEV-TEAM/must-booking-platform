import { afterEach, expect, it, vi } from 'vitest';
import { PropertyMailDispatcher } from './property-mail-dispatcher';
import type {
  EmailTransportJournal,
  FrozenTransport,
  TransportScope,
  TransportStage,
} from './email-transport-journal';
import type { EmailTransportCredentialService } from './email-transport-credentials';
import type { AuditLogService } from '../tenancy/audit-log.service';
import type { TenantTransaction } from '../tenancy/tenant-database.service';
import { SmtpTransport, SmtpTransportError } from './smtp-transport';
import type { PreparedMailReceipt, PreparedMailError } from './prepared-mail-transport';
import { withMailAttempt } from './mail-attempt-context';

const scope = {
  tenantId: 'tenant',
  propertyId: 'property',
  messageId: 'message',
  sensitive: false,
  guestTransactional: true,
  finalAttempt: true,
};
const input = {
  to: 'guest@example.test',
  subject: 'Original',
  html: '<p>Original</p>',
  text: 'Original',
  idempotencyKey: 'original-key',
  fromName: 'Hotel',
};
function fixture() {
  const profile = {
    version: 4,
    mode: 'SMTP',
    activeMode: 'SMTP',
    fromName: 'Custom Hotel',
    fromAddress: 'hotel@example.test',
    domain: null as string | null,
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    smtpSecurity: 'STARTTLS',
    credentialRevision: 'revision',
    encryptedCredentials: 'encrypted',
    fromVerifiedAt: new Date(),
    connectionStatus: 'verified',
    domainStatus: 'unknown',
    fallbackGuest: true,
  };
  let frozen: FrozenTransport;
  const tx = { $queryRaw: vi.fn(async () => [profile]) } as unknown as TenantTransaction;
  const journal = {
    claim: vi.fn(
      async (
        _scope: object,
        _stage: string,
        prepare: (tx: TenantTransaction) => Promise<FrozenTransport | null>,
      ) => {
        const snapshot = await prepare(tx);
        if (!snapshot) return { kind: 'bypass' };
        if (_stage === 'PRIMARY') frozen = snapshot;
        return { kind: 'send', fence: 'fence', attempt: 1, snapshot };
      },
    ),
    finish: vi.fn<
      (
        scope: TransportScope,
        stage: TransportStage,
        fence: string,
        result: PreparedMailReceipt | PreparedMailError,
      ) => Promise<boolean>
    >(async () => true),
    frozen: vi.fn(async () => frozen),
  };
  const credentials = {
    open: vi.fn<EmailTransportCredentialService['open']>(() => ({
      provider: 'smtp',
      username: 'test-user',
      password: 'test-password',
    })),
  };
  const smtp = new SmtpTransport();
  const send = vi.spyOn(smtp, 'send').mockResolvedValue({
    provider: 'smtp',
    providerMessageId: 'smtp-receipt',
    accepted: ['guest@example.test'],
    rejected: [],
  });
  const audit = { recordInTransaction: vi.fn(async () => {}) };
  const dispatcher = new PropertyMailDispatcher(
    journal as unknown as EmailTransportJournal,
    credentials as unknown as EmailTransportCredentialService,
    smtp,
    audit as unknown as AuditLogService,
  );
  const defaultSend = vi.fn(async () => ({ providerMessageId: 'default-receipt' }));
  return { dispatcher, profile, journal, send, audit, credentials, defaultSend };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it('uses verified pending SMTP for an explicit self-test without activating or using MUST', async () => {
  const f = fixture();
  f.profile.activeMode = 'DEFAULT';
  const receipt = await withMailAttempt(
    { ...scope, senderTestVersion: 4, senderTestActorId: 'actor' },
    () => f.dispatcher.send(input, f.defaultSend),
  );
  expect(receipt).toMatchObject({ provider: 'smtp' });
  expect(f.send).toHaveBeenCalledOnce();
  expect(f.defaultSend).not.toHaveBeenCalled();
  expect(f.profile.activeMode).toBe('DEFAULT');
});
it('uses verified pending Resend for a custom self-test with the hotel key and identity', async () => {
  const f = fixture();
  f.profile.activeMode = 'DEFAULT';
  f.profile.mode = 'RESEND';
  f.profile.domain = 'example.test';
  f.profile.domainStatus = 'verified';
  f.credentials.open.mockReturnValue({ provider: 'resend', apiKey: 're_fake_hotel_key' });
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ id: 'resend-self-test' }));
  vi.stubGlobal('fetch', request);
  expect(
    await withMailAttempt({ ...scope, senderTestVersion: 4 }, () =>
      f.dispatcher.send(input, f.defaultSend),
    ),
  ).toEqual({ provider: 'resend', providerMessageId: 'resend-self-test' });
  expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toMatchObject({
    from: '"Custom Hotel" <hotel@example.test>',
  });
  expect(f.defaultSend).not.toHaveBeenCalled();
  expect(f.send).not.toHaveBeenCalled();
});
it('fails an outdated sender test before any transport or default sender request', async () => {
  const f = fixture();
  await expect(
    withMailAttempt({ ...scope, senderTestVersion: 5 }, () =>
      f.dispatcher.send(input, f.defaultSend),
    ),
  ).rejects.toThrow('Saved sender setup changed');
  expect(f.send).not.toHaveBeenCalled();
  expect(f.defaultSend).not.toHaveBeenCalled();
});
it.each([{ forceDefault: true }, { sensitive: true }])(
  'never reports a default/security send as a successful custom test',
  async (flags) => {
    const f = fixture();
    await expect(
      withMailAttempt({ ...scope, ...flags, senderTestVersion: 4 }, () =>
        f.dispatcher.send(input, f.defaultSend),
      ),
    ).rejects.toThrow('No default-sender test was sent');
    expect(f.defaultSend).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  },
);
it('never falls back a controlled test even when an unrelated caller marks it guest mail', async () => {
  const f = fixture();
  f.send.mockRejectedValue(new SmtpTransportError('rejected', false));
  await expect(
    withMailAttempt({ ...scope, senderTestVersion: 4 }, () =>
      f.dispatcher.send(input, f.defaultSend),
    ),
  ).rejects.toMatchObject({ acceptance: 'rejected' });
  expect(f.journal.claim).toHaveBeenCalledTimes(1);
  expect(f.defaultSend).not.toHaveBeenCalled();
});
it('bypasses custom delivery for sensitive and explicitly platform-owned messages', async () => {
  const f = fixture();
  for (const flags of [{ sensitive: true }, { forceDefault: true }])
    await withMailAttempt({ ...scope, ...flags }, () => f.dispatcher.send(input, f.defaultSend));
  expect(f.defaultSend).toHaveBeenCalledTimes(2);
  expect(f.journal.claim).not.toHaveBeenCalled();
  expect(f.send).not.toHaveBeenCalled();
});
it('uses the verified hotel SMTP identity and records the actual provider receipt', async () => {
  const f = fixture();
  expect(await withMailAttempt(scope, () => f.dispatcher.send(input, f.defaultSend))).toEqual({
    provider: 'smtp',
    providerMessageId: 'smtp-receipt',
  });
  expect(f.send.mock.calls[0]?.[1]).toMatchObject({
    from: '"Custom Hotel" <hotel@example.test>',
    subject: 'Original',
    to: ['guest@example.test'],
    messageId: '<message@mustbooking.com>',
  });
  expect(f.journal.finish).toHaveBeenCalledWith(expect.anything(), 'PRIMARY', 'fence', {
    provider: 'smtp',
    providerMessageId: 'smtp-receipt',
  });
  expect(f.defaultSend).not.toHaveBeenCalled();
});
it('does not activate a saved pending custom profile', async () => {
  const f = fixture();
  f.profile.activeMode = 'DEFAULT';
  await withMailAttempt(scope, () => f.dispatcher.send(input, f.defaultSend));
  expect(f.defaultSend).toHaveBeenCalledOnce();
  expect(f.send).not.toHaveBeenCalled();
  expect(f.credentials.open).not.toHaveBeenCalled();
});
it('never retries or falls back after unknown SMTP acceptance', async () => {
  const f = fixture();
  f.send.mockRejectedValue(new SmtpTransportError('unknown', false));
  await expect(
    withMailAttempt(scope, () => f.dispatcher.send(input, f.defaultSend)),
  ).rejects.toMatchObject({ acceptance: 'unknown', retryable: false });
  expect(f.journal.claim).toHaveBeenCalledTimes(1);
  expect(f.journal.finish.mock.calls[0]?.[3]).toMatchObject({ acceptance: 'unknown' });
});
it('treats partial SMTP acceptance as unknown, preventing fallback', async () => {
  const f = fixture();
  f.send.mockResolvedValue({
    provider: 'smtp',
    providerMessageId: 'partial',
    accepted: ['guest@example.test'],
    rejected: ['unexpected@example.test'],
  });
  await expect(
    withMailAttempt(scope, () => f.dispatcher.send(input, f.defaultSend)),
  ).rejects.toMatchObject({ acceptance: 'unknown' });
  expect(f.journal.claim).toHaveBeenCalledTimes(1);
});
it('retries known transient rejection before considering guest fallback', async () => {
  const f = fixture();
  f.send.mockRejectedValue(new SmtpTransportError('rejected', true));
  await expect(
    withMailAttempt({ ...scope, finalAttempt: false }, () =>
      f.dispatcher.send(input, f.defaultSend),
    ),
  ).rejects.toMatchObject({ acceptance: 'rejected', retryable: true });
  expect(f.journal.claim).toHaveBeenCalledTimes(1);
});
it('audits a guest fallback after proven rejection, preserving content with a separate stable key', async () => {
  const f = fixture();
  f.send.mockRejectedValue(new SmtpTransportError('rejected', false));
  vi.stubEnv('MAIL_FROM_EMAIL', 'MUST <mail@must.example.test>');
  vi.stubEnv('RESEND_API_KEY', 'test-default-key');
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ id: 'fallback-receipt' }));
  vi.stubGlobal('fetch', fetcher);
  expect(await withMailAttempt(scope, () => f.dispatcher.send(input, f.defaultSend))).toEqual({
    provider: 'resend',
    providerMessageId: 'fallback-receipt',
    usedFallback: true,
  });
  const request = fetcher.mock.calls[0]?.[1];
  expect(new Headers(request?.headers).get('idempotency-key')).toBe('hotel-mail/message/fallback');
  expect(JSON.parse(String(request?.body))).toMatchObject({
    from: '"Custom Hotel" <mail@must.example.test>',
    subject: 'Original',
    html: '<p>Original</p>',
  });
  expect(f.audit.recordInTransaction).toHaveBeenCalledOnce();
});
it.each([{ guestTransactional: false }, { guestTransactional: true }])(
  'respects staff scope and an explicitly disabled fallback',
  async (flags) => {
    const f = fixture();
    if (flags.guestTransactional) f.profile.fallbackGuest = false;
    f.send.mockRejectedValue(new SmtpTransportError('rejected', false));
    await expect(
      withMailAttempt({ ...scope, ...flags }, () => f.dispatcher.send(input, f.defaultSend)),
    ).rejects.toMatchObject({ acceptance: 'rejected' });
    expect(f.journal.claim).toHaveBeenCalledTimes(1);
  },
);
it('does not fall back when the receipt/audit transaction could not commit', async () => {
  const f = fixture();
  f.journal.finish.mockRejectedValue(Error('Simulated audit failure'));
  await expect(
    withMailAttempt(scope, () => f.dispatcher.send(input, f.defaultSend)),
  ).rejects.toMatchObject({ acceptance: 'unknown' });
  expect(f.journal.claim).toHaveBeenCalledTimes(1);
});

it('sends custom staff To/CC/BCC once with genuine headers and no guest fallback', async () => {
  const f = fixture();
  const recipientEnvelope = {
    to: ['to@example.test'],
    cc: ['copy@example.test'],
    bcc: ['private@example.test'],
  };
  f.send.mockResolvedValue({
    provider: 'smtp',
    providerMessageId: 'group-receipt',
    accepted: [...recipientEnvelope.to, ...recipientEnvelope.cc, ...recipientEnvelope.bcc],
    rejected: [],
  });
  const receipt = await withMailAttempt(
    { ...scope, guestTransactional: false, recipientEnvelope },
    () => f.dispatcher.send(input, f.defaultSend),
  );
  expect(receipt).toEqual({ provider: 'smtp', providerMessageId: 'group-receipt' });
  expect(f.send).toHaveBeenCalledOnce();
  expect(f.send.mock.calls[0][1]).toMatchObject(recipientEnvelope);
  expect(f.send.mock.calls[0][1].text).not.toContain('private@example.test');
  expect(f.defaultSend).not.toHaveBeenCalled();
});
it('uses the durable journal for grouped default-MUST mail as well as custom senders', async () => {
  const f = fixture();
  f.profile.activeMode = 'DEFAULT';
  vi.stubEnv('RESEND_API_KEY', 're_fake_default_key');
  vi.stubEnv('MAIL_FROM_EMAIL', 'MUST <noreply@example.test>');
  const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: 'group-default' }));
  vi.stubGlobal('fetch', request);
  const recipientEnvelope = {
    to: ['to@example.test'],
    cc: ['copy@example.test'],
    bcc: ['private@example.test'],
  };
  await withMailAttempt({ ...scope, guestTransactional: false, recipientEnvelope }, () =>
    f.dispatcher.send(input, f.defaultSend),
  );
  expect(request).toHaveBeenCalledOnce();
  expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toMatchObject(recipientEnvelope);
  expect(f.journal.finish).toHaveBeenCalledOnce();
  expect(f.defaultSend).not.toHaveBeenCalled();
});
it('refuses grouped routing for sensitive account mail', async () => {
  const f = fixture();
  await expect(
    withMailAttempt(
      {
        ...scope,
        sensitive: true,
        recipientEnvelope: { to: ['staff@example.test'], cc: [], bcc: [] },
      },
      () => f.dispatcher.send(input, f.defaultSend),
    ),
  ).rejects.toThrow('ordinary scoped');
  expect(f.journal.claim).not.toHaveBeenCalled();
  expect(f.defaultSend).not.toHaveBeenCalled();
});
