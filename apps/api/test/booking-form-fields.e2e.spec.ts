import * as crypto from 'node:crypto';
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

const isoDateFromToday = (offsetDays: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
};

/** Booking rules, "Booking form": the server holds a guest booking to the fields the hotel marked Required. */
describe('booking form fields', () => {
  let app: INestApplication | undefined;
  let tenantId: string;
  let userId: string;
  let verificationToken = '';
  const email = `form-fields-${randomUUID()}@example.test`;
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

  it('refuses a booking without a Required field, then stores what the guest filled in', async () => {
    const server = app!.getHttpServer();
    const signup = await request(server)
      .post('/auth/signup')
      .send({
        organizationName: 'Form Fields E2E Group',
        propertyName: 'Form Fields E2E Hotel',
        propertyAddress: '1 Form Way',
        propertyTimezone: 'Europe/Tirane',
        email,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    const propertyId = signup.body.property.id as string;
    userId = signup.body.user.id;
    const ownerCookie = signup.headers['set-cookie'][0] as string;
    const propertyUrl = `/tenants/${tenantId}/properties/${propertyId}`;
    await request(server)
      .post('/auth/email-verification/confirm')
      .send({ token: verificationToken })
      .expect(204);

    const roomType = await request(server)
      .post(`${propertyUrl}/room-types`)
      .set('Cookie', ownerCookie)
      .send({ name: 'Garden Suite', maxOccupancy: 2 })
      .expect(201);
    const ratePlan = await request(server)
      .post(`${propertyUrl}/rate-plans`)
      .set('Idempotency-Key', crypto.randomUUID())
      .set('Cookie', ownerCookie)
      .send({ name: 'Flexible', currency: 'EUR', freeCancellationUntilHours: 48 })
      .expect(201);
    const startsOn = isoDateFromToday(30);
    const endsOn = isoDateFromToday(32);
    await request(server)
      .put(`${propertyUrl}/inventory-units`)
      .set('Idempotency-Key', crypto.randomUUID())
      .set('Cookie', ownerCookie)
      .send({ roomTypeId: roomType.body.id, startsOn, endsOn, availableUnits: 5 })
      .expect(204);
    await request(server)
      .post(`${propertyUrl}/rate-plans/${ratePlan.body.id}/rules`)
      .set('Idempotency-Key', crypto.randomUUID())
      .set('Cookie', ownerCookie)
      .send({ roomTypeId: roomType.body.id, startsOn: null, endsOn: null, amount: '95.00' })
      .expect(201);
    await request(server)
      .patch(`${propertyUrl}/payment-gateways`)
      .set('Cookie', ownerCookie)
      .send({ stripe: false, pokpay: false, payAtHotel: true })
      .expect(200);

    const book = async (guest: Record<string, unknown>) => {
      const catalog = await request(server).get(`${propertyUrl}/public/catalog`).expect(200);
      const guestCookie = catalog.headers['set-cookie'][0] as string;
      const quote = await request(server)
        .post(`${propertyUrl}/quotes`)
        .set('Cookie', guestCookie)
        .send({ roomTypeId: roomType.body.id, ratePlanId: ratePlan.body.id, startsOn, endsOn })
        .expect(201);
      return request(server)
        .post(`${propertyUrl}/bookings`)
        .set('Cookie', guestCookie)
        .set('Idempotency-Key', randomUUID())
        .send({
          roomTypeId: roomType.body.id,
          ratePlanId: ratePlan.body.id,
          startsOn,
          endsOn,
          guest: {
            email: 'form.guest@example.test',
            firstName: 'Form',
            lastName: 'Guest',
            ...guest,
          },
          total: quote.body.total,
          quoteToken: quote.body.quoteToken,
          paymentMethod: 'pay_at_hotel',
        });
    };
    const address = { streetAddress: '1 Rruga', city: 'Durres', postcode: '2001' };

    // Default form: nothing beyond today's checkout is enforced, so a plain booking still works.
    expect((await book({ phone: '+355690000000' })).status).toBe(201);

    // The hotel makes the address, arrival time and company Required.
    await request(server)
      .patch(propertyUrl)
      .set('Cookie', ownerCookie)
      .send({ formAddress: 'required', formArrivalTime: 'required', formCompany: 'required' })
      .expect(200);

    const noAddress = await book({ phone: '+355690000000' });
    expect(noAddress.status).toBe(400);
    expect(JSON.stringify(noAddress.body)).toContain('Please complete your address');
    const noArrival = await book({ phone: '+355690000000', ...address });
    expect(noArrival.status).toBe(400);
    expect(JSON.stringify(noArrival.body)).toContain('arrival time');
    const noCompany = await book({ phone: '+355690000000', ...address, arrivalTime: '15:30' });
    expect(noCompany.status).toBe(400);
    expect(JSON.stringify(noCompany.body)).toContain('company name');
    const badTime = await book({ phone: '+355690000000', ...address, arrivalTime: '25:99' });
    expect(badTime.status).toBe(400);

    const created = await book({
      phone: '+355690000000',
      ...address,
      arrivalTime: '15:30',
      companyName: 'Acme Travel',
      taxNumber: 'L12345678A',
      marketingConsent: true,
    });
    expect(created.status).toBe(201);
    const rows = await admin.$queryRaw<
      Array<{
        estimated_arrival_time: string | null;
        company_name: string | null;
        tax_number: string | null;
        marketing_consent: boolean;
        has_consent_time: boolean;
        street_address: string | null;
      }>
    >`SELECT b.estimated_arrival_time, b.company_name, b.tax_number, b.marketing_consent,
        (b.marketing_consent_at IS NOT NULL) AS has_consent_time, g.street_address
      FROM bookings b JOIN guests g ON g.id = b.guest_id WHERE b.id = ${created.body.value.id}::uuid`;
    expect(rows[0]).toEqual({
      estimated_arrival_time: '15:30',
      company_name: 'Acme Travel',
      tax_number: 'L12345678A',
      marketing_consent: true,
      has_consent_time: true,
      street_address: '1 Rruga',
    });

    // Marketing consent is never assumed and never required.
    const plain = await book({
      phone: '+355690000000',
      ...address,
      arrivalTime: '16:00',
      companyName: 'Acme Travel',
    });
    expect(plain.status).toBe(201);
    const consent = await admin.$queryRaw<
      Array<{ marketing_consent: boolean; at: Date | null }>
    >`SELECT marketing_consent, marketing_consent_at AS at FROM bookings WHERE id = ${plain.body.value.id}::uuid`;
    expect(consent[0]).toEqual({ marketing_consent: false, at: null });
  });
});
