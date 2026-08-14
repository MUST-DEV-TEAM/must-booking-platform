import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
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
  };

  beforeAll(async () => {
    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL =
      'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.WEB_APP_URL = 'http://localhost:3001';
    await clearSignupRateLimits();
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
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
});
