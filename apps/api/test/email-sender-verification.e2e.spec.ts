import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import IORedis from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { MailDeliveryService } from '../src/mail/mail-delivery.service';
import { SenderVerificationStore } from '../src/mail/sender-verification-store';
import { EmailSenderVerificationService } from '../src/tenancy/email-sender-verification.service';
import { TenantDatabaseService } from '../src/tenancy/tenant-database.service';
import { AuditLogService } from '../src/tenancy/audit-log.service';
import { SmtpTransport } from '../src/mail/smtp-transport';
import { withoutExternalWorkers } from './helpers/without-external-workers';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';
import { cleanupTenant } from './helpers/cleanup-tenant';

const admin = new PrismaClient({
  datasources: {
    db: { url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking' },
  },
});
describe('scoped SMTP sender mailbox proofs through real PG/Redis with mocked delivery', () => {
  let app: INestApplication,
    tenantId = '',
    propertyId = '',
    userId = '',
    cookie = '',
    accountToken = '';
  const queueName = `mail-proof-test-${randomUUID()}`;
  const codes = new Map<string, string>();
  let redis: IORedis, release: (() => void) | undefined, blocked: Promise<void> | undefined;
  const oldEnv = new Map<string, string | undefined>();
  const smtpCheck = vi.fn(async () => {});
  const sendRendered = vi.fn<MailProvider['sendRenderedEmail']>(async (command) => {
    const code = /[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}/.exec(command.text)?.[0];
    if (code) codes.set(code.slice(0, 36), code);
    if (blocked) await blocked;
    return { providerMessageId: `mock-${command.idempotencyKey}` };
  });
  const mail: MailProvider = {
    async sendVerificationEmail(command) {
      accountToken = new URL(command.verificationUrl).searchParams.get('token')!;
    },
    async sendWelcomeEmail() {},
    async sendPasswordResetEmail() {},
    async sendStaffInvitationEmail() {},
    async sendPaymentConfirmationEmail() {},
    async sendNewBookingStaffNotification() {},
    async sendRefundConfirmationEmail() {},
    async sendBookingCancelledEmail() {},
    async sendBookingCancelledStaffNotification() {},
    sendRenderedEmail: sendRendered,
  };
  beforeAll(async () => {
    for (const key of [
      'INTEGRATION_CREDENTIALS_KEY',
      'RESEND_API_KEY',
      'MAIL_FROM_EMAIL',
      'WEB_APP_URL',
    ])
      oldEnv.set(key, process.env[key]);
    process.env.INTEGRATION_CREDENTIALS_KEY = Buffer.alloc(32, 31).toString('base64');
    process.env.RESEND_API_KEY = 're_mock_mailbox_proof';
    process.env.MAIL_FROM_EMAIL = 'MUST Booking <security@example.test>';
    process.env.WEB_APP_URL = 'http://localhost:3001';
    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL =
      'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('External HTTP is forbidden in mailbox proof tests.');
      }),
    );
    await clearSignupRateLimits();
    const { AppModule } = await import('../src/app.module');
    const module = await withoutExternalWorkers(
      Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(MAIL_PROVIDER)
        .useValue(mail)
        .overrideProvider(SmtpTransport)
        .useValue({
          check: smtpCheck,
          send: vi.fn(() => {
            throw Error('SMTP must not deliver a proof.');
          }),
        })
        .overrideProvider(MailDeliveryService)
        .useFactory({
          inject: [TenantDatabaseService, MAIL_PROVIDER, SenderVerificationStore],
          factory: (
            db: TenantDatabaseService,
            provider: MailProvider,
            store: SenderVerificationStore,
          ) => {
            const delivery = new MailDeliveryService(db, provider, store);
            delivery.queueName = queueName;
            delivery.retryPolicy = { attempts: 2, backoffMs: 50 };
            return delivery;
          },
        }),
    ).compile();
    app = module.createNestApplication();
    await app.init();
    redis = new IORedis(process.env.REDIS_URL);
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Mailbox proof fixture',
        propertyName: 'Mailbox hotel',
        propertyAddress: 'Test address',
        propertyTimezone: 'Europe/Tirane',
        email: `mailbox-${randomUUID()}@example.test`,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    propertyId = signup.body.property.id;
    userId = signup.body.user.id;
    cookie = signup.headers['set-cookie'][0];
    await request(app.getHttpServer())
      .post('/auth/email-verification/confirm')
      .send({ token: accountToken })
      .expect(204);
  });
  afterAll(async () => {
    release?.();
    await app?.close();
    if (redis) {
      const keys = await redis.keys(`bull:${queueName}:*`);
      if (keys.length) await redis.del(...keys);
      redis.disconnect();
    }
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id=${userId}::uuid`;
    await admin.$disconnect();
    vi.unstubAllGlobals();
    for (const [key, value] of oldEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const url = (p = propertyId) =>
    `/tenants/${tenantId}/properties/${p}/email-configuration/sending`;
  const post = (p: string, path: string, body: object, key: string = randomUUID()) =>
    request(app.getHttpServer())
      .post(url(p) + path)
      .set('Cookie', cookie)
      .set('Idempotency-Key', key)
      .send(body);
  const profile = async (p: string) =>
    (await request(app.getHttpServer()).get(url(p)).set('Cookie', cookie).expect(200)).body;
  const scope = (p: string) => ({ tenantId, propertyId: p });
  const prepare = async () => {
    const p = randomUUID();
    await admin.$executeRaw`INSERT INTO properties(id,tenant_id,name,slug) VALUES(${p}::uuid,${tenantId}::uuid,'Mailbox proof hotel',${randomUUID()})`;
    await request(app.getHttpServer())
      .put(url(p))
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        version: 1,
        mode: 'SMTP',
        reason: 'Configure mailbox test',
        fromAddress: 'hotel@example.test',
        smtpHost: 'smtp.gmail.com',
        smtpPort: 587,
        smtpSecurity: 'STARTTLS',
        fallbackGuest: true,
        credentials: { username: 'test-user', password: 'test-password' },
      })
      .expect(200);
    const checked = await post(p, '/check', {
      version: 2,
      reason: 'Check mocked connection',
    }).expect(201);
    return { p, version: checked.body.version as number };
  };
  const issue = async (p: string, version: number, key: string = randomUUID()) =>
    (
      await post(p, '/verify-from', { version, reason: 'Prove hotel From ownership' }, key).expect(
        201,
      )
    ).body as { id: string; version: number; state: string };
  const waitCode = async (id: string) => {
    for (let i = 0; i < 150; i++) {
      if (codes.has(id)) return codes.get(id)!;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw Error('Mock mailbox delivery did not run.');
  };
  const row = async (p: string, id: string) => {
    const rows = await admin.$queryRaw<
      { state: string; attempts: number; encrypted: string | null; hash: string | null }[]
    >`SELECT state,attempts,encrypted_message AS encrypted,code_hash AS hash
      FROM email_sender_proofs WHERE tenant_id=${tenantId}::uuid AND property_id=${p}::uuid AND id=${id}::uuid`;
    return rows[0]!;
  };

  it('requires a current successful SMTP check and capability/verified-email gates', async () => {
    await post(propertyId, '/verify-from', { version: 1, reason: 'Reject unsaved sender' }).expect(
      400,
    );
    const { p, version } = await prepare();
    await admin.$executeRaw`UPDATE tenant_memberships SET role='STAFF' WHERE tenant_id=${tenantId}::uuid AND user_id=${userId}::uuid`;
    try {
      await post(p, '/verify-from', { version, reason: 'Missing capability' }).expect(403);
      await post(p, '/verify-from/confirm', { version, code: 'not-a-proof' }).expect(403);
      await request(app.getHttpServer())
        .get(url(p) + '/verify-from/' + randomUUID())
        .set('Cookie', cookie)
        .expect(403);
    } finally {
      await admin.$executeRaw`UPDATE tenant_memberships SET role='OWNER' WHERE tenant_id=${tenantId}::uuid AND user_id=${userId}::uuid`;
    }
    await request(app.getHttpServer())
      .post(url(p) + '/verify-from')
      .send({ version, reason: 'No session' })
      .expect(401);
    await admin.$executeRaw`UPDATE users SET email_verified_at=NULL WHERE id=${userId}::uuid`;
    try {
      await post(p, '/verify-from', { version, reason: 'Unverified user' }).expect(403);
    } finally {
      await admin.$executeRaw`UPDATE users SET email_verified_at=now() WHERE id=${userId}::uuid`;
    }
    await request(app.getHttpServer())
      .post(`/tenants/${randomUUID()}/properties/${p}/email-configuration/sending/verify-from`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ version, reason: 'Wrong tenant' })
      .expect(403);
  });

  it('keeps the code out of responses, receipts, audits, Redis and retained previews; confirms once without activation', async () => {
    const { p, version } = await prepare();
    blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const proof = await issue(p, version);
    const code = await waitCode(proof.id);
    try {
      const jobs = await redis.keys(`bull:${queueName}:*`);
      let found = false;
      for (const job of jobs) {
        if ((await redis.type(job)) !== 'hash') continue;
        const raw = await redis.hget(job, 'data');
        if (raw?.includes(proof.id)) {
          found = true;
          expect(raw.includes(code)).toBe(false);
          expect(raw.includes('html')).toBe(false);
        }
      }
      expect(found).toBe(true);
      const saved = await row(p, proof.id);
      expect(saved.encrypted?.includes(code)).toBe(false);
      expect(saved.hash?.includes(code)).toBe(false);
      const receipts = await admin.$queryRaw<
        { response: unknown }[]
      >`SELECT response FROM email_workspace_operations WHERE tenant_id=${tenantId}::uuid AND property_id=${p}::uuid`;
      const audits = await admin.$queryRaw<
        { details: unknown }[]
      >`SELECT details FROM audit_logs WHERE tenant_id=${tenantId}::uuid AND property_id=${p}::uuid`;
      expect(JSON.stringify({ proof, receipts, audits }).includes(code)).toBe(false);
      const key = randomUUID(),
        input = { version: proof.version, code };
      const results = await Promise.all([
        post(p, '/verify-from/confirm', input, key),
        post(p, '/verify-from/confirm', input, key),
      ]);
      expect(results.map((r) => r.status)).toEqual([201, 201]);
      expect(results[0].body).toEqual(results[1].body);
      expect(results[0].body.state).toBe('verified');
      const current = await profile(p);
      expect(current.activeMode).toBe('DEFAULT');
      expect(current.fromVerifiedAt).toBeTruthy();
      const consumed = await row(p, proof.id);
      expect(consumed.encrypted).toBeNull();
      expect(consumed.hash).toBeNull();
      expect(JSON.stringify(results.map((r) => r.body)).includes(code)).toBe(false);
      const events = await admin.$queryRaw<
        { count: number }[]
      >`SELECT count(*)::int AS count FROM audit_logs WHERE tenant_id=${tenantId}::uuid AND property_id=${p}::uuid AND action='email_configuration.from_verification.confirmed'`;
      expect(events[0]!.count).toBe(1);
    } finally {
      release?.();
      blocked = undefined;
      release = undefined;
    }
  });

  it('serializes simultaneous requests and replays one immutable message after a lost response', async () => {
    const { p, version } = await prepare(),
      key = randomUUID(),
      before = sendRendered.mock.calls.length;
    const [a, b] = await Promise.all([issue(p, version, key), issue(p, version, key)]);
    expect(a).toEqual(b);
    await waitCode(a.id);
    const count = await admin.$queryRaw<
      { count: number }[]
    >`SELECT count(*)::int AS count FROM email_sender_proofs WHERE tenant_id=${tenantId}::uuid AND property_id=${p}::uuid`;
    expect(count[0]!.count).toBe(1);
    await post(p, '/verify-from', { version, reason: 'Different approved request' }, key).expect(
      409,
    );
    const results = await Promise.all([
      post(p, '/verify-from', { version: a.version, reason: 'New challenge one' }),
      post(p, '/verify-from', { version: a.version, reason: 'New challenge two' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(sendRendered.mock.calls.length - before).toBeLessThanOrEqual(2);
  });

  it('commits failed guesses, deduplicates the same guess and locks after five distinct guesses', async () => {
    const { p, version } = await prepare(),
      proof = await issue(p, version),
      correct = await waitCode(proof.id);
    const wrong = () => `${proof.id}.${randomBytes(32).toString('base64url')}`;
    const firstWrong = wrong(),
      key = randomUUID(),
      input = { version: proof.version, code: firstWrong };
    for (const retry of [key, key, randomUUID()])
      expect((await post(p, '/verify-from/confirm', input, retry).expect(201)).body.state).toBe(
        'invalid',
      );
    expect((await row(p, proof.id)).attempts).toBe(1);
    for (let i = 1; i < 5; i++)
      await post(p, '/verify-from/confirm', { version: proof.version, code: wrong() }).expect(201);
    const locked = await row(p, proof.id);
    expect(locked.attempts).toBe(5);
    expect(locked.state).toBe('locked');
    expect(locked.encrypted).toBeNull();
    expect(
      (await post(p, '/verify-from/confirm', { version: proof.version, code: correct }).expect(201))
        .body.state,
    ).toBe('locked');
    expect((await profile(p)).fromVerifiedAt).toBeNull();
  });

  it('rejects another property under both HTTP and actual forced RLS', async () => {
    const { p, version } = await prepare(),
      proof = await issue(p, version),
      code = await waitCode(proof.id),
      other = await prepare();
    await request(app.getHttpServer())
      .get(url(other.p) + '/verify-from/' + proof.id)
      .set('Cookie', cookie)
      .expect(404);
    await post(other.p, '/verify-from/confirm', { version: other.version, code }).expect(404);
    const db = app.get(TenantDatabaseService);
    const rows = await db.withTenantTransaction(
      scope(other.p),
      (tx) =>
        tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM email_sender_proofs WHERE tenant_id=${tenantId}::uuid AND property_id=${p}::uuid`,
    );
    expect(rows).toHaveLength(0);
    const flags = await admin.$queryRaw<
      { relrowsecurity: boolean; relforcerowsecurity: boolean }[]
    >`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='email_sender_proofs'`;
    expect(flags[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it('invalidates expired and rotated proofs while cosmetic sender changes retain the binding', async () => {
    const { p, version } = await prepare(),
      proof = await issue(p, version),
      code = await waitCode(proof.id);
    await admin.$executeRaw`UPDATE email_sending_profiles SET from_name='New display name',version=version+1 WHERE tenant_id=${tenantId}::uuid AND property_id=${p}::uuid`;
    expect(
      (await post(p, '/verify-from/confirm', { version: proof.version + 1, code }).expect(201)).body
        .state,
    ).toBe('verified');
    const next = await issue(p, (await profile(p)).version),
      nextCode = await waitCode(next.id);
    await admin.$executeRaw`UPDATE email_sending_profiles SET credential_revision=${randomUUID()}::uuid,from_verified_at=NULL,version=version+1 WHERE tenant_id=${tenantId}::uuid AND property_id=${p}::uuid`;
    expect(
      (
        await post(p, '/verify-from/confirm', { version: next.version + 1, code: nextCode }).expect(
          201,
        )
      ).body.state,
    ).toBe('superseded');
    expect((await row(p, next.id)).encrypted).toBeNull();
    const fresh = await prepare(),
      exp = await issue(fresh.p, fresh.version),
      expCode = await waitCode(exp.id);
    await admin.$executeRaw`UPDATE email_sender_proofs SET created_at=now()-interval '31 minutes',expires_at=now()-interval '1 millisecond'
      WHERE tenant_id=${tenantId}::uuid AND property_id=${fresh.p}::uuid AND id=${exp.id}::uuid`;
    expect(
      (
        await post(fresh.p, '/verify-from/confirm', { version: exp.version, code: expCode }).expect(
          201,
        )
      ).body.state,
    ).toBe('expired');
    expect((await row(fresh.p, exp.id)).encrypted).toBeNull();
  });

  it('enforces the rolling-hour cap and releases its exact date edge', async () => {
    const { p, version } = await prepare();
    let current = version;
    for (let i = 0; i < 3; i++) current = (await issue(p, current)).version;
    await post(p, '/verify-from', { version: current, reason: 'Fourth request' }).expect(429);
    await admin.$executeRaw`UPDATE email_sender_proofs SET created_at=now()-interval '1 hour' WHERE tenant_id=${tenantId}::uuid AND property_id=${p}::uuid`;
    expect((await issue(p, current)).state).toBe('pending');
  });

  it('rolls back challenge and verification if the same-transaction audit fails', async () => {
    const { p, version } = await prepare(),
      audit = app.get(AuditLogService),
      original = audit.recordInTransaction.bind(audit);
    const spy = vi.spyOn(audit, 'recordInTransaction').mockImplementation(async (tx, entry) => {
      if (entry.action === 'email_configuration.from_verification.requested')
        throw Error('Simulated audit failure');
      return original(tx, entry);
    });
    try {
      await post(p, '/verify-from', { version, reason: 'Atomic challenge' }).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect((await profile(p)).version).toBe(version);
    const proof = await issue(p, version),
      code = await waitCode(proof.id);
    const confirmSpy = vi
      .spyOn(audit, 'recordInTransaction')
      .mockImplementation(async (tx, entry) => {
        if (entry.action === 'email_configuration.from_verification.confirmed')
          throw Error('Simulated audit failure');
        return original(tx, entry);
      });
    try {
      await post(p, '/verify-from/confirm', { version: proof.version, code }).expect(500);
    } finally {
      confirmSpy.mockRestore();
    }
    expect((await profile(p)).fromVerifiedAt).toBeNull();
    expect((await row(p, proof.id)).state).toBe('pending');
    expect(
      (await post(p, '/verify-from/confirm', { version: proof.version, code }).expect(201)).body
        .state,
    ).toBe('verified');
  });

  it('recovers committed publication without regenerating the payload and fails closed on default account changes', async () => {
    const { p, version } = await prepare(),
      delivery = app.get(MailDeliveryService);
    const dispatch = vi.spyOn(delivery, 'dispatch').mockResolvedValueOnce(undefined);
    let proof: { id: string; version: number };
    try {
      proof = await issue(p, version);
    } finally {
      dispatch.mockRestore();
    }
    expect(codes.has(proof!.id)).toBe(false);
    const before = await row(p, proof!.id);
    await app.get(EmailSenderVerificationService).recover(scope(p));
    await waitCode(proof!.id);
    expect((await row(p, proof!.id)).encrypted === before.encrypted).toBe(true);
    process.env.RESEND_API_KEY = 're_mock_replaced_account';
    try {
      await expect(app.get(SenderVerificationStore).command(scope(p), proof!.id)).rejects.toThrow(
        'Default sender changed.',
      );
    } finally {
      process.env.RESEND_API_KEY = 're_mock_mailbox_proof';
    }
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});
