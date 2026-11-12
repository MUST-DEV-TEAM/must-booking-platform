import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { withoutExternalWorkers } from './helpers/without-external-workers';
import { ConnectionTestRegistry } from '../src/integrations/connection-tester';
import { IntegrationConnectionsService } from '../src/integrations/integration-connections.service';
import { cleanupTenant } from './helpers/cleanup-tenant';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('integration connections', () => {
  let app: INestApplication | undefined;
  let tenantId: string;
  let propertyId: string;
  let userId: string;
  let cookie: string;
  let verificationToken = '';
  let pmsPlanId: string | undefined;
  const email = `integration-connections-${randomUUID()}@example.test`;
  const mail: MailProvider = {
    async sendVerificationEmail(command) {
      verificationToken = new URL(command.verificationUrl).searchParams.get('token')!;
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
    await clearSignupRateLimits();
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await withoutExternalWorkers(
      Test.createTestingModule({ imports: [AppModule] }),
    )
      .overrideProvider(MAIL_PROVIDER)
      .useValue(mail)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id = ${userId}::uuid`;
    if (pmsPlanId) await admin.$executeRaw`DELETE FROM plans WHERE id = ${pmsPlanId}::uuid`;
    if (app) await app.close();
    await admin.$disconnect();
  });

  it('manages tenant-owned connections, plan gating, and per-property assignment', async () => {
    const signup = await request(app!.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Integrations Hotel Group',
        propertyName: 'First Property',
        propertyAddress: '1 Main Street',
        propertyTimezone: 'Europe/Tirane',
        email,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    propertyId = signup.body.property.id;
    userId = signup.body.user.id;
    cookie = signup.headers['set-cookie'][0];
    const tenantUrl = `/tenants/${tenantId}`;
    const setup = await request(app!.getHttpServer())
      .get(`${tenantUrl}/integration-setup`)
      .set('Cookie', cookie)
      .expect(200);
    expect(setup.body.pokpayWebhookUrl).toBe(
      process.env.POKPAY_WEBHOOK_URL?.trim() || 'http://localhost:3001/api/webhooks/pokpay',
    );

    await request(app!.getHttpServer())
      .post(`${tenantUrl}/integration-connections`)
      .set('Cookie', cookie)
      .send({ kind: 'PAYMENT', provider: 'STRIPE', name: 'Main Stripe', credentials: {} })
      .expect(403);

    await request(app!.getHttpServer())
      .post('/auth/email-verification/confirm')
      .send({ token: verificationToken })
      .expect(204);

    // Free plan does not include PMS access — rejected outright, not created.
    await request(app!.getHttpServer())
      .post(`${tenantUrl}/integration-connections`)
      .set('Cookie', cookie)
      .send({
        kind: 'PMS',
        provider: 'CLOCK_PMS',
        name: 'Clock',
        credentials: { apiUser: 'must_1', apiKey: 'secret' },
      })
      .expect(409);

    const created = await request(app!.getHttpServer())
      .post(`${tenantUrl}/integration-connections`)
      .set('Cookie', cookie)
      .send({
        kind: 'PAYMENT',
        provider: 'STRIPE',
        name: 'Main Stripe',
        credentials: { secretKey: 'sk_test_secret_value', webhookSecret: 'whsec_secret_value' },
      })
      .expect(201);
    const connectionId = created.body.id as string;
    expect(created.body).toMatchObject({
      kind: 'PAYMENT',
      provider: 'STRIPE',
      name: 'Main Stripe',
      status: 'PENDING',
    });
    expect(created.body.credentials).toBeUndefined();
    expect(JSON.stringify(created.body)).not.toContain('sk_test_secret_value');

    const listed = await request(app!.getHttpServer())
      .get(`${tenantUrl}/integration-connections`)
      .set('Cookie', cookie)
      .expect(200);
    expect(listed.body).toContainEqual(expect.objectContaining({ id: connectionId }));
    expect(JSON.stringify(listed.body)).not.toContain('sk_test_secret_value');

    // A real StripeConnectionTester is registered now — testing this fake
    // secret key against the real Stripe API must honestly fail auth, never
    // report a false success.
    const tested = await request(app!.getHttpServer())
      .post(`${tenantUrl}/integration-connections/${connectionId}/test`)
      .set('Cookie', cookie)
      .expect(201);
    expect(tested.body).toMatchObject({
      id: connectionId,
      status: 'FAILED',
      lastTestResult: 'Stripe authentication failed.',
    });

    // Assign the connection to the property, then disable it again.
    const assigned = await request(app!.getHttpServer())
      .patch(`${tenantUrl}/properties/${propertyId}/integration-connections/${connectionId}`)
      .set('Cookie', cookie)
      .send({ enabled: true })
      .expect(200);
    expect(assigned.body).toEqual({});

    const propertyConnections = await request(app!.getHttpServer())
      .get(`${tenantUrl}/properties/${propertyId}/integration-connections`)
      .set('Cookie', cookie)
      .expect(200);
    expect(propertyConnections.body).toContainEqual(
      expect.objectContaining({ connectionId, enabled: true }),
    );

    await request(app!.getHttpServer())
      .patch(`${tenantUrl}/properties/${propertyId}/integration-connections/${connectionId}`)
      .set('Cookie', cookie)
      .send({ enabled: false })
      .expect(200);

    // Upgrade the tenant onto a PMS-enabled plan (seeded here since only Free
    // exists by default) to exercise PMS connection creation and the
    // at-most-one-active-PMS-per-property database constraint.
    pmsPlanId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO plans (id, name, max_properties, max_staff_seats, pms_enabled, max_pms_connections_per_property)
      VALUES (${pmsPlanId}::uuid, ${'PMS Test Plan ' + pmsPlanId}, 10, 10, true, 5)
    `;
    await admin.$executeRaw`UPDATE organizations SET plan_id = ${pmsPlanId}::uuid WHERE id = ${tenantId}::uuid`;

    const clockA = await request(app!.getHttpServer())
      .post(`${tenantUrl}/integration-connections`)
      .set('Cookie', cookie)
      .send({
        kind: 'PMS',
        provider: 'CLOCK_PMS',
        name: 'Clock A',
        credentials: { apiUser: 'must_1', apiKey: 'secret-a' },
      })
      .expect(201);
    const clockB = await request(app!.getHttpServer())
      .post(`${tenantUrl}/integration-connections`)
      .set('Cookie', cookie)
      .send({
        kind: 'PMS',
        provider: 'CLOCK_PMS',
        name: 'Clock B',
        credentials: { apiUser: 'must_2', apiKey: 'secret-b' },
      })
      .expect(201);

    await request(app!.getHttpServer())
      .patch(`${tenantUrl}/properties/${propertyId}/integration-connections/${clockA.body.id}`)
      .set('Cookie', cookie)
      .send({ enabled: true })
      .expect(200);

    // A second PMS connection cannot be active on the same property at once.
    await request(app!.getHttpServer())
      .patch(`${tenantUrl}/properties/${propertyId}/integration-connections/${clockB.body.id}`)
      .set('Cookie', cookie)
      .send({ enabled: true })
      .expect(409);

    await request(app!.getHttpServer())
      .delete(`${tenantUrl}/integration-connections/${connectionId}`)
      .set('Cookie', cookie)
      .expect(200);

    const afterDelete = await request(app!.getHttpServer())
      .get(`${tenantUrl}/integration-connections`)
      .set('Cookie', cookie)
      .expect(200);
    expect(afterDelete.body).not.toContainEqual(expect.objectContaining({ id: connectionId }));

    const logs = await admin.$queryRaw<Array<{ action: string; target_id: string }>>`
      SELECT action, target_id FROM audit_logs WHERE tenant_id = ${tenantId}::uuid
    `;
    expect(logs).toContainEqual({
      action: 'integration_connection.created',
      target_id: connectionId,
    });
    expect(logs).toContainEqual({
      action: 'integration_connection.tested',
      target_id: connectionId,
    });
    expect(logs).toContainEqual({
      action: 'integration_connection.enabled_for_property',
      target_id: connectionId,
    });
    expect(logs).toContainEqual({
      action: 'integration_connection.disabled_for_property',
      target_id: connectionId,
    });
    expect(logs).toContainEqual({
      action: 'integration_connection.deleted',
      target_id: connectionId,
    });
  });
  it('keeps working credentials on failed replacement, audits success and refuses account changes', async () => {
    const base = `/tenants/${tenantId}/integration-connections`;
    const created = await request(app!.getHttpServer())
      .post(base)
      .set('Cookie', cookie)
      .send({
        kind: 'PAYMENT',
        provider: 'POKPAY',
        name: 'Replacement fixture',
        credentials: {
          merchantId: 'same-merchant',
          keyId: 'old-id',
          keySecret: 'old-private-value',
        },
      })
      .expect(201);
    const id = created.body.id;
    const original = (
      await admin.$queryRaw<
        Array<{ value: string }>
      >`SELECT encrypted_credentials AS value FROM integration_connections WHERE tenant_id=${tenantId}::uuid AND id=${id}::uuid`
    )[0].value;
    app!
      .get(ConnectionTestRegistry)
      .register({ provider: 'POKPAY', test: async () => ({ ok: false, message: 'Rejected' }) });
    await request(app!.getHttpServer())
      .patch(`${base}/${id}/credentials`)
      .set('Cookie', cookie)
      .send({ credentials: { keySecret: 'new-private-value' } })
      .expect(400);
    expect(
      (
        await admin.$queryRaw<
          Array<{ value: string }>
        >`SELECT encrypted_credentials AS value FROM integration_connections WHERE tenant_id=${tenantId}::uuid AND id=${id}::uuid`
      )[0].value,
    ).toBe(original);
    await request(app!.getHttpServer())
      .patch(`${base}/${id}/credentials`)
      .set('Cookie', cookie)
      .send({ credentials: { merchantId: 'other-account' } })
      .expect(400);
    app!
      .get(ConnectionTestRegistry)
      .register({ provider: 'POKPAY', test: async () => ({ ok: true, message: 'Verified' }) });
    const replaced = await request(app!.getHttpServer())
      .patch(`${base}/${id}/credentials`)
      .set('Cookie', cookie)
      .send({ credentials: { keySecret: 'new-private-value' } })
      .expect(200);
    expect(replaced.body.status).toBe('CONNECTED');
    const details = await request(app!.getHttpServer())
      .get(`${base}/${id}/credentials`)
      .set('Cookie', cookie)
      .expect(200);
    expect(details.body.fields.keySecret).toBe('***alue');
    expect(JSON.stringify(details.body)).not.toContain('new-private-value');
    expect(details.headers['cache-control']).toContain('no-store');

    expect(JSON.stringify(replaced.body)).not.toContain('private-value');
    const logs = await admin.$queryRaw<
      Array<{ details: unknown }>
    >`SELECT details FROM audit_logs WHERE tenant_id=${tenantId}::uuid AND target_id=${id} AND action='integration_connection.credentials_replaced'`;
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs)).not.toContain('private-value');
  });
  it('preserves a Clock account binding when linked booking history exists', async () => {
    const connections = await request(app!.getHttpServer())
      .get(`/tenants/${tenantId}/integration-connections`)
      .set('Cookie', cookie)
      .expect(200);
    const a = connections.body.find((c: { name: string }) => c.name === 'Clock A');
    const b = connections.body.find((c: { name: string }) => c.name === 'Clock B');
    const type = randomUUID(),
      plan = randomUUID(),
      booking = randomUUID();
    await admin.$executeRaw`INSERT INTO room_types(id,tenant_id,property_id,name,max_occupancy) VALUES(${type}::uuid,${tenantId}::uuid,${propertyId}::uuid,'History fixture',2)`;
    await admin.$executeRaw`INSERT INTO rate_plans(id,tenant_id,property_id,name,currency) VALUES(${plan}::uuid,${tenantId}::uuid,${propertyId}::uuid,'History fixture','EUR')`;
    await admin.$executeRaw`INSERT INTO bookings(id,tenant_id,property_id,room_type_id,rate_plan_id,external_reference,external_booking_id,status,payment_method,starts_on,ends_on,total_amount) VALUES(${booking}::uuid,${tenantId}::uuid,${propertyId}::uuid,${type}::uuid,${plan}::uuid,'CLOCK-history-fixture','123456','CONFIRMED','PAY_AT_HOTEL','2027-01-01','2027-01-02',100)`;
    const base = `/tenants/${tenantId}/properties/${propertyId}/integration-connections`;
    await request(app!.getHttpServer())
      .patch(`${base}/${a.id}`)
      .set('Cookie', cookie)
      .send({ enabled: false })
      .expect(409);
    const rejected = await request(app!.getHttpServer())
      .patch(`${base}/${b.id}`)
      .set('Cookie', cookie)
      .send({ enabled: true })
      .expect(409);
    expect(rejected.body.message).toContain('history');
    await request(app!.getHttpServer())
      .delete(`/tenants/${tenantId}/integration-connections/${a.id}`)
      .set('Cookie', cookie)
      .expect(409);
    await request(app!.getHttpServer())
      .patch(`${base}/${a.id}`)
      .set('Cookie', cookie)
      .send({ enabled: true })
      .expect(200);
  });
  it('switches PokPay freely between test and live accounts and keeps each payment on its own account', async () => {
    app!
      .get(ConnectionTestRegistry)
      .register({ provider: 'POKPAY', test: async () => ({ ok: true, message: 'Verified' }) });
    const tenantUrl = `/tenants/${tenantId}`;
    const propertyUrl = `${tenantUrl}/properties/${propertyId}`;
    const create = (name: string, baseUrl: string) =>
      request(app!.getHttpServer())
        .post(`${tenantUrl}/integration-connections`)
        .set('Cookie', cookie)
        .send({
          kind: 'PAYMENT',
          provider: 'POKPAY',
          name,
          credentials: {
            baseUrl,
            merchantId: `${name}-merchant`,
            keyId: `${name}-key`,
            keySecret: `${name}-private-value`,
            webhookUrl: 'https://booking.example.test/api/webhooks/pokpay',
          },
        })
        .expect(201);
    const testAccount = (await create('PokPay Test', 'https://api-staging.pokpay.io')).body;
    const liveAccount = (await create('PokPay Live', 'https://api.pokpay.io')).body;
    expect(testAccount.mode).toBe('TEST');
    expect(liveAccount.mode).toBe('LIVE');
    const use = (id: string) =>
      request(app!.getHttpServer())
        .patch(`${propertyUrl}/integration-connections/${id}`)
        .set('Cookie', cookie)
        .send({ enabled: true });
    await use(liveAccount.id).expect(200);

    // A real payment taken through the live account.
    const type = randomUUID(),
      plan = randomUUID(),
      booking = randomUUID(),
      olderBooking = randomUUID();
    await admin.$executeRaw`INSERT INTO room_types(id,tenant_id,property_id,name,max_occupancy) VALUES(${type}::uuid,${tenantId}::uuid,${propertyId}::uuid,'Switch fixture',2)`;
    await admin.$executeRaw`INSERT INTO rate_plans(id,tenant_id,property_id,name,currency) VALUES(${plan}::uuid,${tenantId}::uuid,${propertyId}::uuid,'Switch fixture','EUR')`;
    for (const [id, reference] of [
      [booking, 'POKPAY-switch-fixture'],
      [olderBooking, 'POKPAY-switch-older'],
    ])
      await admin.$executeRaw`INSERT INTO bookings(id,tenant_id,property_id,room_type_id,rate_plan_id,external_reference,status,payment_method,starts_on,ends_on,total_amount) VALUES(${id}::uuid,${tenantId}::uuid,${propertyId}::uuid,${type}::uuid,${plan}::uuid,${reference},'CONFIRMED','POKPAY','2027-02-01','2027-02-02',100)`;
    await admin.$executeRaw`INSERT INTO payment_provider_sessions(tenant_id,property_id,booking_id,provider,external_payment_id,connection_id) VALUES(${tenantId}::uuid,${propertyId}::uuid,${booking}::uuid,'pokpay','order-live-1',${liveAccount.id}::uuid)`;
    await admin.$executeRaw`INSERT INTO payments(tenant_id,property_id,booking_id,kind,provider,external_payment_id,status,amount,currency) VALUES(${tenantId}::uuid,${propertyId}::uuid,${booking}::uuid,'CHARGE','pokpay','order-live-1','PAID',100,'EUR')`;

    // Back to test even though the hotel has real payments, then live again: both directions work.
    await use(testAccount.id).expect(200);
    const assignments = await request(app!.getHttpServer())
      .get(`${propertyUrl}/integration-connections`)
      .set('Cookie', cookie)
      .expect(200);
    expect(assignments.body).toContainEqual(
      expect.objectContaining({ connectionId: testAccount.id, enabled: true, mode: 'TEST' }),
    );
    expect(assignments.body).toContainEqual(
      expect.objectContaining({ connectionId: liveAccount.id, enabled: false, mode: 'LIVE' }),
    );
    const modes = await request(app!.getHttpServer())
      .get(`${propertyUrl}/payment-modes`)
      .set('Cookie', cookie)
      .expect(200);
    expect(modes.body).toEqual([{ provider: 'POKPAY', name: 'PokPay Test', mode: 'TEST' }]);
    expect(JSON.stringify(modes.body)).not.toContain('private-value');

    // The switched-off live account keeps its keys and still serves its own payment.
    const kept = await request(app!.getHttpServer())
      .get(`${tenantUrl}/integration-connections/${liveAccount.id}/credentials`)
      .set('Cookie', cookie)
      .expect(200);
    expect(kept.body.fields).toMatchObject({
      keyId: 'PokPay Live-key',
      baseUrl: 'https://api.pokpay.io',
      keySecret: '***alue',
    });
    const connections = app!.get(IntegrationConnectionsService);
    await expect(
      connections.sessionPaymentConnection(tenantId, propertyId, 'POKPAY', 'order-live-1'),
    ).resolves.toMatchObject({ connectionId: liveAccount.id, mode: 'LIVE' });
    await expect(
      connections.activePaymentConnection(tenantId, propertyId, 'POKPAY'),
    ).resolves.toMatchObject({ connectionId: testAccount.id, mode: 'TEST' });

    // An older session that never recorded its account: both accounts are candidates, the one in use
    // first, until the right one is found and recorded.
    await admin.$executeRaw`INSERT INTO payment_provider_sessions(tenant_id,property_id,booking_id,provider,external_payment_id) VALUES(${tenantId}::uuid,${propertyId}::uuid,${olderBooking}::uuid,'pokpay','order-older-1')`;
    await expect(
      connections.sessionPaymentConnection(tenantId, propertyId, 'POKPAY', 'order-older-1'),
    ).resolves.toBeNull();
    const linked = await connections.linkedPaymentConnections(tenantId, propertyId, 'POKPAY');
    expect(linked.map((candidate) => candidate.connectionId)).toEqual([
      testAccount.id,
      liveAccount.id,
    ]);
    await connections.rememberSessionConnection(
      tenantId,
      propertyId,
      'POKPAY',
      'order-older-1',
      liveAccount.id,
    );
    await expect(
      connections.sessionPaymentConnection(tenantId, propertyId, 'POKPAY', 'order-older-1'),
    ).resolves.toMatchObject({ connectionId: liveAccount.id });

    await use(liveAccount.id).expect(200);
    const logs = await admin.$queryRaw<Array<{ target_id: string; details: unknown }>>`
      SELECT target_id, details FROM audit_logs
      WHERE tenant_id=${tenantId}::uuid AND action='integration_connection.enabled_for_property'
        AND target_id IN (${testAccount.id}, ${liveAccount.id})
      ORDER BY created_at`;
    const recorded = logs.map((log) => {
      const details = { ...(log.details as Record<string, unknown>) };
      delete details._audit;
      return [log.target_id, details];
    });
    expect(recorded).toEqual([
      [liveAccount.id, { provider: 'POKPAY', mode: 'LIVE' }],
      [testAccount.id, { provider: 'POKPAY', mode: 'TEST', switchedFrom: [liveAccount.id] }],
      [liveAccount.id, { provider: 'POKPAY', mode: 'LIVE', switchedFrom: [testAccount.id] }],
    ]);
    expect(JSON.stringify(logs)).not.toContain('private-value');
  });
});
