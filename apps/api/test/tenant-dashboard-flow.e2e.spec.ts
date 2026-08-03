import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';

const database = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('tenant dashboard end-to-end flow', () => {
  let app: INestApplication;
  let tenantId = '';
  let propertyId = '';
  let ownerId = '';
  let staffId = '';
  let ownerCookie = '';
  let staffCookie = '';
  let roomTypeId = '';
  let ratePlanId = '';
  const ownerEmail = `dashboard-owner-${randomUUID()}@example.test`;
  const staffEmail = `dashboard-staff-${randomUUID()}@example.test`;
  const password = 'correct-horse-battery-staple';
  let verificationToken = '';
  const mail: MailProvider = {
    async sendVerificationEmail(command) {
      verificationToken = new URL(command.verificationUrl).searchParams.get('token') ?? '';
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
    process.env.STRIPE_SECRET_KEY = 'sk_test_tenant_dashboard_e2e';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_tenant_dashboard_e2e';
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_PROVIDER)
      .useValue(mail)
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
  });

  afterAll(async () => {
    if (tenantId) {
      await database.$transaction(async (tx) => {
        await tx.$executeRaw`DELETE FROM property_staff_capability_overrides WHERE tenant_id = ${tenantId}::uuid`;
        await tx.$executeRaw`DELETE FROM property_staff_assignments WHERE tenant_id = ${tenantId}::uuid`;
        await tx.$executeRaw`DELETE FROM property_role_template_capabilities WHERE tenant_id = ${tenantId}::uuid`;
        await tx.$executeRaw`DELETE FROM property_role_templates WHERE tenant_id = ${tenantId}::uuid`;
        await tx.$executeRaw`DELETE FROM capabilities WHERE tenant_id = ${tenantId}::uuid`;
        await tx.$executeRaw`DELETE FROM integration_operations WHERE tenant_id = ${tenantId}::uuid`;
        await tx.$executeRaw`DELETE FROM payments WHERE tenant_id = ${tenantId}::uuid`;
        await tx.$executeRaw`DELETE FROM bookings WHERE tenant_id = ${tenantId}::uuid`;
        await tx.$executeRaw`DELETE FROM guests WHERE tenant_id = ${tenantId}::uuid`;
        await tx.$executeRaw`DELETE FROM inventory_units WHERE tenant_id = ${tenantId}::uuid`;
        await tx.$executeRaw`DELETE FROM rate_rules WHERE tenant_id = ${tenantId}::uuid`;
        await tx.$executeRaw`DELETE FROM rate_plans WHERE tenant_id = ${tenantId}::uuid`;
        await tx.$executeRaw`DELETE FROM room_types WHERE tenant_id = ${tenantId}::uuid`;
        await tx.$executeRaw`DELETE FROM notifications WHERE tenant_id = ${tenantId}::uuid`;
        await tx.$executeRaw`DELETE FROM audit_logs WHERE tenant_id = ${tenantId}::uuid`;
        await tx.$executeRaw`DELETE FROM tenant_memberships WHERE tenant_id = ${tenantId}::uuid`;
        await tx.$executeRaw`DELETE FROM properties WHERE tenant_id = ${tenantId}::uuid`;
        await tx.$executeRaw`DELETE FROM organizations WHERE id = ${tenantId}::uuid`;
      });
    }
    if (ownerId || staffId) {
      await database.$executeRaw`
        DELETE FROM users WHERE id IN (${ownerId || randomUUID()}::uuid, ${staffId || randomUUID()}::uuid)
      `;
    }
    await app?.close();
    await database.$disconnect();
  });

  it('runs the owner and property-staff operations flow through real HTTP endpoints', async () => {
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Dashboard E2E Hotel Group',
        propertyName: 'Dashboard E2E Hotel',
        propertyAddress: '1 Operations Street',
        propertyTimezone: 'UTC',
        email: ownerEmail,
        password,
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    propertyId = signup.body.property.id;
    ownerId = signup.body.user.id;
    expect(verificationToken).not.toBe('');
    await request(app.getHttpServer())
      .post('/auth/email-verification/confirm')
      .send({ token: verificationToken })
      .expect(204);
    ownerCookie = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: ownerEmail, password })
        .expect(201)
    ).headers['set-cookie'][0] as string;

    const propertyUrl = `/tenants/${tenantId}/properties/${propertyId}`;
    const today = dateFromToday(0);
    const startsOn = dateFromToday(3);
    const endsOn = dateFromToday(5);
    const staffStartsOn = dateFromToday(8);
    const staffEndsOn = dateFromToday(10);

    const roomType = await request(app.getHttpServer())
      .post(`${propertyUrl}/room-types`)
      .set('Cookie', ownerCookie)
      .send({ name: 'Dashboard Suite', maxOccupancy: 2 })
      .expect(201);
    roomTypeId = roomType.body.id;
    const ratePlan = await request(app.getHttpServer())
      .post(`${propertyUrl}/rate-plans`)
      .set('Cookie', ownerCookie)
      .send({ name: 'Dashboard Flexible', currency: 'EUR', freeCancellationUntilHours: 24 })
      .expect(201);
    ratePlanId = ratePlan.body.id;
    await request(app.getHttpServer())
      .post(`${propertyUrl}/rate-plans/${ratePlanId}/rules`)
      .set('Cookie', ownerCookie)
      .send({ roomTypeId, startsOn: null, endsOn: null, amount: '90.00' })
      .expect(201);
    await request(app.getHttpServer())
      .put(`${propertyUrl}/inventory-units`)
      .set('Cookie', ownerCookie)
      .send({ roomTypeId, startsOn: today, endsOn: dateFromToday(1), availableUnits: 2 })
      .expect(204);
    await request(app.getHttpServer())
      .put(`${propertyUrl}/inventory-units`)
      .set('Cookie', ownerCookie)
      .send({ roomTypeId, startsOn, endsOn, availableUnits: 2 })
      .expect(204);
    await request(app.getHttpServer())
      .put(`${propertyUrl}/inventory-units`)
      .set('Cookie', ownerCookie)
      .send({ roomTypeId, startsOn: staffStartsOn, endsOn: staffEndsOn, availableUnits: 1 })
      .expect(204);
    await request(app.getHttpServer())
      .patch(`/tenants/${tenantId}/properties/${propertyId}`)
      .set('Cookie', ownerCookie)
      .send({ minStayNights: 2 })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/tenants/${tenantId}/properties/${propertyId}/payment-gateways`)
      .set('Cookie', ownerCookie)
      .send({ stripe: false, pokpay: false, payAtHotel: true })
      .expect(200);

    const overview = await request(app.getHttpServer())
      .get(`${propertyUrl}/overview`)
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(overview.body.kpis).toMatchObject({
      date: today,
      bookedRoomNights: 0,
      availableRoomNights: 2,
      occupancyRate: 0,
    });

    const quoteInput = { roomTypeId, ratePlanId, startsOn, endsOn };
    await request(app.getHttpServer())
      .post(`${propertyUrl}/quotes`)
      .send({ ...quoteInput, endsOn: dateFromToday(4) })
      .expect(400)
      .expect((response) => {
        expect(response.body.message).toBe('A minimum stay of 2 nights is required.');
      });
    await request(app.getHttpServer()).post(`${propertyUrl}/quotes`).send(quoteInput).expect(201);

    const walkIn = await request(app.getHttpServer())
      .post(`${propertyUrl}/staff-bookings`)
      .set('Cookie', ownerCookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        ...quoteInput,
        guest: { email: 'walk-in@example.test', firstName: 'Walk', lastName: 'In' },
      })
      .expect(201);
    expect(walkIn.body).toMatchObject({ ok: true, value: { status: 'CONFIRMED' } });
    const bookingId = walkIn.body.value.id as string;

    const notifications = await request(app.getHttpServer())
      .get(`${propertyUrl}/notifications?page=1&pageSize=20`)
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(notifications.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'BOOKING_CREATED',
          readAt: null,
          payload: expect.objectContaining({ bookingId }),
        }),
      ]),
    );

    await request(app.getHttpServer())
      .post(`${propertyUrl}/bookings/${bookingId}/manual-payment`)
      .set('Cookie', ownerCookie)
      .set('Idempotency-Key', randomUUID())
      .send({ method: 'cash' })
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          ok: true,
          value: { bookingId, amount: { amount: '180.00', currency: 'EUR' }, status: 'succeeded' },
        });
      });

    const reports = await request(app.getHttpServer())
      .get(`${propertyUrl}/reports?from=${today}&to=${today}`)
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(reports.body.revenue).toEqual([{ date: today, currency: 'EUR', amount: '180.00' }]);

    const calendarBookings = await request(app.getHttpServer())
      .get(`${propertyUrl}/bookings`)
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(calendarBookings.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: bookingId,
          startsOn,
          endsOn,
          guestEmail: 'walk-in@example.test',
        }),
      ]),
    );
    await request(app.getHttpServer())
      .get(
        `${propertyUrl}/availability?roomTypeId=${roomTypeId}&startsOn=${startsOn}&endsOn=${endsOn}`,
      )
      .set('Cookie', ownerCookie)
      .expect(200)
      .expect((response) => expect(response.body).toMatchObject({ availableUnits: 1 }));

    const templateName = `Bookings only ${randomUUID().slice(0, 8)}`;
    await request(app.getHttpServer())
      .post(`${propertyUrl}/role-templates`)
      .set('Cookie', ownerCookie)
      .send({ name: templateName, capabilityKeys: ['bookings.manage'] })
      .expect(201);
    const templates = await request(app.getHttpServer())
      .get(`${propertyUrl}/role-templates`)
      .set('Cookie', ownerCookie)
      .expect(200);
    const bookingsOnlyTemplate = templates.body.find(
      (template: { name: string }) => template.name === templateName,
    ) as { id?: string; capabilities?: Array<{ key: string }> } | undefined;
    expect(bookingsOnlyTemplate).toMatchObject({ capabilities: [{ key: 'bookings.manage' }] });
    if (!bookingsOnlyTemplate?.id) throw new Error('Expected the custom role template.');
    const frontDeskTemplate = templates.body.find(
      (template: { name: string }) => template.name === 'Front Desk',
    ) as { id?: string } | undefined;
    if (!frontDeskTemplate?.id) throw new Error('Expected the built-in Front Desk role template.');

    const invitation = await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/staff-invitations`)
      .set('Cookie', ownerCookie)
      .send({
        email: staffEmail,
        assignments: [{ propertyId, roleTemplateId: frontDeskTemplate.id }],
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/auth/staff-invitations/activate')
      .send({ token: invitation.body.token, email: staffEmail, password })
      .expect(204);
    const staffLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: staffEmail, password })
      .expect(201);
    expect(staffLogin.body.user).toMatchObject({ email: staffEmail, emailVerified: true });
    staffCookie = staffLogin.headers['set-cookie'][0] as string;
    staffId = staffLogin.body.user.id;

    await request(app.getHttpServer())
      .put(`${propertyUrl}/staff/${staffId}`)
      .set('Cookie', ownerCookie)
      .send({ roleTemplateId: bookingsOnlyTemplate.id })
      .expect(204);
    const assignedStaff = await request(app.getHttpServer())
      .get(`${propertyUrl}/staff`)
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(assignedStaff.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: staffId,
          email: staffEmail,
          roleTemplateId: bookingsOnlyTemplate.id,
          roleTemplateName: templateName,
        }),
      ]),
    );

    await request(app.getHttpServer())
      .get(`${propertyUrl}/capabilities/mine`)
      .set('Cookie', staffCookie)
      .expect(200)
      .expect(['bookings.manage']);
    const staffBooking = await request(app.getHttpServer())
      .post(`${propertyUrl}/staff-bookings`)
      .set('Cookie', staffCookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        roomTypeId,
        ratePlanId,
        startsOn: staffStartsOn,
        endsOn: staffEndsOn,
        guest: { email: 'staff-walk-in@example.test', firstName: 'Staff', lastName: 'Walk In' },
      })
      .expect(201);
    expect(staffBooking.body).toMatchObject({ ok: true, value: { status: 'CONFIRMED' } });

    const rejectedRoutes = [
      () => request(app.getHttpServer()).get(`${propertyUrl}/staff`).set('Cookie', staffCookie),
      () =>
        request(app.getHttpServer())
          .patch(`/tenants/${tenantId}/properties/${propertyId}`)
          .set('Cookie', staffCookie)
          .send({ name: 'Not allowed' }),
      () => request(app.getHttpServer()).get(`${propertyUrl}/reports`).set('Cookie', staffCookie),
      () =>
        request(app.getHttpServer())
          .post(`${propertyUrl}/room-types`)
          .set('Cookie', staffCookie)
          .send({ name: 'Not allowed', maxOccupancy: 2 }),
      () =>
        request(app.getHttpServer())
          .post(`${propertyUrl}/rate-plans`)
          .set('Cookie', staffCookie)
          .send({ name: 'Not allowed', currency: 'EUR', freeCancellationUntilHours: 24 }),
    ];
    for (const route of rejectedRoutes) await route().expect(403);
  });
});

function dateFromToday(offset: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
