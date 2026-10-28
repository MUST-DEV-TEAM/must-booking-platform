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

describe('a cancelled reservation whose Clock bill is still open', () => {
  const roomType = randomUUID();
  const ratePlan = randomUUID();
  const cancelled = randomUUID();
  const live = randomUUID();
  const connection = randomUUID();
  let app: INestApplication;
  let tenantId = '';
  let propertyId = '';
  let userId = '';

  const bill = (balance: string) =>
    ({
      balance: { amount: balance, currency: 'EUR' },
      paid: { amount: '170.00', currency: 'EUR' },
    }) as never;

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
        organizationName: 'Open Bill Group',
        propertyName: 'Open Bill Hotel',
        propertyAddress: '1 Bill Way',
        propertyTimezone: 'Europe/Tirane',
        email: `open-bill-${randomUUID()}@example.test`,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    propertyId = signup.body.property.id;
    userId = signup.body.user.id;
    await admin.$executeRaw`INSERT INTO room_types(id,tenant_id,property_id,name,max_occupancy) VALUES(${roomType}::uuid,${tenantId}::uuid,${propertyId}::uuid,'Bill room',2)`;
    await admin.$executeRaw`INSERT INTO rate_plans(id,tenant_id,property_id,name,currency) VALUES(${ratePlan}::uuid,${tenantId}::uuid,${propertyId}::uuid,'Bill rate','EUR')`;
    await admin.$executeRaw`INSERT INTO integration_connections(id,tenant_id,kind,provider,name,encrypted_credentials,status) VALUES(${connection}::uuid,${tenantId}::uuid,'PMS','CLOCK_PMS','Bill fixture','never-decrypted-test','CONNECTED')`;
    for (const [id, status, ref] of [
      [cancelled, 'CANCELLED', 'BILL-1'],
      [live, 'CONFIRMED', 'BILL-2'],
    ])
      await admin.$executeRaw`INSERT INTO bookings(id,tenant_id,property_id,room_type_id,rate_plan_id,external_reference,status,starts_on,ends_on,total_amount) VALUES(${id}::uuid,${tenantId}::uuid,${propertyId}::uuid,${roomType}::uuid,${ratePlan}::uuid,${ref},${status}::"BookingStatus",'2027-03-01','2027-03-02',170)`;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id=${userId}::uuid`;
    await admin.$disconnect();
  });

  async function readBill(bookingId: string, balance: string) {
    const { ClockFinancialService } =
      await import('../src/integrations/clock/clock-financial.service');
    const { TenantDatabaseService } = await import('../src/tenancy/tenant-database.service');
    const service = app.get(ClockFinancialService) as unknown as {
      checkCancelledBill: (...args: unknown[]) => Promise<void>;
    };
    await app
      .get(TenantDatabaseService)
      .withTenantTransaction({ tenantId, propertyId }, (tx) =>
        service.checkCancelledBill(
          tx,
          { tenantId, propertyId },
          connection,
          bookingId,
          bill(balance),
        ),
      );
  }

  const openNotes = (bookingId: string) =>
    admin.$queryRaw<
      Array<{ message: string }>
    >`SELECT message FROM manual_review_items WHERE tenant_id=${tenantId}::uuid AND reference_id=${bookingId} AND status='OPEN' AND context->>'kind'='CANCELLED_WITH_OPEN_CLOCK_BILL'`;

  async function review(bookingId: string) {
    const { BookingReviewService } = await import('../src/booking/booking-review.service');
    return app.get(BookingReviewService).get(tenantId, propertyId, bookingId, userId);
  }

  it('raises one plain note with what to fix, only for a cancelled reservation', async () => {
    await readBill(cancelled, '170.00');
    await readBill(cancelled, '170.00');
    await readBill(live, '170.00');
    expect(await openNotes(cancelled)).toHaveLength(1);
    expect(await openNotes(live)).toHaveLength(0);

    const shown = await review(cancelled);
    expect(shown.needsReview).toBe(true);
    expect(shown.reasons[0]!.text).toContain("Clock's bill still shows 170.00 EUR to collect");
    expect(shown.reasons[0]!.text).toContain('Run check');
    expect(shown.canAcknowledge).toBe(true);
    expect((await review(live)).canAcknowledge).toBe(false);
  });

  it('lets staff close it with a reason, which is kept in the activity log, and refuses an empty reason', async () => {
    const { BookingReviewService } = await import('../src/booking/booking-review.service');
    const service = app.get(BookingReviewService);
    const scope = { tenantId, propertyId, userId };
    await expect(service.acknowledgeOpenBill(scope, cancelled, { note: 'x' })).rejects.toThrow();
    await service.acknowledgeOpenBill(scope, cancelled, {
      note: 'Cancellation fee kept by the hotel',
    });
    expect(await openNotes(cancelled)).toHaveLength(0);
    await expect(
      service.acknowledgeOpenBill(scope, cancelled, { note: 'Cancellation fee kept by the hotel' }),
    ).rejects.toThrow(/no open bill note/i);
    const audited = await admin.$queryRaw<
      Array<{ details: { note: string } }>
    >`SELECT details FROM audit_logs WHERE tenant_id=${tenantId}::uuid AND target_id=${cancelled} AND action='booking.clock_bill_note_closed'`;
    expect(audited[0]!.details.note).toBe('Cancellation fee kept by the hotel');
  });

  it('closes the note by itself once Clock settles the bill', async () => {
    await readBill(cancelled, '170.00');
    expect(await openNotes(cancelled)).toHaveLength(1);
    await readBill(cancelled, '0.00');
    expect(await openNotes(cancelled)).toHaveLength(0);
    expect((await review(cancelled)).needsReview).toBe(false);
  });
});
