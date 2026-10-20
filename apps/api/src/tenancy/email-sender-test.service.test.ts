import { afterEach, expect, it, vi } from 'vitest';
import type { RenderedEmailCommand } from '@must/domain-contracts';
import { EmailSenderTestService } from './email-sender-test.service';
import type { TenantDatabaseService, TenantTransaction } from './tenant-database.service';
import type { AuditLogService } from './audit-log.service';
import type { MailDeliveryService, DispatchOptions } from '../mail/mail-delivery.service';
const scope = { tenantId: 'tenant', propertyId: 'property' },
  actor = 'actor';
const profile = {
  version: 4,
  mode: 'SMTP',
  fromName: 'Hotel',
  fromAddress: 'hotel@example.test',
  domain: null,
  credentials: true,
  fromVerifiedAt: new Date(),
  connectionCheckedAt: new Date(),
  connectionStatus: 'verified',
  domainStatus: 'unknown',
  domainCheckedAt: null,
  propertyName: 'Hotel',
  replyTo: 'hotel@example.test',
};
function fixture(count = 0, version = 4) {
  const query = vi.fn();
  let saved: object | undefined;
  const dispatch = vi.fn(
    async (
      _kind: string,
      command: RenderedEmailCommand,
      _scope: object,
      options: DispatchOptions,
    ) => {
      saved = {
        kind: 'CUSTOM_SENDER_TEST',
        id: command.idempotencyKey.split('/')[1],
        actorUserId: actor,
        senderVersion: options.senderTestVersion,
        mode: 'SMTP',
        createdAt: new Date().toISOString(),
        command,
      };
    },
  );
  query
    .mockResolvedValueOnce([{ id: 'property' }])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ ...profile, version }])
    .mockResolvedValueOnce([{ email: 'actor@example.test' }])
    .mockResolvedValueOnce([{ count: BigInt(count) }])
    .mockResolvedValueOnce([{ now: new Date() }])
    .mockImplementationOnce(async () => [{ intent: saved }])
    .mockResolvedValueOnce([]);
  const tx = {
    $queryRaw: query,
    $executeRaw: vi.fn(async () => 1),
  } as unknown as TenantTransaction;
  const transaction = vi.fn(async (_: object, run: (tx: TenantTransaction) => Promise<unknown>) =>
    run(tx),
  );
  const audit = { recordInTransaction: vi.fn(async () => {}) };
  const service = new EmailSenderTestService(
    { withTenantTransaction: transaction } as unknown as TenantDatabaseService,
    audit as unknown as AuditLogService,
    { dispatch } as unknown as MailDeliveryService,
  );
  return { service, query, dispatch, audit, transaction };
}
afterEach(() => vi.restoreAllMocks());
it('creates only an actor-addressed, immutable custom test and passes server-owned sender context', async () => {
  const f = fixture();
  const result = await f.service.request(
    scope,
    actor,
    { version: 4, reason: 'Check custom sender' },
    'test-key',
  );
  expect(result).toMatchObject({
    recipient: 'actor@example.test',
    mode: 'SMTP',
    status: 'PENDING',
    senderVersion: 4,
    activationChanged: false,
  });
  expect(f.dispatch).toHaveBeenCalledWith(
    'rendered',
    expect.objectContaining({
      to: 'actor@example.test',
      eventType: 'sender.test',
      bookingId: null,
    }),
    scope,
    { preserveIdentity: true, senderTestVersion: 4, senderTestActorId: actor },
  );
  expect(f.audit.recordInTransaction).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      action: 'email_sender.test_requested',
      details: expect.objectContaining({
        recipientUserId: actor,
        guestFallback: false,
        activationChanged: false,
      }),
    }),
  );
});
it('refuses caller-supplied recipients and unknown fields without touching storage', async () => {
  const f = fixture();
  await expect(
    f.service.request(
      scope,
      actor,
      { version: 4, reason: 'Check custom sender', to: 'guest@example.test' },
      'key',
    ),
  ).rejects.toThrow('current sender version');
  expect(f.transaction).not.toHaveBeenCalled();
  expect(f.dispatch).not.toHaveBeenCalled();
});
it('enforces the property-wide cap before publication', async () => {
  const f = fixture(3);
  await expect(
    f.service.request(scope, actor, { version: 4, reason: 'Check custom sender' }, 'key'),
  ).rejects.toMatchObject({ status: 429 });
  expect(f.dispatch).not.toHaveBeenCalled();
});
it('rejects a stale configuration before publishing a test', async () => {
  const f = fixture(0, 5);
  await expect(
    f.service.request(scope, actor, { version: 4, reason: 'Check custom sender' }, 'key'),
  ).rejects.toThrow('Sender setup changed');
  expect(f.dispatch).not.toHaveBeenCalled();
});
it('does not publish expired recovered intentions', async () => {
  const f = fixture();
  f.query
    .mockReset()
    .mockResolvedValue([
      {
        intent: {
          createdAt: new Date(Date.now() - 8 * 86400000).toISOString(),
          command: {},
          kind: 'CUSTOM_SENDER_TEST',
        },
      },
    ]);
  await f.service.recover(scope);
  expect(f.dispatch).not.toHaveBeenCalled();
});
it('reads actual status without sending or returning the stored command', async () => {
  const f = fixture();
  f.query
    .mockReset()
    .mockResolvedValueOnce([
      {
        intent: {
          id: 'test-id',
          mode: 'SMTP',
          senderVersion: 4,
          createdAt: new Date().toISOString(),
          command: { idempotencyKey: 'test-key', to: 'actor@example.test' },
        },
      },
    ])
    .mockResolvedValueOnce([
      { id: 'mail-id', status: 'SENT', provider: 'smtp', transportBlocked: false },
    ]);
  const result = await f.service.status(scope, actor, 'test-id');
  expect(result).toMatchObject({ messageId: 'mail-id', status: 'SENT', provider: 'smtp' });
  expect(result).not.toHaveProperty('command');
  expect(f.dispatch).not.toHaveBeenCalled();
});
