import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { MailDeliveryService } from '../src/mail/mail-delivery.service';
import { SmtpTransport } from '../src/mail/smtp-transport';
import { AuditLogService } from '../src/tenancy/audit-log.service';
import { TenantDatabaseService } from '../src/tenancy/tenant-database.service';
import { readDmarcPublication } from '../src/mail/dmarc-publication';
import { isolatedMailDelivery } from './helpers/isolated-mail-delivery';
import { withoutExternalWorkers } from './helpers/without-external-workers';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';
import { cleanupTenant } from './helpers/cleanup-tenant';

vi.mock('../src/mail/dmarc-publication', () => ({ readDmarcPublication: vi.fn() }));
const admin = new PrismaClient({
  datasources: {
    db: { url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking' },
  },
});
const providerId = '2b8402da-ab23-4efa-b175-275436f8e1ab';
const records = [
  {
    record: 'DKIM',
    name: 'resend._domainkey',
    type: 'TXT',
    value: 'p=actual-public-dkim-value',
    status: 'verified',
    ttl: 'Auto',
  },
  {
    record: 'SPF',
    name: 'send.hotel.example.com',
    type: 'MX',
    value: 'feedback-smtp.eu-west-1.amazonses.com',
    status: 'verified',
    ttl: 300,
    priority: 10,
  },
];
describe('scoped manual domain checks, never live provider or DNS calls', () => {
  let app: INestApplication,
    tenantId = '',
    userId = '',
    cookie = '',
    token = '';
  const oldEnv = new Map<string, string | undefined>();
  let exists = true,
    verified = true,
    createMode: 'ok' | 'uncertain' | 'reject' = 'ok',
    release: (() => void) | undefined,
    barrier: Promise<void> | undefined;
  let domain = 'hotel.example.com';
  const calls: { method: string; url: string; key: string }[] = [];
  const dmarc = () => ({
    name: '_dmarc.' + domain,
    type: 'TXT' as const,
    state: 'published' as const,
    values: ['v=DMARC1; p=reject'],
    observedAt: new Date().toISOString(),
    message: 'A DMARC policy is published. Message alignment is not verified.',
  });
  const providerEvidence = () => ({
    id: providerId,
    name: domain,
    status: verified ? 'verified' : 'pending',
    capabilities: { sending: 'enabled', receiving: 'disabled' },
    records,
  });
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== 'https://api.resend.com') throw Error('External provider forbidden.');
    const method = init?.method ?? 'GET';
    calls.push({
      method,
      url: url.pathname,
      key: new Headers(init?.headers).get('authorization') ?? '',
    });
    if (barrier) await barrier;
    if (url.pathname === '/domains' && method === 'GET')
      return Response.json({
        data: exists ? [{ id: providerId, name: domain }] : [],
        has_more: false,
      });
    if (url.pathname === '/domains' && method === 'POST') {
      if (createMode === 'uncertain') throw Error('Simulated lost registration response');
      if (createMode === 'reject')
        return Response.json({ message: 'Provider rejection' }, { status: 422 });
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({
        name: domain,
        region: 'eu-west-1',
        capabilities: { sending: 'enabled', receiving: 'disabled' },
        open_tracking: false,
        click_tracking: false,
      });
      exists = true;
      return Response.json(providerEvidence());
    }
    if (url.pathname === `/domains/${providerId}/verify` && method === 'POST')
      return Response.json({ id: providerId });
    if (url.pathname === `/domains/${providerId}` && method === 'GET')
      return Response.json(providerEvidence());
    throw Error('Unexpected domain operation');
  });
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
    async sendRenderedEmail() {
      throw Error('Domain checks must never send email.');
    },
  };
  beforeAll(async () => {
    for (const key of [
      'INTEGRATION_CREDENTIALS_KEY',
      'RESEND_API_KEY',
      'MAIL_FROM_EMAIL',
      'WEB_APP_URL',
    ])
      oldEnv.set(key, process.env[key]);
    process.env.INTEGRATION_CREDENTIALS_KEY = Buffer.alloc(32, 37).toString('base64');
    process.env.RESEND_API_KEY = 're_mock_platform_domain';
    process.env.MAIL_FROM_EMAIL = 'MUST Booking <booking@must.example.com>';
    process.env.WEB_APP_URL = 'http://localhost:3001';
    process.env.DATABASE_URL =
      'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.APP_PORT = '3000';
    vi.stubGlobal('fetch', fetcher);
    await clearSignupRateLimits();
    const { AppModule } = await import('../src/app.module');
    const module = await withoutExternalWorkers(
      Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(MAIL_PROVIDER)
        .useValue(mail)
        .overrideProvider(MailDeliveryService)
        .useFactory(isolatedMailDelivery)
        .overrideProvider(SmtpTransport)
        .useValue({ check: vi.fn(), send: vi.fn() }),
    ).compile();
    app = module.createNestApplication();
    await app.init();
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Domain fixture',
        propertyName: 'Domain hotel',
        propertyAddress: 'Test address',
        propertyTimezone: 'Europe/Tirane',
        email: `domain-${randomUUID()}@example.test`,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    userId = signup.body.user.id;
    cookie = signup.headers['set-cookie'][0];
    await request(app.getHttpServer())
      .post('/auth/email-verification/confirm')
      .send({ token })
      .expect(204);
  });
  beforeEach(() => {
    exists = true;
    verified = true;
    createMode = 'ok';
    barrier = undefined;
    release = undefined;
    domain = 'hotel.example.com';
    calls.length = 0;
    vi.mocked(readDmarcPublication).mockImplementation(async () => dmarc());
  });
  afterAll(async () => {
    release?.();
    await app?.close();
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id=${userId}::uuid`;
    await admin.$disconnect();
    vi.unstubAllGlobals();
    for (const [key, value] of oldEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const url = (p: string) => `/tenants/${tenantId}/properties/${p}/email-configuration/sending`;
  const get = async (p: string) =>
    (await request(app.getHttpServer()).get(url(p)).set('Cookie', cookie).expect(200)).body;
  const check = (p: string, version: number, allowCreate = false, key: string = randomUUID()) =>
    request(app.getHttpServer())
      .post(url(p) + '/domain/check')
      .set('Cookie', cookie)
      .set('Idempotency-Key', key)
      .send({ version, reason: 'Review mocked domain evidence', allowCreate });
  const operation = (p: string, id: string) =>
    request(app.getHttpServer())
      .get(url(p) + '/domain/operations/' + id)
      .set('Cookie', cookie);
  const put = (p: string, version: number, apiKey = 're_mock_hotel_domain') =>
    request(app.getHttpServer())
      .put(url(p))
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        version,
        reason: 'Save hotel domain',
        mode: 'RESEND',
        fromAddress: 'booking@hotel.example.com',
        domain: 'hotel.example.com',
        fallbackGuest: true,
        credentials: { apiKey },
      });
  const prepare = async (custom = true) => {
    const p = randomUUID();
    await admin.$executeRaw`INSERT INTO properties(id,tenant_id,name,slug) VALUES(${p}::uuid,${tenantId}::uuid,'Domain scope fixture',${randomUUID()})`;
    if (custom) await put(p, 1).expect(200);
    return { p, version: custom ? 2 : 1 };
  };
  const waitForCall = async () => {
    for (let i = 0; i < 200; i++) {
      if (calls.length) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw Error('Provider boundary did not run.');
  };

  it('reads default MUST domain evidence without any create/verify writes or activation', async () => {
    const { p, version } = await prepare(false);
    domain = 'must.example.com';
    verified = false;
    const response = await check(p, version).expect(201);
    expect(response.body.state).toBe('pending');
    expect(response.body.records).toEqual(records);
    expect(
      calls.every((call) => call.method === 'GET' && call.key === 'Bearer re_mock_platform_domain'),
    ).toBe(true);
    const current = await get(p);
    expect(current.activeMode).toBe('DEFAULT');
    expect(current.dmarcEvidence.state).toBe('published');
    await check(p, current.version, true).expect(400);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
  it('uses the encrypted hotel key and exact DNS values, with no credential in responses/audit/receipts', async () => {
    const { p, version } = await prepare(),
      key = randomUUID();
    const first = await check(p, version, false, key).expect(201);
    const again = await check(p, version, false, key).expect(201);
    expect(again.body).toEqual(first.body);
    expect(first.body.state).toBe('verified');
    expect(first.body.records).toEqual(records);
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.key === 'Bearer re_mock_hotel_domain')).toBe(true);
    const current = await get(p);
    expect(current.dnsRecords).toEqual(records);
    expect(current.activeMode).toBe('DEFAULT');
    const health = await request(app.getHttpServer())
      .get(`/tenants/${tenantId}/properties/${p}/email-activity/overview`)
      .set('Cookie', cookie)
      .expect(200);
    expect(health.body.domainAuthentication).toBe('UNKNOWN');
    expect(health.body.domainEvidence).toMatchObject({
      activeMode: 'DEFAULT',
      setupMode: 'RESEND',
      status: 'verified',
      spf: 'Provider verified',
    });
    const audits = await admin.$queryRaw<
      { details: unknown }[]
    >`SELECT details FROM audit_logs WHERE tenant_id=${tenantId}::uuid AND property_id=${p}::uuid`;
    const receipts = await admin.$queryRaw<
      { response: unknown }[]
    >`SELECT response FROM email_workspace_operations WHERE tenant_id=${tenantId}::uuid AND property_id=${p}::uuid`;
    expect(
      JSON.stringify({ first: first.body, current, audits, receipts }).includes(
        're_mock_hotel_domain',
      ),
    ).toBe(false);
  });
  it('never creates on Check, registers only after explicit approval, and rechecks only custom domains', async () => {
    const { p, version } = await prepare();
    exists = false;
    verified = false;
    const missing = await check(p, version).expect(201);
    expect(missing.body.state).toBe('not_found');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    const created = await check(p, missing.body.version, true).expect(201);
    expect(created.body.state).toBe('pending');
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.url)).toEqual([
      '/domains',
      `/domains/${providerId}/verify`,
    ]);
    verified = true;
    const current = await check(p, created.body.version).expect(201);
    expect(current.body.state).toBe('verified');
    expect((await get(p)).activeMode).toBe('DEFAULT');
  });
  it('blocks a second registration after unknown acceptance, even with a replacement key, then reconciles by exact GET', async () => {
    const { p, version } = await prepare();
    exists = false;
    createMode = 'uncertain';
    const uncertain = await check(p, version, true).expect(201);
    expect(uncertain.body.state).toBe('unknown');
    await put(p, uncertain.body.version, 're_mock_replacement').expect(200);
    const next = await check(p, (await get(p)).version, true).expect(201);
    expect(next.body.message).toContain('prior registration');
    expect(calls.filter((c) => c.url === '/domains' && c.method === 'POST')).toHaveLength(1);
    exists = true;
    createMode = 'ok';
    const reconciled = await check(p, next.body.version).expect(201);
    expect(reconciled.body.state).toBe('verified');
  });
  it('allows a new explicit registration after proven non-acceptance', async () => {
    const { p, version } = await prepare();
    exists = false;
    createMode = 'reject';
    const rejected = await check(p, version, true).expect(201);
    expect(rejected.body.state).toBe('failed');
    expect(rejected.body.registrationAttempted).toBe(false);
    createMode = 'ok';
    const retried = await check(p, rejected.body.version, true).expect(201);
    expect(retried.body.state).toBe('verified');
    expect(calls.filter((c) => c.url === '/domains' && c.method === 'POST')).toHaveLength(2);
  });
  it('serializes real concurrent operations, exposing a pending receipt without another provider request', async () => {
    const { p, version } = await prepare(),
      key = randomUUID();
    barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = check(p, version, false, key).then((response) => response);
    await waitForCall();
    try {
      const replay = await check(p, version, false, key).expect(201);
      expect(replay.body.state).toBe('checking');
      await check(p, replay.body.version).expect(409);
      expect(calls).toHaveLength(1);
      expect((await operation(p, replay.body.id).expect(200)).body.state).toBe('checking');
    } finally {
      release?.();
      barrier = undefined;
    }
    expect((await running).body.state).toBe('verified');
  });
  it('fences a stale result when credentials rotate during the provider read', async () => {
    const { p, version } = await prepare();
    barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = check(p, version).then((response) => response);
    await waitForCall();
    try {
      await put(p, (await get(p)).version, 're_mock_rotated').expect(200);
    } finally {
      release?.();
      barrier = undefined;
    }
    const result = await running;
    expect(result.body.state).toBe('stale');
    const current = await get(p);
    expect(current.domainStatus).toBe('unknown');
    expect(current.dnsRecords).toEqual([]);
    expect(current.dmarcEvidence).toBeNull();
  });
  it('enforces scope, actual RLS, capability and verified-email gates', async () => {
    const { p, version } = await prepare(),
      other = await prepare();
    const response = await check(p, version).expect(201);
    await operation(other.p, response.body.id).expect(404);
    const rows = await app
      .get(TenantDatabaseService)
      .withTenantTransaction(
        { tenantId, propertyId: other.p },
        (tx) =>
          tx.$queryRaw<
            { response: unknown }[]
          >`SELECT response FROM email_workspace_operations WHERE tenant_id=${tenantId}::uuid AND property_id=${p}::uuid`,
      );
    expect(rows).toHaveLength(0);
    await admin.$executeRaw`UPDATE tenant_memberships SET role='STAFF' WHERE tenant_id=${tenantId}::uuid AND user_id=${userId}::uuid`;
    try {
      await check(other.p, other.version).expect(403);
      await operation(p, response.body.id).expect(403);
    } finally {
      await admin.$executeRaw`UPDATE tenant_memberships SET role='OWNER' WHERE tenant_id=${tenantId}::uuid AND user_id=${userId}::uuid`;
    }
    await admin.$executeRaw`UPDATE users SET email_verified_at=NULL WHERE id=${userId}::uuid`;
    try {
      await check(other.p, other.version).expect(403);
      await operation(p, response.body.id).expect(200);
    } finally {
      await admin.$executeRaw`UPDATE users SET email_verified_at=now() WHERE id=${userId}::uuid`;
    }
    await request(app.getHttpServer())
      .post(`/tenants/${randomUUID()}/properties/${p}/email-configuration/sending/domain/check`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ version, reason: 'Wrong scope' })
      .expect(403);
  });
  it('commits a registration marker before the call, retaining it when final audit fails', async () => {
    const { p, version } = await prepare(),
      audit = app.get(AuditLogService),
      original = audit.recordInTransaction.bind(audit);
    exists = false;
    const spy = vi.spyOn(audit, 'recordInTransaction').mockImplementation(async (tx, entry) => {
      if (entry.action === 'email_configuration.domain_check.completed')
        throw Error('Simulated final audit failure');
      return original(tx, entry);
    });
    try {
      await check(p, version, true).expect(500);
    } finally {
      spy.mockRestore();
    }
    const receipt = await admin.$queryRaw<
      { id: string; marked: boolean }[]
    >`SELECT response->>'id' AS id,(response->>'registrationAttempted')::boolean AS marked FROM email_workspace_operations
      WHERE tenant_id=${tenantId}::uuid AND property_id=${p}::uuid AND response->>'kind'='DOMAIN_CHECK'`;
    expect(receipt[0]!.marked).toBe(true);
    await admin.$executeRaw`UPDATE email_workspace_operations SET response=jsonb_set(response,'{expiresAt}',to_jsonb((clock_timestamp()-interval '1 second')::text)) WHERE tenant_id=${tenantId}::uuid AND property_id=${p}::uuid AND response->>'kind'='DOMAIN_CHECK'`;
    exists = false;
    const retry = await check(p, (await get(p)).version, true).expect(201);
    expect(retry.body.message).toContain('prior registration');
    expect(calls.filter((c) => c.url === '/domains' && c.method === 'POST')).toHaveLength(1);
  });
  it('rolls back a failed request audit before any provider call and bounds manual checks per rolling hour', async () => {
    const { p, version } = await prepare(),
      audit = app.get(AuditLogService),
      original = audit.recordInTransaction.bind(audit);
    const spy = vi.spyOn(audit, 'recordInTransaction').mockImplementation(async (tx, entry) => {
      if (entry.action === 'email_configuration.domain_check.requested')
        throw Error('Simulated request audit failure');
      return original(tx, entry);
    });
    try {
      await check(p, version).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(calls).toHaveLength(0);
    expect((await get(p)).version).toBe(version);
    for (let i = 0; i < 10; i++)
      await admin.$executeRaw`INSERT INTO email_workspace_operations(tenant_id,property_id,idempotency_key,request_hash,response) VALUES(${tenantId}::uuid,${p}::uuid,${randomUUID()},'fixture',${JSON.stringify({ kind: 'DOMAIN_CHECK', state: 'failed' })}::jsonb)`;
    await check(p, version).expect(429);
    expect(calls).toHaveLength(0);
    await admin.$executeRaw`UPDATE email_workspace_operations SET created_at=clock_timestamp()-interval '1 hour' WHERE tenant_id=${tenantId}::uuid AND property_id=${p}::uuid AND response->>'kind'='DOMAIN_CHECK'`;
    expect((await check(p, version).expect(201)).body.state).toBe('verified');
  });
});
