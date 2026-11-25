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

/** G-56: versioned terms and privacy links, and the guest's acceptance stored on the booking. */
describe('terms acceptance', () => {
  let app: INestApplication | undefined;
  let tenantId: string;
  let userId: string;
  let verificationToken = '';
  const email = `terms-${randomUUID()}@example.test`;
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

  it('versions the links and records what the guest accepted', async () => {
    const server = app!.getHttpServer();
    const signup = await request(server)
      .post('/auth/signup')
      .send({
        organizationName: 'Terms E2E Group',
        propertyName: 'Terms E2E Hotel',
        propertyAddress: '1 Terms Way',
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

    const base = { phone: '+355690000000' };
    // A hotel that set nothing: bookings work as before and record nothing.
    const plain = await book(base);
    expect(plain.status).toBe(201);

    // Links set but acceptance not required: old websites that never send the answer still book.
    await request(server)
      .patch(propertyUrl)
      .set('Cookie', ownerCookie)
      .send({ termsUrl: 'https://hotel.test/terms-v1', privacyUrl: 'https://hotel.test/privacy' })
      .expect(200);
    const unasked = await book(base);
    expect(unasked.status).toBe(201);
    const unaskedRow = await admin.$queryRaw<Array<{ at: Date | null; terms: string | null }>>`
      SELECT terms_accepted_at AS at, terms_version_id::text AS terms FROM bookings WHERE id = ${unasked.body.value.id}::uuid`;
    expect(unaskedRow[0]).toEqual({ at: null, terms: null });

    // The hotel now requires acceptance.
    await request(server)
      .patch(propertyUrl)
      .set('Cookie', ownerCookie)
      .send({ requireTermsAcceptance: true })
      .expect(200);
    const refused = await book(base);
    expect(refused.status).toBe(422);
    expect(JSON.stringify(refused.body)).toContain('accept');

    const accepted = await book({ ...base, termsAccepted: true });
    expect(accepted.status).toBe(201);
    const firstVersions = await admin.$queryRaw<
      Array<{ kind: string; version: number; url: string }>
    >`SELECT kind, version, url FROM property_legal_versions WHERE property_id = ${propertyId}::uuid ORDER BY kind, version`;
    expect(firstVersions).toEqual([
      { kind: 'PRIVACY', version: 1, url: 'https://hotel.test/privacy' },
      { kind: 'TERMS', version: 1, url: 'https://hotel.test/terms-v1' },
    ]);

    // The hotel changes its terms: a new version, and the next guest accepts that one.
    await request(server)
      .patch(propertyUrl)
      .set('Cookie', ownerCookie)
      .send({ termsUrl: 'https://hotel.test/terms-v2' })
      .expect(200);
    const second = await book({ ...base, termsAccepted: true });
    expect(second.status).toBe(201);
    const stored = await admin.$queryRaw<
      Array<{ id: string; terms_version: number; privacy_version: number; at: Date | null }>
    >`SELECT b.id::text, t.version AS terms_version, p.version AS privacy_version, b.terms_accepted_at AS at
      FROM bookings b
      JOIN property_legal_versions t ON t.id = b.terms_version_id
      JOIN property_legal_versions p ON p.id = b.privacy_version_id
      WHERE b.id IN (${accepted.body.value.id}::uuid, ${second.body.value.id}::uuid)`;
    const byId = new Map(stored.map((row) => [row.id, row]));
    expect(byId.get(accepted.body.value.id)).toMatchObject({
      terms_version: 1,
      privacy_version: 1,
    });
    expect(byId.get(second.body.value.id)).toMatchObject({ terms_version: 2, privacy_version: 1 });
    expect(byId.get(second.body.value.id)!.at).not.toBeNull();

    // A privacy link must be a full https address.
    await request(server)
      .patch(propertyUrl)
      .set('Cookie', ownerCookie)
      .send({ privacyUrl: 'http://hotel.test/privacy' })
      .expect(400);
  });
});
