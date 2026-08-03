import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});
const dateFromToday = (offset: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};
describe('properties', () => {
  let app: INestApplication;
  let tenantId: string;
  let userId: string;
  let staffUserId: string;
  let cookie: string;
  let planId: string;
  const email = `properties-${randomUUID()}@example.test`;
  const password = 'correct-horse-battery-staple';
  let token = '';
  const mail: MailProvider = {
    async sendVerificationEmail(x) {
      token = new URL(x.verificationUrl).searchParams.get('token')!;
    },
    async sendWelcomeEmail() {},
    async sendPasswordResetEmail() {},
    async sendPaymentConfirmationEmail() {},
    async sendRefundConfirmationEmail() {},
  };
  beforeAll(async () => {
    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL =
      'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.WEB_APP_URL = 'http://localhost:3001';
    await clearSignupRateLimits();
    const { AppModule } = await import('../src/app.module');
    const m = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_PROVIDER)
      .useValue(mail)
      .compile();
    app = m.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    if (tenantId) {
      await admin.$executeRaw`DELETE FROM rate_rules WHERE tenant_id=${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM rate_plans WHERE tenant_id=${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM room_types WHERE tenant_id=${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM audit_logs WHERE tenant_id=${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM property_staff_capability_overrides WHERE tenant_id=${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM property_staff_assignments WHERE tenant_id=${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM property_role_template_capabilities WHERE tenant_id=${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM property_role_templates WHERE tenant_id=${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM capabilities WHERE tenant_id=${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM tenant_memberships WHERE tenant_id=${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM properties WHERE tenant_id=${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM organizations WHERE id=${tenantId}::uuid`;
    }
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id=${userId}::uuid`;
    if (staffUserId) await admin.$executeRaw`DELETE FROM users WHERE id=${staffUserId}::uuid`;
    if (planId) await admin.$executeRaw`DELETE FROM plans WHERE id=${planId}::uuid`;
    await app.close();
    await admin.$disconnect();
  });
  it('lists memberships and enforces verified owner/admin property creation, tenant isolation, caps, and audit logs', async () => {
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Properties Hotel Group',
        propertyName: 'First Property',
        propertyAddress: '1 Main Street',
        propertyTimezone: 'Europe/Tirane',
        email,
        password,
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    userId = signup.body.user.id;
    cookie = signup.headers['set-cookie'][0];
    expect(
      (
        await request(app.getHttpServer())
          .get('/auth/memberships')
          .set('Cookie', cookie)
          .expect(200)
      ).body.memberships,
    ).toContainEqual(
      expect.objectContaining({
        tenantId,
        organizationName: 'Properties Hotel Group',
        role: 'OWNER',
      }),
    );
    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties`)
      .set('Cookie', cookie)
      .send({ name: 'Second', address: '2 Main Street', timezone: 'Europe/Tirane' })
      .expect(403);
    await request(app.getHttpServer())
      .post('/auth/email-verification/confirm')
      .send({ token })
      .expect(204);
    const firstPropertyId = signup.body.property.id as string;
    await request(app.getHttpServer())
      .patch(`/tenants/${tenantId}/properties/${firstPropertyId}/payment-gateways`)
      .set('Cookie', cookie)
      .send({ stripe: false, pokpay: true, payAtHotel: true })
      .expect(200)
      .expect((response) => {
        expect(response.body.paymentGateways).toEqual({
          stripe: false,
          pokpay: true,
          payAtHotel: true,
        });
      });
    const updated = await request(app.getHttpServer())
      .patch(`/tenants/${tenantId}/properties/${firstPropertyId}`)
      .set('Cookie', cookie)
      .send({
        name: 'Updated Property',
        address: '2 Updated Street',
        timezone: 'Europe/Paris',
        minStayNights: 2,
        maxStayNights: 3,
        checkInTime: 'whenever guests arrive',
        checkOutTime: 'after breakfast',
        advanceBookingDays: 10,
      })
      .expect(200);
    expect(updated.body).toMatchObject({
      id: firstPropertyId,
      name: 'Updated Property',
      address: '2 Updated Street',
      timezone: 'Europe/Paris',
      minStayNights: 2,
      maxStayNights: 3,
      checkInTime: 'whenever guests arrive',
      checkOutTime: 'after breakfast',
      advanceBookingDays: 10,
    });
    const roomTypeId = randomUUID();
    const ratePlanId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO room_types (id, tenant_id, property_id, name, max_occupancy)
      VALUES (${roomTypeId}::uuid, ${tenantId}::uuid, ${firstPropertyId}::uuid, 'Rules room', 2)
    `;
    await admin.$executeRaw`
      INSERT INTO rate_plans (id, tenant_id, property_id, name, currency)
      VALUES (${ratePlanId}::uuid, ${tenantId}::uuid, ${firstPropertyId}::uuid, 'Rules rate', 'EUR')
    `;
    await admin.$executeRaw`
      INSERT INTO rate_rules (tenant_id, property_id, rate_plan_id, room_type_id, starts_on, ends_on, amount)
      VALUES (${tenantId}::uuid, ${firstPropertyId}::uuid, ${ratePlanId}::uuid, ${roomTypeId}::uuid, NULL, NULL, 100.00)
    `;
    const rulesQuote = (startsOn: string, endsOn: string) =>
      request(app.getHttpServer())
        .post(`/tenants/${tenantId}/properties/${firstPropertyId}/quotes`)
        .send({ roomTypeId, ratePlanId, startsOn, endsOn });
    await rulesQuote(dateFromToday(1), dateFromToday(2))
      .expect(400)
      .expect((response) => {
        expect(response.body.message).toBe('A minimum stay of 2 nights is required.');
      });
    await rulesQuote(dateFromToday(1), dateFromToday(5))
      .expect(400)
      .expect((response) => {
        expect(response.body.message).toBe('A maximum stay of 3 nights is allowed.');
      });
    await rulesQuote(dateFromToday(11), dateFromToday(13))
      .expect(400)
      .expect((response) => {
        expect(response.body.message).toBe('Bookings can be made at most 10 days in advance.');
      });
    await rulesQuote(dateFromToday(1), dateFromToday(3)).expect(201);
    await request(app.getHttpServer())
      .patch(`/tenants/${tenantId}/properties/${firstPropertyId}`)
      .set('Cookie', cookie)
      .send({ minStayNights: 3 })
      .expect(200)
      .expect((response) => {
        expect(response.body.minStayNights).toBe(3);
      });
    await rulesQuote(dateFromToday(1), dateFromToday(3))
      .expect(400)
      .expect((response) => {
        expect(response.body.message).toBe('A minimum stay of 3 nights is required.');
      });
    planId = randomUUID();
    await admin.$executeRaw`INSERT INTO plans (id,name,max_properties,max_staff_seats,pms_enabled,max_pms_connections_per_property) VALUES (${planId}::uuid, ${`Properties ${planId}`}, 2, 3, false, 0)`;
    await admin.$executeRaw`UPDATE organizations SET plan_id=${planId}::uuid WHERE id=${tenantId}::uuid`;
    await admin.$executeRaw`UPDATE tenant_memberships SET role = 'ADMIN' WHERE tenant_id=${tenantId}::uuid AND user_id=${userId}::uuid`;
    const created = await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties`)
      .set('Cookie', cookie)
      .send({ name: 'Second Property', address: '2 Main Street', timezone: 'Europe/Tirane' })
      .expect(201);
    expect(created.body.paymentGateways).toEqual({
      stripe: false,
      pokpay: false,
      payAtHotel: false,
    });
    expect(
      (
        await request(app.getHttpServer())
          .get(`/tenants/${tenantId}/properties`)
          .set('Cookie', cookie)
          .expect(200)
      ).body,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: created.body.id, name: 'Second Property' }),
      ]),
    );
    staffUserId = randomUUID();
    const staffEmail = `property-list-staff-${staffUserId}@example.test`;
    const staffPassword = 'correct-horse-battery-staple';
    await admin.$executeRaw`
      INSERT INTO users (id, email, password_hash, email_verified_at)
      VALUES (${staffUserId}::uuid, ${staffEmail}, ${await bcrypt.hash(staffPassword, 12)}, CURRENT_TIMESTAMP)
    `;
    await admin.$executeRaw`
      INSERT INTO tenant_memberships (tenant_id, user_id, role)
      VALUES (${tenantId}::uuid, ${staffUserId}::uuid, 'STAFF')
    `;
    const frontDeskTemplate = await admin.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM property_role_templates
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${firstPropertyId}::uuid
        AND name = 'Front Desk'
    `;
    await admin.$executeRaw`
      INSERT INTO property_staff_assignments (tenant_id, property_id, user_id, role_template_id)
      VALUES (${tenantId}::uuid, ${firstPropertyId}::uuid, ${staffUserId}::uuid, ${frontDeskTemplate[0].id}::uuid)
    `;
    const staffCookie = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: staffEmail, password: staffPassword })
        .expect(201)
    ).headers['set-cookie'][0] as string;
    await request(app.getHttpServer())
      .get(`/tenants/${tenantId}/properties`)
      .set('Cookie', staffCookie)
      .expect(200)
      .expect((response) => {
        expect(response.body).toHaveLength(1);
        expect(response.body[0]).toMatchObject({ id: firstPropertyId, name: 'Updated Property' });
      });
    await request(app.getHttpServer())
      .get(`/tenants/${tenantId}/properties`)
      .set('Cookie', cookie)
      .expect(200)
      .expect((response) => {
        expect(response.body.map((property: { id: string }) => property.id)).toEqual([
          firstPropertyId,
          created.body.id,
        ]);
      });
    await request(app.getHttpServer())
      .post(`/tenants/${randomUUID()}/properties`)
      .set('Cookie', cookie)
      .send({ name: 'Outside', address: '3 Main Street', timezone: 'Europe/Tirane' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties`)
      .set('Cookie', cookie)
      .send({ name: 'Third', address: '3 Main Street', timezone: 'Europe/Tirane' })
      .expect(409);
    await admin.$executeRaw`UPDATE tenant_memberships SET role = 'STAFF' WHERE tenant_id=${tenantId}::uuid AND user_id=${userId}::uuid`;
    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties`)
      .set('Cookie', cookie)
      .send({ name: 'Staff property', address: '4 Main Street', timezone: 'Europe/Tirane' })
      .expect(403);
    const logs = await admin.$queryRaw<
      Array<{ action: string; target_id: string }>
    >`SELECT action,target_id FROM audit_logs WHERE tenant_id=${tenantId}::uuid`;
    expect(logs).toContainEqual({ action: 'property.created', target_id: created.body.id });
    expect(logs).toContainEqual({
      action: 'property.payment_gateways_updated',
      target_id: firstPropertyId,
    });
  });
});
