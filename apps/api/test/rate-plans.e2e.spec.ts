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

describe('rate plans', () => {
  let app: INestApplication;
  let tenantId: string;
  let propertyId: string;
  let roomTypeId: string;
  let userId: string;
  let cookie: string;
  let verificationToken = '';
  const email = `rate-plans-${randomUUID()}@example.test`;
  const password = 'correct-horse-battery-staple';
  const mail: MailProvider = {
    async sendVerificationEmail(command) {
      verificationToken = new URL(command.verificationUrl).searchParams.get('token')!;
    },
    async sendWelcomeEmail() {},
    async sendPasswordResetEmail() {},
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
    if (app) await app.close();
    await admin.$disconnect();
  });

  it('provides tenant-scoped rate plan/rule CRUD and rejects overlapping applicable rules', async () => {
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Rate Plans Hotel Group',
        propertyName: 'First Property',
        propertyAddress: '1 Main Street',
        propertyTimezone: 'Europe/Tirane',
        email,
        password,
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    propertyId = signup.body.property.id;
    userId = signup.body.user.id;
    cookie = signup.headers['set-cookie'][0];

    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/rate-plans`)
      .set('Cookie', cookie)
      .send({ name: 'Flexible', currency: 'EUR' })
      .expect(403);

    await request(app.getHttpServer())
      .post('/auth/email-verification/confirm')
      .send({ token: verificationToken })
      .expect(204);

    const roomType = await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/room-types`)
      .set('Cookie', cookie)
      .send({ name: 'Standard Room', maxOccupancy: 2 })
      .expect(201);
    roomTypeId = roomType.body.id;

    const created = await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/rate-plans`)
      .set('Cookie', cookie)
      .send({ name: 'Flexible', currency: 'eur', freeCancellationUntilHours: 48 })
      .expect(201);
    const ratePlanId = created.body.id as string;
    expect(created.body).toMatchObject({
      name: 'Flexible',
      currency: 'EUR',
      isActive: true,
      freeCancellationUntilHours: 48,
    });

    await request(app.getHttpServer())
      .patch(`/tenants/${tenantId}/properties/${propertyId}/rate-plans/${ratePlanId}`)
      .set('Cookie', cookie)
      .send({ name: 'Flexible', currency: 'EUR', freeCancellationUntilHours: -1 })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/rate-plans`)
      .set('Cookie', cookie)
      .send({ name: 'Invalid currency', currency: 'EURO' })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/rate-plans/${ratePlanId}/rules`)
      .set('Cookie', cookie)
      .send({
        roomTypeId,
        startsOn: '2026-08-02',
        endsOn: '2026-08-01',
        amount: '100.00',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/rate-plans/${ratePlanId}/rules`)
      .set('Cookie', cookie)
      .send({
        roomTypeId,
        startsOn: '2026-08-01',
        endsOn: null,
        amount: '100.00',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/rate-plans/${ratePlanId}/rules`)
      .set('Cookie', cookie)
      .send({
        roomTypeId,
        startsOn: '2026-08-01',
        endsOn: '2026-08-02',
        weekdays: [1, 1],
        amount: '100.00',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/rate-plans/${ratePlanId}/rules`)
      .set('Cookie', cookie)
      .send({
        roomTypeId,
        startsOn: '2026-08-01',
        endsOn: '2026-08-02',
        amount: '100.999',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/rate-plans/${ratePlanId}/rules`)
      .set('Cookie', cookie)
      .send({
        roomTypeId,
        startsOn: '2026-08-01',
        endsOn: '2026-08-02',
        amount: 100,
      })
      .expect(400);

    const baseRule = await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/rate-plans/${ratePlanId}/rules`)
      .set('Cookie', cookie)
      .send({ roomTypeId, startsOn: null, endsOn: null, amount: '100.00' })
      .expect(201);
    expect(baseRule.body).toMatchObject({
      roomTypeId,
      startsOn: null,
      endsOn: null,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      amount: '100.00',
    });

    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/rate-plans/${ratePlanId}/rules`)
      .set('Cookie', cookie)
      .send({ roomTypeId, startsOn: null, endsOn: null, amount: '120.00' })
      .expect(409);

    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/rate-plans/${ratePlanId}/rules`)
      .set('Cookie', cookie)
      .send({ roomTypeId, startsOn: null, endsOn: null, weekdays: [1], amount: '120.00' })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/rate-plans`)
      .set('Cookie', cookie)
      .send({ name: 'Flexible', currency: 'EUR' })
      .expect(409);

    await request(app.getHttpServer())
      .post(`/tenants/${randomUUID()}/properties/${propertyId}/rate-plans`)
      .set('Cookie', cookie)
      .send({ name: 'Outside', currency: 'EUR' })
      .expect(403);

    const firstRule = await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/rate-plans/${ratePlanId}/rules`)
      .set('Cookie', cookie)
      .send({
        roomTypeId,
        startsOn: '2026-08-01',
        endsOn: '2026-08-31',
        weekdays: [1, 2, 3, 4, 5],
        amount: '125.50',
      })
      .expect(201);
    const firstRuleId = firstRule.body.id as string;
    expect(firstRule.body).toMatchObject({
      roomTypeId,
      amount: '125.50',
      weekdays: [1, 2, 3, 4, 5],
    });

    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/rate-plans/${ratePlanId}/rules`)
      .set('Cookie', cookie)
      .send({
        roomTypeId,
        startsOn: '2026-08-15',
        endsOn: '2026-09-01',
        weekdays: [5, 6],
        amount: '130.00',
      })
      .expect(409);

    // Different weekdays do not overlap in applicability.
    const weekendRule = await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/rate-plans/${ratePlanId}/rules`)
      .set('Cookie', cookie)
      .send({
        roomTypeId,
        startsOn: '2026-08-15',
        endsOn: '2026-09-01',
        weekdays: [0, 6],
        amount: '150.00',
      })
      .expect(201);

    // The same room/dates are independent in another rate plan.
    const otherPlan = await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/rate-plans`)
      .set('Cookie', cookie)
      .send({ name: 'Non-refundable', currency: 'EUR', isActive: false })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/rate-plans/${otherPlan.body.id}/rules`)
      .set('Cookie', cookie)
      .send({ roomTypeId, startsOn: '2026-08-01', endsOn: '2026-08-31', amount: '110.00' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(
        `/tenants/${tenantId}/properties/${propertyId}/rate-plans/${ratePlanId}/rules/${weekendRule.body.id}`,
      )
      .set('Cookie', cookie)
      .send({
        roomTypeId,
        startsOn: '2026-08-01',
        endsOn: '2026-08-31',
        weekdays: [1],
        amount: '150.00',
      })
      .expect(409);

    await request(app.getHttpServer())
      .delete(`/tenants/${tenantId}/properties/${propertyId}/rate-plans/${ratePlanId}`)
      .set('Cookie', cookie)
      .expect(409);

    const rules = await request(app.getHttpServer())
      .get(`/tenants/${tenantId}/properties/${propertyId}/rate-plans/${ratePlanId}/rules`)
      .set('Cookie', cookie)
      .expect(200);
    expect(rules.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: firstRuleId })]),
    );

    await request(app.getHttpServer())
      .delete(
        `/tenants/${tenantId}/properties/${propertyId}/rate-plans/${ratePlanId}/rules/${weekendRule.body.id}`,
      )
      .set('Cookie', cookie)
      .expect(204);
    await request(app.getHttpServer())
      .delete(
        `/tenants/${tenantId}/properties/${propertyId}/rate-plans/${ratePlanId}/rules/${firstRuleId}`,
      )
      .set('Cookie', cookie)
      .expect(204);
    await request(app.getHttpServer())
      .delete(
        `/tenants/${tenantId}/properties/${propertyId}/rate-plans/${ratePlanId}/rules/${baseRule.body.id}`,
      )
      .set('Cookie', cookie)
      .expect(204);
    await request(app.getHttpServer())
      .patch(`/tenants/${tenantId}/properties/${propertyId}/rate-plans/${ratePlanId}`)
      .set('Cookie', cookie)
      .send({ name: 'Flexible Updated', currency: 'EUR', isActive: false })
      .expect(200);
    await request(app.getHttpServer())
      .delete(`/tenants/${tenantId}/properties/${propertyId}/rate-plans/${ratePlanId}`)
      .set('Cookie', cookie)
      .expect(204);

    const logs = await admin.$queryRaw<Array<{ action: string; target_id: string }>>`
      SELECT action, target_id FROM audit_logs WHERE tenant_id = ${tenantId}::uuid
    `;
    expect(logs).toContainEqual({ action: 'rate_plan.created', target_id: ratePlanId });
    expect(logs).toContainEqual({ action: 'rate_rule.created', target_id: firstRuleId });
    expect(logs).toContainEqual({ action: 'rate_rule.created', target_id: baseRule.body.id });
    expect(logs).toContainEqual({ action: 'rate_rule.deleted', target_id: firstRuleId });
    expect(logs).toContainEqual({ action: 'rate_plan.deleted', target_id: ratePlanId });
  });
});
