import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { MailDeliveryService } from '../src/mail/mail-delivery.service';
import { EmailTransportCredentialService } from '../src/mail/email-transport-credentials';
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
describe('hotel sender profile storage, not sender activation', () => {
  let app: INestApplication,
    tenantId = '',
    propertyId = '',
    otherProperty = '',
    rlsProperty = '',
    userId = '',
    cookie = '',
    token = '';
  let originalKey: string | undefined;
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
    async sendRenderedEmail() {},
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
        .useFactory(isolatedMailDelivery),
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
    for (const id of [otherProperty, rlsProperty])
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
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });
});
