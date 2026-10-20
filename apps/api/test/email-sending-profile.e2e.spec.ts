import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { MailDeliveryService } from '../src/mail/mail-delivery.service';
import { EmailTransportCredentialService } from '../src/mail/email-transport-credentials';
import { SmtpTransport } from '../src/mail/smtp-transport';
import { ResendMailProvider } from '../src/mail/resend-mail.provider';
import { AuditLogService } from '../src/tenancy/audit-log.service';
import { TenantDatabaseService } from '../src/tenancy/tenant-database.service';
import { isolatedMailDelivery } from './helpers/isolated-mail-delivery';
import { withoutExternalWorkers } from './helpers/without-external-workers';
import { cleanupTenant } from './helpers/cleanup-tenant';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';

const admin = new PrismaClient({
  datasources: {
    db: { url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking' },
  },
});
describe('hotel sender profiles, diagnostics and explicit activation', () => {
  let app: INestApplication,
    tenantId = '',
    propertyId = '',
    otherProperty = '',
    rlsProperty = '',
    checkProperty = '',
    capProperty = '',
    userId = '',
    cookie = '',
    token = '';
  let originalKey: string | undefined;
  const smtpCheck = vi.fn<(settings: object) => Promise<void>>(async () => {});
  const smtpSend = vi.fn<
    (
      settings: object,
      message: { to: string[] },
    ) => Promise<{
      provider: 'smtp';
      providerMessageId: string;
      accepted: string[];
      rejected: string[];
    }>
  >();
  const mail: MailProvider = {
    async sendVerificationEmail(command) {
      token = new URL(command.verificationUrl).searchParams.get('token')!;
    },
    async sendWelcomeEmail() {},
    async sendPasswordResetEmail() {},
    async sendStaffInvitationEmail() {},
    async sendPaymentConfirmationEmail() {},
    async sendNewBookingStaffNotification() {},
    async sendRefundConfirmationEmail() {},
    async sendBookingCancelledEmail() {},
    async sendBookingCancelledStaffNotification() {},
    async sendRenderedEmail(command) {
      if (command.eventType === 'sender.test')
        return app.get(ResendMailProvider).sendRenderedEmail(command);
    },
  };
  beforeAll(async () => {
    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL =
      'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.WEB_APP_URL = 'http://localhost:3001';
    originalKey = process.env.INTEGRATION_CREDENTIALS_KEY;
    process.env.INTEGRATION_CREDENTIALS_KEY = Buffer.alloc(32, 23).toString('base64');
    await clearSignupRateLimits();
    const { AppModule } = await import('../src/app.module');
    const module = await withoutExternalWorkers(
      Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(MAIL_PROVIDER)
        .useValue(mail)
        .overrideProvider(MailDeliveryService)
        .useFactory(isolatedMailDelivery)
        .overrideProvider(SmtpTransport)
        .useValue({ check: smtpCheck, send: smtpSend }),
    ).compile();
    app = module.createNestApplication();
    await app.init();
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Sender profile fixture',
        propertyName: 'Sender hotel',
        propertyAddress: 'Test address',
        propertyTimezone: 'Europe/Tirane',
        email: `sender-profile-${randomUUID()}@example.test`,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    propertyId = signup.body.property.id;
    userId = signup.body.user.id;
    cookie = signup.headers['set-cookie'][0];
    await request(app.getHttpServer())
      .post('/auth/email-verification/confirm')
      .send({ token })
      .expect(204);
    otherProperty = randomUUID();
    rlsProperty = randomUUID();
    checkProperty = randomUUID();
    capProperty = randomUUID();
    for (const id of [otherProperty, rlsProperty, checkProperty, capProperty])
      await admin.$executeRaw`INSERT INTO properties(id,tenant_id,name,slug) VALUES(${id}::uuid,${tenantId}::uuid,'Other scoped hotel',${randomUUID()})`;
  });
  afterAll(async () => {
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id=${userId}::uuid`;
    await app?.close();
    await admin.$disconnect();
    if (originalKey === undefined) delete process.env.INTEGRATION_CREDENTIALS_KEY;
    else process.env.INTEGRATION_CREDENTIALS_KEY = originalKey;
  });
  const url = (property = propertyId) =>
    `/tenants/${tenantId}/properties/${property}/email-configuration/sending`;
  const get = (property = propertyId) =>
    request(app.getHttpServer()).get(url(property)).set('Cookie', cookie);
  const put = (body: object, key = randomUUID(), property = propertyId) =>
    request(app.getHttpServer())
      .put(url(property))
      .set('Cookie', cookie)
      .set('Idempotency-Key', key)
      .send(body);
  const smtp = (version: number) => ({
    version,
    reason: 'Configure tested hotel sender',
    mode: 'SMTP',
    fromName: 'The hotel',
    fromAddress: 'hotel@example.test',
    smtpHost: 'smtp.gmail.com',
    smtpPort: 587,
    smtpSecurity: 'STARTTLS',
    fallbackGuest: true,
    credentials: { username: 'test-only-user', password: 'test-only-password' },
  });
  const check = (body: object, key: string = randomUUID(), property = checkProperty) =>
    request(app.getHttpServer())
      .post(url(property) + '/check')
      .set('Cookie', cookie)
      .set('Idempotency-Key', key)
      .send(body);
  const operation = (id: string, property = checkProperty) =>
    request(app.getHttpServer())
      .get(url(property) + '/operations/' + id)
      .set('Cookie', cookie);
  const prepareCheck = async (property = checkProperty) => {
    smtpCheck.mockReset().mockResolvedValue(undefined);
    const current = (await get(property).expect(200)).body;
    return (await put(smtp(current.version), randomUUID(), property).expect(200)).body;
  };
  it('returns truthful defaults and never authorizes ordinary reads/writes without current scope and capabilities', async () => {
    expect((await get().expect(200)).body).toMatchObject({
      version: 1,
      mode: 'DEFAULT',
      activeMode: 'DEFAULT',
      credentialsPresent: false,
      fallbackGuest: true,
      domainStatus: 'unknown',
      dnsRecords: [],
    });
    await request(app.getHttpServer()).get(url()).expect(401);
    await request(app.getHttpServer())
      .get(`/tenants/${randomUUID()}/properties/${propertyId}/email-configuration/sending`)
      .set('Cookie', cookie)
      .expect(403);
    await get(randomUUID()).expect(403); // Existing tenant scope guard conceals unknown properties.
    await admin.$executeRaw`UPDATE tenant_memberships SET role='STAFF' WHERE tenant_id=${tenantId}::uuid AND user_id=${userId}::uuid`;
    try {
      await get().expect(403);
      await put(smtp(1)).expect(403);
    } finally {
      await admin.$executeRaw`UPDATE tenant_memberships SET role='OWNER' WHERE tenant_id=${tenantId}::uuid AND user_id=${userId}::uuid`;
    }
    await admin.$executeRaw`UPDATE users SET email_verified_at=NULL WHERE id=${userId}::uuid`;
    try {
      await get().expect(200);
      await put(smtp(1)).expect(403);
    } finally {
      await admin.$executeRaw`UPDATE users SET email_verified_at=now() WHERE id=${userId}::uuid`;
    }
  });
  it('commits one encrypted pending configuration, audit and replay receipt under real concurrent identical requests', async () => {
    const body = smtp(1),
      key = randomUUID(),
      responses = await Promise.all([put(body, key), put(body, key)]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(responses[0].body).toEqual(responses[1].body);
    const reordered = Object.fromEntries(Object.entries(body).reverse());
    expect(
      (
        await put(
          {
            ...reordered,
            credentials: {
              password: body.credentials.password,
              username: body.credentials.username,
            },
          },
          key,
        ).expect(200)
      ).body,
    ).toEqual(responses[0].body);
    expect(responses[0].body).toMatchObject({
      version: 2,
      mode: 'SMTP',
      activeMode: 'DEFAULT',
      credentialsPresent: true,
      fromVerifiedAt: null,
      connectionCheckedAt: null,
    });
    const rows = await admin.$queryRaw<
      { encrypted: string; revision: string }[]
    >`SELECT encrypted_credentials AS encrypted,credential_revision::text AS revision FROM email_sending_profiles WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid`;
    expect(rows).toHaveLength(1);
    expect(rows[0].encrypted).not.toContain(body.credentials.password);
    const endpoint = JSON.stringify({
      mode: 'SMTP',
      fromAddress: body.fromAddress,
      domain: null,
      smtpHost: body.smtpHost,
      smtpPort: body.smtpPort,
      smtpSecurity: body.smtpSecurity,
    });
    expect(
      app
        .get(EmailTransportCredentialService)
        .open(
          { tenantId, propertyId },
          { revision: rows[0].revision, endpoint },
          rows[0].encrypted,
        ),
    ).toEqual({ provider: 'smtp', ...body.credentials });
    const audits = await admin.$queryRaw<
      { details: unknown }[]
    >`SELECT details FROM audit_logs WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND action='email_configuration.sending'`;
    const receipts = await admin.$queryRaw<
      { response: unknown }[]
    >`SELECT response FROM email_workspace_operations WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND idempotency_key=${key}`;
    expect(audits).toHaveLength(1);
    expect(receipts).toHaveLength(1);
    for (const value of [responses[0].body, (await get().expect(200)).body, audits, receipts]) {
      const serialized = JSON.stringify(value);
      expect(serialized).not.toContain(body.credentials.password);
      expect(serialized).not.toContain(body.credentials.username);
      expect(serialized).not.toContain(rows[0].encrypted);
      expect(serialized).not.toContain(rows[0].revision);
    }
    await put(
      { ...body, credentials: { ...body.credentials, password: 'different-secret' } },
      key,
    ).expect(409);
    await admin.$executeRaw`UPDATE users SET email_verified_at=NULL WHERE id=${userId}::uuid`;
    try {
      await put(body, key).expect(403);
    } finally {
      await admin.$executeRaw`UPDATE users SET email_verified_at=now() WHERE id=${userId}::uuid`;
    }
    expect((await get(otherProperty).expect(200)).body).toMatchObject({
      version: 1,
      mode: 'DEFAULT',
      credentialsPresent: false,
    });
  });
  it('serializes different concurrent intents and rejects stale versions without changing any other hotel', async () => {
    const { credentials: ignored, ...body } = smtp(2);
    void ignored;
    const responses = await Promise.all([
      put({ ...body, fallbackGuest: false }),
      put({ ...body, fromName: 'Renamed hotel' }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await get().expect(200)).body.version).toBe(3);
    await put(body).expect(409);
    expect((await get(otherProperty).expect(200)).body.version).toBe(1);
  });
  it('rolls back data/version/receipt when audit persistence fails', async () => {
    const key = randomUUID(),
      before = (await get().expect(200)).body,
      spy = vi
        .spyOn(app.get(AuditLogService), 'recordInTransaction')
        .mockRejectedValueOnce(new Error('Controlled audit failure'));
    try {
      await put({ ...smtp(before.version), reason: 'Controlled rollback fixture' }, key).expect(
        500,
      );
    } finally {
      spy.mockRestore();
    }
    expect((await get().expect(200)).body).toEqual(before);
    const receipt = await admin.$queryRaw<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM email_workspace_operations WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND idempotency_key=${key}`;
    expect(receipt[0].n).toBe(0);
  });
  it('requires replacement credentials when redirecting an endpoint, and clears verification on rotation', async () => {
    const { credentials: ignored, ...body } = smtp(3);
    void ignored;
    await put({ ...body, smtpHost: 'smtp.otherhost.com' }).expect(400);
    await admin.$executeRaw`UPDATE email_sending_profiles SET active_mode='SMTP',from_verified_at=now(),connection_checked_at=now() WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid`;
    const saved = (
      await put({
        ...smtp(3),
        credentials: { username: 'replacement-user', password: 'replacement-password' },
      }).expect(200)
    ).body;
    expect(saved).toMatchObject({
      version: 4,
      activeMode: 'DEFAULT',
      fromVerifiedAt: null,
      connectionCheckedAt: null,
    });
  });
  it('enforces forced property and tenant RLS, including writes attempted through the wrong transaction scope', async () => {
    const db = app.get(TenantDatabaseService);
    for (const scope of [
      { tenantId, propertyId: otherProperty },
      { tenantId: randomUUID(), propertyId },
    ]) {
      await db.withTenantTransaction(scope, async (tx) => {
        const rows =
          await tx.$queryRaw`SELECT * FROM email_sending_profiles WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid`;
        expect(rows).toEqual([]);
        expect(
          await tx.$executeRaw`UPDATE email_sending_profiles SET fallback_guest=false WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid`,
        ).toBe(0);
      });
      await expect(
        db.withTenantTransaction(
          scope,
          (tx) =>
            tx.$executeRaw`INSERT INTO email_sending_profiles(tenant_id,property_id) VALUES(${tenantId}::uuid,${rlsProperty}::uuid)`,
        ),
      ).rejects.toThrow();
    }
    const protection = await admin.$queryRaw<
      { forced: boolean }[]
    >`SELECT relforcerowsecurity AS forced FROM pg_class WHERE relname='email_sending_profiles'`;
    expect(protection[0].forced).toBe(true);
  });
  it('validates all configuration paths without making DNS, SMTP or provider requests', async () => {
    for (const patch of [
      { mode: 'UNKNOWN' },
      { mode: { toString: 'SMTP' } },
      { version: 0 },
      { reason: 'x' },
      { fallbackGuest: 'yes' },
      { smtpHost: '127.0.0.1' },
      { smtpHost: 'metadata.internal' },
      { smtpPort: 25 },
      { smtpSecurity: 'TLS' },
      { fromAddress: 'bad\r\nBcc: victim@example.test' },
      { fromName: 'bad\nname' },
      { credentials: { username: 'missing-password' } },
      { credentials: { username: 'x', password: 'y', tenantId: 'injection' } },
      { unexpected: true },
      { activeMode: 'SMTP' },
      { domainStatus: 'verified' },
      { fromVerifiedAt: new Date().toISOString() },
      { connectionStatus: 'verified' },
      { connectionOperationId: randomUUID() },
      { connectionExpiresAt: new Date().toISOString() },
    ])
      await put({ ...smtp(4), ...patch }).expect(400);
    await request(app.getHttpServer()).put(url()).set('Cookie', cookie).send(smtp(4)).expect(400);
    await put({
      version: 4,
      reason: 'Wrong sender domain',
      mode: 'RESEND',
      fromAddress: 'hotel@different.test',
      domain: 'example.test',
      fallbackGuest: true,
      credentials: { apiKey: 're_test' },
    }).expect(400);
    // A real public domain syntax with mocked credentials can be prepared, never asserted verified.
    const resend = {
      version: 4,
      reason: 'Prepare domain before verification',
      mode: 'RESEND',
      fromAddress: 'hotel@example.com',
      domain: 'example.com',
      fallbackGuest: true,
      credentials: { apiKey: 're_test_only' },
    };
    const saved = (await put(resend).expect(200)).body;
    expect(saved).toMatchObject({
      mode: 'RESEND',
      activeMode: 'DEFAULT',
      version: 5,
      domainStatus: 'unknown',
      dnsRecords: [],
    });
    expect(JSON.stringify(saved)).not.toContain('re_test_only');
    const reset = (
      await put({
        version: 5,
        reason: 'Use MUST sender again',
        mode: 'DEFAULT',
        fallbackGuest: true,
      }).expect(200)
    ).body;
    expect(reset).toMatchObject({
      version: 6,
      mode: 'DEFAULT',
      activeMode: 'DEFAULT',
      credentialsPresent: false,
      fromAddress: null,
    });
  });
  it('stores local email setup for a Clock-connected hotel without invoking the provider', async () => {
    const connection = randomUUID();
    await admin.$executeRaw`INSERT INTO integration_connections(id,tenant_id,kind,provider,name,encrypted_credentials,status) VALUES(${connection}::uuid,${tenantId}::uuid,'PMS','CLOCK_PMS','Sender profile Clock fixture','not-real-credentials','FAILED')`;
    await admin.$executeRaw`INSERT INTO property_integration_connections(id,tenant_id,property_id,connection_id,kind,enabled) VALUES(${randomUUID()}::uuid,${tenantId}::uuid,${otherProperty}::uuid,${connection}::uuid,'PMS',true)`;
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('External calls forbidden in sender profile test'));
    try {
      expect((await get(otherProperty).expect(200)).body.mode).toBe('DEFAULT');
      const saved = (await put(smtp(1), randomUUID(), otherProperty).expect(200)).body;
      expect(saved).toMatchObject({
        mode: 'SMTP',
        activeMode: 'DEFAULT',
        version: 2,
        credentialsPresent: true,
      });
      const checked = await check(
        { version: saved.version, reason: 'Check Clock hotel email connection' },
        randomUUID(),
        otherProperty,
      ).expect(201);
      expect(checked.body.state).toBe('verified');
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });
  it('reserves one real connection operation under equal-key concurrency and safely replays its final result', async () => {
    const profile = await prepareCheck(),
      key = randomUUID(),
      body = { version: profile.version, reason: 'Check the configured connection' };
    let release!: () => void, started!: () => void;
    const running = new Promise<void>((r) => {
        release = r;
      }),
      began = new Promise<void>((r) => {
        started = r;
      });
    smtpCheck.mockImplementationOnce(async () => {
      started();
      await running;
    });
    const first = check(body, key).then((r) => r);
    await began;
    try {
      const pending = (await check(body, key).expect(201)).body;
      expect(pending).toMatchObject({ state: 'checking', version: profile.version + 1 });
      expect((await operation(pending.id).expect(200)).body).toEqual(pending);
      await check(body).expect(409);
      await check({ ...body, version: pending.version }).expect(409);
      expect(smtpCheck).toHaveBeenCalledTimes(1);
    } finally {
      release();
    }
    const finished = await first;
    expect(finished.status).toBe(201);
    expect(finished.body).toMatchObject({ state: 'verified', version: profile.version + 2 });
    expect((await check(body, key).expect(201)).body).toEqual(finished.body);
    expect((await get(checkProperty).expect(200)).body).toMatchObject({
      connectionStatus: 'verified',
      activeMode: 'DEFAULT',
      fromVerifiedAt: null,
    });
    expect(smtpSend).not.toHaveBeenCalled();
    await admin.$executeRaw`UPDATE users SET email_verified_at=NULL WHERE id=${userId}::uuid`;
    try {
      await check(body, key).expect(403);
    } finally {
      await admin.$executeRaw`UPDATE users SET email_verified_at=now() WHERE id=${userId}::uuid`;
    }
    expect(smtpCheck).toHaveBeenCalledTimes(1);
  });
  it('records failed checks without secrets, validates requests, and scopes operation reads and writes', async () => {
    const profile = await prepareCheck();
    smtpCheck.mockRejectedValueOnce(new Error('test-only-password raw auth response'));
    const result = (
      await check({ version: profile.version, reason: 'Check failure diagnostics' }).expect(201)
    ).body;
    expect(result.state).toBe('failed');
    const stored = await admin.$queryRaw<
      { response: unknown }[]
    >`SELECT response FROM email_workspace_operations WHERE tenant_id=${tenantId}::uuid AND property_id=${checkProperty}::uuid AND response->>'id'=${result.id}`;
    expect(JSON.stringify(stored)).not.toMatch(
      /test-only-password|raw auth response|encryptedCredentials|credentialRevision/,
    );
    expect((await get(checkProperty).expect(200)).body).toMatchObject({
      connectionStatus: 'failed',
      connectionCheckedAt: null,
      activeMode: 'DEFAULT',
    });
    await operation(result.id, otherProperty).expect(404);
    await operation(randomUUID()).expect(404);
    await operation('invalid-id').expect(400);
    await request(app.getHttpServer())
      .get(url(checkProperty) + '/operations/' + result.id)
      .expect(401);
    await request(app.getHttpServer())
      .post(url(checkProperty) + '/check')
      .send({ version: result.version, reason: 'No session' })
      .expect(401);
    await check({ version: result.version, reason: 'no', password: 'forbidden' }).expect(400);
    await request(app.getHttpServer())
      .post(url(checkProperty) + '/check')
      .set('Cookie', cookie)
      .send({ version: result.version, reason: 'Missing key' })
      .expect(400);
    await check({ version: 6, reason: 'Not an SMTP setup' }, randomUUID(), propertyId).expect(400);
    await admin.$executeRaw`UPDATE tenant_memberships SET role='STAFF' WHERE tenant_id=${tenantId}::uuid AND user_id=${userId}::uuid`;
    try {
      await operation(result.id).expect(403);
      await check({ version: result.version, reason: 'No permission' }).expect(403);
    } finally {
      await admin.$executeRaw`UPDATE tenant_memberships SET role='OWNER' WHERE tenant_id=${tenantId}::uuid AND user_id=${userId}::uuid`;
    }
    expect(smtpCheck).toHaveBeenCalledTimes(1);
  });
  it('rolls back reservation and its receipt when audit fails, before any socket is opened', async () => {
    const profile = await prepareCheck(),
      key = randomUUID(),
      audit = vi
        .spyOn(app.get(AuditLogService), 'recordInTransaction')
        .mockRejectedValueOnce(new Error('simulated audit failure'));
    try {
      await check({ version: profile.version, reason: 'Audit rollback check' }, key).expect(500);
    } finally {
      audit.mockRestore();
    }
    expect(smtpCheck).not.toHaveBeenCalled();
    expect((await get(checkProperty).expect(200)).body.version).toBe(profile.version);
    const receipts = await admin.$queryRaw<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM email_workspace_operations WHERE tenant_id=${tenantId}::uuid AND property_id=${checkProperty}::uuid AND idempotency_key=${key}`;
    expect(receipts[0].n).toBe(0);
  });
  it('fences late check results after credential rotation and preserves unrelated edits', async () => {
    for (const rotate of [true, false]) {
      const profile = await prepareCheck();
      let release!: () => void, started!: () => void;
      const running = new Promise<void>((r) => {
          release = r;
        }),
        began = new Promise<void>((r) => {
          started = r;
        });
      smtpCheck.mockImplementationOnce(async () => {
        started();
        await running;
      });
      const first = check({ version: profile.version, reason: 'Check while editing sender' }).then(
        (r) => r,
      );
      await began;
      try {
        const { credentials: ignored, ...cosmetic } = smtp(profile.version + 1);
        void ignored;
        await put(
          rotate
            ? {
                ...smtp(profile.version + 1),
                credentials: { username: 'rotated-user', password: 'rotated-password' },
              }
            : { ...cosmetic, fromName: 'Updated hotel name' },
          randomUUID(),
          checkProperty,
        ).expect(200);
      } finally {
        release();
      }
      const result = await first;
      expect(result.status).toBe(201);
      expect(result.body.state).toBe(rotate ? 'stale' : 'verified');
      const final = (await get(checkProperty).expect(200)).body;
      expect(final).toMatchObject(
        rotate
          ? { connectionStatus: 'unknown', connectionCheckedAt: null }
          : { connectionStatus: 'verified', fromName: 'Updated hotel name' },
      );
      expect(final.activeMode).toBe('DEFAULT');
    }
  });
  it('leaves a durable pending operation after final audit failure; expiry projects unknown without resending', async () => {
    const profile = await prepareCheck(),
      key = randomUUID(),
      body = { version: profile.version, reason: 'Check finalization rollback' };
    const audit = app.get(AuditLogService),
      original = audit.recordInTransaction.bind(audit);
    const spy = vi
      .spyOn(audit, 'recordInTransaction')
      .mockImplementation((tx, event) =>
        event.action.endsWith('smtp_check.completed')
          ? Promise.reject(new Error('simulated final audit failure'))
          : original(tx, event),
      );
    try {
      await check(body, key).expect(500);
    } finally {
      spy.mockRestore();
    }
    const pending = (await check(body, key).expect(201)).body;
    expect(pending.state).toBe('checking');
    expect((await get(checkProperty).expect(200)).body).toMatchObject({
      connectionStatus: 'checking',
      connectionCheckedAt: null,
      version: profile.version + 1,
    });
    const expired = new Date(Date.now() - 1000).toISOString();
    await admin.$executeRaw`UPDATE email_workspace_operations SET response=jsonb_set(response,'{expiresAt}',${JSON.stringify(expired)}::jsonb) WHERE tenant_id=${tenantId}::uuid AND property_id=${checkProperty}::uuid AND idempotency_key=${key}`;
    await admin.$executeRaw`UPDATE email_sending_profiles SET connection_expires_at=${new Date(expired)} WHERE tenant_id=${tenantId}::uuid AND property_id=${checkProperty}::uuid`;
    expect((await operation(pending.id).expect(200)).body.state).toBe('unknown');
    expect((await check(body, key).expect(201)).body.state).toBe('unknown');
    expect((await get(checkProperty).expect(200)).body.connectionStatus).toBe('unknown');
    expect(smtpCheck).toHaveBeenCalledTimes(1);
    expect(
      (
        await check({ version: profile.version + 1, reason: 'Explicit check after expiry' }).expect(
          201,
        )
      ).body.state,
    ).toBe('verified');
    expect(smtpCheck).toHaveBeenCalledTimes(2);
  });
  it('limits ten actual check intentions per hotel/hour while allowing idempotent retries', async () => {
    let profile = await prepareCheck(capProperty);
    let finalBody: Record<string, unknown> = {},
      finalKey = '';
    for (let index = 0; index < 10; index++) {
      finalBody = { version: profile.version, reason: 'Explicit hourly boundary check' };
      finalKey = randomUUID();
      const response = await check(finalBody, finalKey, capProperty).expect(201);
      expect(response.body.state).toBe('verified');
      profile = (await get(capProperty).expect(200)).body;
    }
    await check(finalBody, finalKey, capProperty).expect(201);
    await check(
      { version: profile.version, reason: 'Over hourly cap' },
      randomUUID(),
      capProperty,
    ).expect(429);
    expect(smtpCheck).toHaveBeenCalledTimes(10);
    await admin.$executeRaw`UPDATE email_workspace_operations SET created_at=now()-interval '1 hour 1 second'
      WHERE tenant_id=${tenantId}::uuid AND property_id=${capProperty}::uuid AND idempotency_key=(SELECT idempotency_key FROM email_workspace_operations
      WHERE tenant_id=${tenantId}::uuid AND property_id=${capProperty}::uuid AND response->>'kind'='SMTP_CONNECTION_CHECK' ORDER BY created_at,idempotency_key LIMIT 1)`;
    expect(
      (
        await check(
          { version: profile.version, reason: 'Check after rolling-hour expiry' },
          randomUUID(),
          capProperty,
        ).expect(201)
      ).body.state,
    ).toBe('verified');
    expect(smtpCheck).toHaveBeenCalledTimes(11);
  });
  it('uses the real adapter to refuse private DNS before connecting or sending any mail', async () => {
    const profile = await prepareCheck(),
      resolve = vi.fn(async () => [{ address: '127.0.0.1', family: 4 }]),
      connect = vi.fn();
    const adapter = new SmtpTransport(resolve, connect);
    smtpCheck.mockImplementationOnce(() =>
      adapter.check({
        host: 'smtp.example.com',
        port: 587,
        security: 'STARTTLS',
        username: 'test',
        password: 'test',
      }),
    );
    expect(
      (
        await check({ version: profile.version, reason: 'Verify private DNS rejection' }).expect(
          201,
        )
      ).body.state,
    ).toBe('failed');
    expect(resolve).toHaveBeenCalledOnce();
    expect(connect).not.toHaveBeenCalled();
    expect(smtpSend).not.toHaveBeenCalled();
  });
  it('requires an explicit pause before diagnostics and retains prior successful evidence', async () => {
    const profile = await prepareCheck(rlsProperty),
      lastSuccess = new Date('2026-10-01T10:00:00Z');
    await admin.$executeRaw`UPDATE email_sending_profiles SET active_mode='SMTP',from_verified_at=now(),connection_status='verified',connection_checked_at=${lastSuccess}
      WHERE tenant_id=${tenantId}::uuid AND property_id=${rlsProperty}::uuid`;
    await check(
      { version: profile.version, reason: 'Active diagnostics must not interrupt delivery' },
      randomUUID(),
      rlsProperty,
    ).expect(409);
    expect(smtpCheck).not.toHaveBeenCalled();
    const paused = await request(app.getHttpServer())
      .post(url(rlsProperty) + '/pause')
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ version: profile.version, reason: 'Pause before diagnostics' })
      .expect(201);
    smtpCheck.mockRejectedValueOnce(new Error('diagnostic failure'));
    await check(
      { version: paused.body.version, reason: 'Check explicitly paused sender' },
      randomUUID(),
      rlsProperty,
    ).expect(201);
    const failed = (await get(rlsProperty).expect(200)).body;
    expect(failed).toMatchObject({
      activeMode: 'DEFAULT',
      connectionStatus: 'failed',
      connectionCheckedAt: lastSuccess.toISOString(),
    });
    await check(
      { version: failed.version, reason: 'Check existing sender again' },
      randomUUID(),
      rlsProperty,
    ).expect(201);
    expect((await get(rlsProperty).expect(200)).body).toMatchObject({
      activeMode: 'DEFAULT',
      connectionStatus: 'verified',
    });
    expect(smtpSend).not.toHaveBeenCalled();
  });
  it('activates only verified saved setup, serializes races and replays the original receipt', async () => {
    const profile = await prepareCheck(checkProperty);
    const body = { version: profile.version, reason: 'Activate verified custom sender' };
    const activate = (value: object, key = randomUUID()) =>
      request(app.getHttpServer())
        .post(url(checkProperty) + '/activate')
        .set('Cookie', cookie)
        .set('Idempotency-Key', key)
        .send(value);
    await activate(body).expect(400);
    await admin.$executeRaw`UPDATE email_sending_profiles SET connection_status='verified',connection_checked_at=now() WHERE tenant_id=${tenantId}::uuid AND property_id=${checkProperty}::uuid`;
    await activate(body).expect(400);
    await admin.$executeRaw`UPDATE email_sending_profiles SET from_verified_at=now() WHERE tenant_id=${tenantId}::uuid AND property_id=${checkProperty}::uuid`;
    await request(app.getHttpServer())
      .post(url(checkProperty) + '/activate')
      .set('Cookie', cookie)
      .send(body)
      .expect(400);
    const keys = [randomUUID(), randomUUID()];
    const results = await Promise.all(keys.map((key) => activate(body, key)));
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    const winner = results.findIndex((result) => result.status === 201);
    expect(results[winner]!.body).toMatchObject({
      activeMode: 'SMTP',
      version: profile.version + 1,
    });
    expect((await activate(body, keys[winner]!).expect(201)).body).toEqual(results[winner]!.body);
    await activate({ ...body, reason: 'Changed approval' }, keys[winner]!).expect(409);
    expect((await get(checkProperty).expect(200)).body.activeMode).toBe('SMTP');
    expect(smtpSend).not.toHaveBeenCalled();
    const current = (await get(checkProperty).expect(200)).body;
    await request(app.getHttpServer())
      .post(url(checkProperty) + '/pause')
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ version: current.version, reason: 'Return new deliveries to MUST' })
      .expect(201);
    expect((await get(checkProperty).expect(200)).body.activeMode).toBe('DEFAULT');
  });
  it('rolls activation back on audit failure and refuses an unverified actor', async () => {
    const profile = await prepareCheck(checkProperty);
    await admin.$executeRaw`UPDATE email_sending_profiles SET from_verified_at=now(),connection_status='verified',connection_checked_at=now() WHERE tenant_id=${tenantId}::uuid AND property_id=${checkProperty}::uuid`;
    const activate = () =>
      request(app.getHttpServer())
        .post(url(checkProperty) + '/activate')
        .set('Cookie', cookie)
        .set('Idempotency-Key', randomUUID())
        .send({ version: profile.version, reason: 'Check activation boundary' });
    const spy = vi
      .spyOn(app.get(AuditLogService), 'recordInTransaction')
      .mockRejectedValueOnce(Error('Simulated activation audit failure'));
    try {
      await activate().expect(500);
    } finally {
      spy.mockRestore();
    }
    expect((await get(checkProperty).expect(200)).body).toMatchObject({
      activeMode: 'DEFAULT',
      version: profile.version,
    });
    const [owner] = await admin.$queryRaw<
      { verified: Date }[]
    >`SELECT email_verified_at AS verified FROM users WHERE id=${userId}::uuid`;
    try {
      await admin.$executeRaw`UPDATE users SET email_verified_at=NULL WHERE id=${userId}::uuid`;
      await activate().expect(403);
    } finally {
      await admin.$executeRaw`UPDATE users SET email_verified_at=${owner!.verified} WHERE id=${userId}::uuid`;
    }
    await request(app.getHttpServer())
      .post(url(checkProperty) + '/activate')
      .send({ version: profile.version, reason: 'Unauthenticated request' })
      .expect(401);
  });
  it('sends concurrent self-test retries through pending custom SMTP once, caps new intentions and keeps GET read-only', async () => {
    const profile = await prepareCheck(checkProperty);
    await admin.$executeRaw`UPDATE email_sending_profiles SET from_verified_at=now(),connection_status='verified',connection_checked_at=now() WHERE tenant_id=${tenantId}::uuid AND property_id=${checkProperty}::uuid`;
    smtpSend.mockReset().mockImplementation(async (_settings, message) => ({
      provider: 'smtp',
      providerMessageId: 'smtp-test-' + randomUUID(),
      accepted: message.to,
      rejected: [],
    }));
    const http = app.getHttpServer(),
      body = { version: profile.version, reason: 'Verify actual custom self-test routing' },
      key = randomUUID();
    const send = (requestKey: string, extra: object = {}) =>
      request(http)
        .post(url(checkProperty) + '/test')
        .set('Cookie', cookie)
        .set('Idempotency-Key', requestKey)
        .send({ ...body, ...extra });
    vi.stubEnv('RESEND_API_KEY', 're_fake_custom_test_fallback_forbidden');
    vi.stubEnv('MAIL_FROM_EMAIL', 'MUST <mail@must.example.test>');
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw Error('Live HTTP is forbidden in sender tests.');
    });
    vi.stubGlobal('fetch', fetcher);
    try {
      await send(randomUUID(), { to: 'guest@example.test' }).expect(400);
      const responses = await Promise.all(Array.from({ length: 6 }, () => send(key)));
      expect(responses.every((response) => response.status === 201)).toBe(true);
      const id: string = responses[0]!.body.id;
      expect(responses.every((response) => response.body.id === id)).toBe(true);
      const poll = async (testId: string) => {
        for (let attempt = 0; attempt < 100; attempt++) {
          const response = await request(http)
            .get(url(checkProperty) + '/tests/' + testId)
            .set('Cookie', cookie)
            .expect(200);
          if (response.body.status === 'SENT') return response.body;
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
        throw Error('Custom test did not reach accepted status');
      };
      const accepted = await poll(id);
      expect(accepted).toMatchObject({ mode: 'SMTP', provider: 'smtp', activationChanged: false });
      expect(smtpSend).toHaveBeenCalledTimes(1);
      expect(smtpSend.mock.calls[0]![1].to).toEqual([accepted.recipient]);
      const [owner] = await admin.$queryRaw<
        { email: string }[]
      >`SELECT email FROM users WHERE id=${userId}::uuid`;
      expect(accepted.recipient).toBe(owner!.email);
      expect((await get(checkProperty).expect(200)).body.activeMode).toBe('DEFAULT');
      await request(http)
        .get(url(checkProperty) + '/tests/' + id)
        .set('Cookie', cookie)
        .expect(200);
      expect(smtpSend).toHaveBeenCalledTimes(1);
      for (let count = 0; count < 2; count++) {
        const queued = await send(randomUUID()).expect(201);
        await poll(queued.body.id);
      }
      await send(randomUUID()).expect(429);
      expect(smtpSend).toHaveBeenCalledTimes(3);
      await request(http)
        .get(url(otherProperty) + '/tests/' + id)
        .set('Cookie', cookie)
        .expect(404);
      expect(fetcher).not.toHaveBeenCalled();
      const [before] = await admin.$queryRaw<
        { verified: Date }[]
      >`SELECT email_verified_at AS verified FROM users WHERE id=${userId}::uuid`;
      try {
        await admin.$executeRaw`UPDATE users SET email_verified_at=NULL WHERE id=${userId}::uuid`;
        await send(randomUUID()).expect(403);
      } finally {
        await admin.$executeRaw`UPDATE users SET email_verified_at=${before!.verified} WHERE id=${userId}::uuid`;
      }
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
