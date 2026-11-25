import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTenant } from './helpers/cleanup-tenant';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';
import { withoutExternalWorkers } from './helpers/without-external-workers';

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

/** G-100 S7b-4: the second reminder after the hotel's own days, and the staff notice for a link that ran out. */
describe('payment link second reminder and expiry notice', () => {
  const roomType = randomUUID();
  const ratePlan = randomUUID();
  const booking = randomUUID();
  const operation = randomUUID();
  let app: INestApplication;
  let tenantId = '';
  let propertyId = '';
  let userId = '';

  const second = () =>
    admin.$queryRaw<Array<{ operationId: string }>>`
      SELECT "operationId" FROM payment_link_second_reminder_candidates(500) WHERE "bookingId" = ${booking}::uuid`;
  const expired = () =>
    admin.$queryRaw<Array<{ operationId: string }>>`
      SELECT "operationId" FROM payment_link_expired_candidates(500) WHERE "bookingId" = ${booking}::uuid`;
  const setDays = (days: number | null) =>
    admin.$executeRaw`UPDATE properties SET payment_second_reminder_days = ${days} WHERE tenant_id = ${tenantId}::uuid AND id = ${propertyId}::uuid`;
  const setLink = (expiresAt: Date, extra = '{}') =>
    admin.$executeRaw`UPDATE integration_operations
      SET result = ${JSON.stringify({
        kind: 'balance_collection',
        stage: 'READY',
        checkoutUrl: 'https://pay.test/o/1',
        amount: '170.00',
        currency: 'EUR',
        expiresAt: expiresAt.toISOString(),
      })}::jsonb || ${extra}::jsonb
      WHERE id = ${operation}::uuid`;

  beforeAll(async () => {
    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL =
      'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.WEB_APP_URL = 'http://localhost:3001';
    await clearSignupRateLimits();
    const { AppModule } = await import('../src/app.module');
    app = (
      await withoutExternalWorkers(Test.createTestingModule({ imports: [AppModule] })).compile()
    ).createNestApplication();
    await app.init();
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Link Reminder Group',
        propertyName: 'Link Reminder Hotel',
        propertyAddress: '1 Link Way',
        propertyTimezone: 'Europe/Tirane',
        email: `link-reminder-${randomUUID()}@example.test`,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    propertyId = signup.body.property.id;
    userId = signup.body.user.id;
    await admin.$executeRaw`INSERT INTO room_types(id,tenant_id,property_id,name,max_occupancy) VALUES(${roomType}::uuid,${tenantId}::uuid,${propertyId}::uuid,'Link room',2)`;
    await admin.$executeRaw`INSERT INTO rate_plans(id,tenant_id,property_id,name,currency) VALUES(${ratePlan}::uuid,${tenantId}::uuid,${propertyId}::uuid,'Link rate','EUR')`;
    await admin.$executeRaw`INSERT INTO bookings(id,tenant_id,property_id,room_type_id,rate_plan_id,external_reference,status,starts_on,ends_on,total_amount) VALUES(${booking}::uuid,${tenantId}::uuid,${propertyId}::uuid,${roomType}::uuid,${ratePlan}::uuid,'LINK-1','CONFIRMED'::"BookingStatus",'2027-03-01','2027-03-02',170)`;
    // The link was created and emailed six days ago.
    await admin.$executeRaw`INSERT INTO integration_operations(id,tenant_id,property_id,idempotency_key,aggregate_id,request_hash,status,result,created_at)
      VALUES(${operation}::uuid,${tenantId}::uuid,${propertyId}::uuid,${'collect:' + operation},${booking}::uuid,'hash','COMPLETED','{}'::jsonb, now() - interval '6 days')`;
    await admin.$executeRaw`INSERT INTO email_messages(tenant_id,property_id,booking_id,event_type,recipient_email,subject,idempotency_key,created_at)
      VALUES(${tenantId}::uuid,${propertyId}::uuid,${booking}::uuid,'payment.link','guest@example.test','Pay',${'link-' + operation}, now() - interval '6 days')`;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id=${userId}::uuid`;
    await admin.$disconnect();
  });

  it('finds a link for the second reminder only once the hotel days have passed, and only when set', async () => {
    await setLink(new Date(Date.now() + 3 * 86_400_000));
    await setDays(null);
    expect(await second()).toHaveLength(0);
    await setDays(5);
    expect(await second()).toEqual([{ operationId: operation }]);
    await setDays(8);
    expect(await second()).toHaveLength(0);
  });

  it('does not remind about a link that already ran out, or a booking that is paid', async () => {
    await setDays(5);
    await setLink(new Date(Date.now() - 3_600_000));
    expect(await second()).toHaveLength(0);
    await setLink(new Date(Date.now() + 86_400_000));
    await admin.$executeRaw`INSERT INTO payments(tenant_id,property_id,booking_id,kind,provider,external_payment_id,status,amount,currency)
      VALUES(${tenantId}::uuid,${propertyId}::uuid,${booking}::uuid,'CHARGE','pokpay','paid-1','PAID',170,'EUR')`;
    expect(await second()).toHaveLength(0);
    await admin.$executeRaw`DELETE FROM payments WHERE booking_id = ${booking}::uuid`;
    expect(await second()).toHaveLength(1);
  });

  it('lists a link that ran out unpaid once, and never for a paid booking', async () => {
    await setLink(new Date(Date.now() + 86_400_000));
    expect(await expired()).toHaveLength(0);
    await setLink(new Date(Date.now() - 3_600_000));
    expect(await expired()).toEqual([{ operationId: operation }]);
    await setLink(new Date(Date.now() - 3_600_000), '{"expiryNotified": true}');
    expect(await expired()).toHaveLength(0);
    await setLink(new Date(Date.now() - 3_600_000));
    await admin.$executeRaw`UPDATE bookings SET status = 'CANCELLED'::"BookingStatus" WHERE id = ${booking}::uuid`;
    expect(await expired()).toHaveLength(0);
  });
});
