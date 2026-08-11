import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { LocalDemoSeedService } from '../src/tenancy/local-demo-seed.service';
import { cleanupTenant } from './helpers/cleanup-tenant';

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('local demo seed', () => {
  let app: INestApplication;
  let tenantId = '';
  let ownerUserId = '';
  let ownerEmail = '';
  let planId = '';
  let previousNodeEnv: string | undefined;
  let previousAllow: string | undefined;
  const mail: MailProvider = {
    async sendVerificationEmail() {},
    async sendWelcomeEmail() {},
    async sendPasswordResetEmail() {},
    async sendPaymentConfirmationEmail() {},
    async sendNewBookingStaffNotification() {},
    async sendRefundConfirmationEmail() {},
  };

  beforeAll(async () => {
    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL =
      'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.WEB_APP_URL = 'http://localhost:3001';
    previousNodeEnv = process.env.NODE_ENV;
    previousAllow = process.env.ALLOW_LOCAL_DEMO_SEED;
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_LOCAL_DEMO_SEED = 'true';
    const { AppModule } = await import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_PROVIDER)
      .useValue(mail)
      .compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (ownerUserId) await admin.$executeRaw`DELETE FROM users WHERE id = ${ownerUserId}::uuid`;
    if (planId) await admin.$executeRaw`DELETE FROM plans WHERE id = ${planId}::uuid`;
    process.env.NODE_ENV = previousNodeEnv;
    process.env.ALLOW_LOCAL_DEMO_SEED = previousAllow;
    await app.close();
    await admin.$disconnect();
  });

  it('creates dense demo data once and leaves reports populated on a second run', async () => {
    ownerEmail = `local-demo-owner-${randomUUID()}@example.test`;
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Local demo seed tenant',
        propertyName: 'Original property',
        propertyAddress: '1 Original Street',
        propertyTimezone: 'Europe/Tirane',
        email: ownerEmail,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    ownerUserId = signup.body.user.id;
    planId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO plans (id, name, max_properties, max_staff_seats, pms_enabled, max_pms_connections_per_property)
      VALUES (${planId}::uuid, ${`Local demo ${planId}`}, 2, 3, false, 0)
    `;
    await admin.$executeRaw`UPDATE organizations SET plan_id = ${planId}::uuid WHERE id = ${tenantId}::uuid`;

    const seed = app.get(LocalDemoSeedService);
    const first = await seed.seed(tenantId, ownerUserId);
    expect(first.property.created).toBe(true);
    expect(first.provisionedStaff).toHaveLength(3);
    expect(first.provisionedStaff.every((account) => account.password)).toBe(true);
    expect(first.createdBookings).toBeGreaterThan(12);
    await expect(paymentKinds(tenantId, first.property.id)).resolves.toEqual(
      expect.arrayContaining([
        { kind: 'CHARGE', count: expect.any(Number) },
        { kind: 'REFUND', count: expect.any(Number) },
      ]),
    );

    const reports = await app
      .get((await import('../src/tenancy/reports.service')).ReportsService)
      .get(tenantId, first.property.id, { from: dateFromToday(-30), to: dateFromToday(30) });
    expect(reports.occupancy.some((day) => day.rate !== null && day.bookedRoomNights > 0)).toBe(
      true,
    );
    expect(reports.bookingsCreated.reduce((sum, day) => sum + day.count, 0)).toBeGreaterThan(0);
    expect(reports.revenue.some((day) => Number(day.amount) > 0)).toBe(true);
    expect(reports.cancellationRate.rate).not.toBeNull();

    const countBefore = await bookingCount(tenantId, first.property.id);
    const second = await seed.seed(tenantId, ownerUserId);
    expect(second.property).toEqual({ ...first.property, created: false });
    expect(second.createdBookings).toBe(0);
    expect(second.reusedBookings).toBe(first.createdBookings);
    await expect(bookingCount(tenantId, first.property.id)).resolves.toBe(countBefore);
  });
});

const bookingCount = async (tenantId: string, propertyId: string) => {
  const rows = await admin.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*) AS count FROM bookings
    WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
  `;
  return Number(rows[0].count);
};

const paymentKinds = async (tenantId: string, propertyId: string) =>
  admin.$queryRaw<Array<{ kind: string; count: number }>>`
    SELECT kind::text AS kind, count(*)::int AS count
    FROM payments
    WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
    GROUP BY kind
  `;

const dateFromToday = (offset: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};
