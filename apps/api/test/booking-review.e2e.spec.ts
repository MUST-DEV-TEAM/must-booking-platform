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

describe('staff view of a booking that needs review', () => {
  const email = `review-${randomUUID()}@example.test`;
  const roomType = randomUUID();
  const ratePlan = randomUUID();
  const needsReview = randomUUID();
  const fine = randomUUID();
  let app: INestApplication;
  let tenantId = '';
  let propertyId = '';
  let userId = '';
  let cookie = '';
  const base = () => `/tenants/${tenantId}/properties/${propertyId}/bookings`;

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
        organizationName: 'Review Fixture Group',
        propertyName: 'Review Fixture Hotel',
        propertyAddress: '1 Review Way',
        propertyTimezone: 'Europe/Tirane',
        email,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    propertyId = signup.body.property.id;
    userId = signup.body.user.id;
    cookie = signup.headers['set-cookie'][0];
    await admin.$executeRaw`INSERT INTO room_types(id,tenant_id,property_id,name,max_occupancy) VALUES(${roomType}::uuid,${tenantId}::uuid,${propertyId}::uuid,'Review room',2)`;
    await admin.$executeRaw`INSERT INTO rate_plans(id,tenant_id,property_id,name,currency) VALUES(${ratePlan}::uuid,${tenantId}::uuid,${propertyId}::uuid,'Review rate','EUR')`;
    for (const [id, status, ref] of [
      [needsReview, 'MANUAL_REVIEW', 'REV-1'],
      [fine, 'CONFIRMED', 'REV-2'],
    ])
      await admin.$executeRaw`INSERT INTO bookings(id,tenant_id,property_id,room_type_id,rate_plan_id,external_reference,status,starts_on,ends_on,total_amount) VALUES(${id}::uuid,${tenantId}::uuid,${propertyId}::uuid,${roomType}::uuid,${ratePlan}::uuid,${ref},${status}::"BookingStatus",'2027-03-01','2027-03-03',100)`;
    await admin.$executeRaw`INSERT INTO manual_review_items(tenant_id,property_id,category,reference_type,reference_id,message) VALUES(${tenantId}::uuid,${propertyId}::uuid,'UNKNOWN_RESULT'::"ManualReviewCategory",'booking',${needsReview},'technical detail that staff must not see')`;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id=${userId}::uuid`;
    await admin.$disconnect();
  });

  it('explains a booking that needs review in plain words, without technical detail', async () => {
    const res = await request(app.getHttpServer())
      .get(`${base()}/${needsReview}/review`)
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.needsReview).toBe(true);
    expect(res.body.reasons).toHaveLength(1);
    expect(res.body.reasons[0].text).toContain('did not confirm this booking');
    expect(JSON.stringify(res.body)).not.toContain('technical detail');
    const ok = await request(app.getHttpServer())
      .get(`${base()}/${fine}/review`)
      .set('Cookie', cookie)
      .expect(200);
    expect(ok.body).toMatchObject({ needsReview: false, reasons: [] });
  });

  it('explains a posted Clock refund document follow-up without calling it a mismatch', async () => {
    const message =
      'Clock refund payment was posted. In Clock, issue the Deposit Adjustment to create the required correction document.';
    await admin.$executeRaw`INSERT INTO manual_review_items(tenant_id,property_id,category,reference_type,reference_id,message,context) VALUES(${tenantId}::uuid,${propertyId}::uuid,'PAYMENT_BOOKING_MISMATCH'::"ManualReviewCategory",'booking',${fine},${message},${JSON.stringify({ message })}::jsonb)`;
    try {
      const res = await request(app.getHttpServer())
        .get(`${base()}/${fine}/review`)
        .set('Cookie', cookie)
        .expect(200);
      expect(res.body.reasons[0].text).toBe(
        'Refund posted to Clock. Complete the Deposit Adjustment document in Clock.',
      );
      expect(res.body.reasons[0].text).not.toContain('do not agree');
    } finally {
      await admin.$executeRaw`DELETE FROM manual_review_items WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND reference_id=${fine}`;
    }
  });

  it('cannot run a provider check at a hotel without an external system, and is scoped', async () => {
    await request(app.getHttpServer())
      .post(`${base()}/${needsReview}/review/check`)
      .set('Cookie', cookie)
      .expect(403);
    await admin.$executeRaw`UPDATE users SET email_verified_at=now() WHERE id=${userId}::uuid`;
    const check = await request(app.getHttpServer())
      .post(`${base()}/${needsReview}/review/check`)
      .set('Cookie', cookie)
      .expect(200);
    expect(check.body.result).toBe('unavailable');
    await request(app.getHttpServer())
      .get(`${base()}/${randomUUID()}/review`)
      .set('Cookie', cookie)
      .expect(404);
    await request(app.getHttpServer()).get(`${base()}/${needsReview}/review`).expect(401);
  });
  it('closes only failed unpaid attempts, keeps history, and resurfaces changed bookings', async () => {
    await admin.$executeRaw`UPDATE users SET email_verified_at=now() WHERE id=${userId}::uuid`;
    await request(app.getHttpServer())
      .post(`${base()}/${needsReview}/review/dismiss`)
      .set('Cookie', cookie)
      .send({ note: 'Reviewed uncertain result' })
      .expect(409);
    await admin.$executeRaw`UPDATE bookings SET status='AVAILABILITY_FAILED',version=version+1 WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${fine}::uuid`;
    const search = () =>
      request(app.getHttpServer())
        .get(`${base()}/search?view=needs_attention`)
        .set('Cookie', cookie)
        .expect(200);
    expect((await search()).body.items.some((b: { id: string }) => b.id === fine)).toBe(true);
    await request(app.getHttpServer())
      .post(`${base()}/${fine}/review/dismiss`)
      .set('Cookie', cookie)
      .send({ note: 'No reservation created; test attempt reviewed' })
      .expect(200);
    expect((await search()).body.items.some((b: { id: string }) => b.id === fine)).toBe(false);
    const row = await admin.$queryRaw<
      Array<{ status: string; count: number }>
    >`SELECT b.status::text AS status,(SELECT COUNT(*)::int FROM audit_logs a WHERE a.tenant_id=b.tenant_id AND a.property_id=b.property_id AND a.target_id=b.id::text AND a.action='booking.attention_dismissed') AS count FROM bookings b WHERE b.tenant_id=${tenantId}::uuid AND b.property_id=${propertyId}::uuid AND b.id=${fine}::uuid`;
    expect(row[0]).toEqual({ status: 'AVAILABILITY_FAILED', count: 1 });
    await admin.$executeRaw`UPDATE bookings SET version=version+1 WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${fine}::uuid`;
    expect((await search()).body.items.some((b: { id: string }) => b.id === fine)).toBe(true);
    await admin.$executeRaw`INSERT INTO payments(tenant_id,property_id,booking_id,kind,provider,external_payment_id,status,amount,currency) VALUES(${tenantId}::uuid,${propertyId}::uuid,${fine}::uuid,'CHARGE','manual',${'review-money-' + fine},'succeeded',10,'EUR')`;
    await request(app.getHttpServer())
      .post(`${base()}/${fine}/review/dismiss`)
      .set('Cookie', cookie)
      .send({ note: 'Money held must remain visible' })
      .expect(409);
  });
  it('keeps Clock guest profiles without email and enforces property RLS', async () => {
    const connection = randomUUID();
    await admin.$executeRaw`INSERT INTO integration_connections(id,tenant_id,kind,provider,name,encrypted_credentials,status) VALUES(${connection}::uuid,${tenantId}::uuid,'PMS','CLOCK_PMS','Projection fixture','never-decrypted-test','CONNECTED')`;
    await admin.$executeRaw`INSERT INTO property_integration_connections(tenant_id,property_id,connection_id,kind) VALUES(${tenantId}::uuid,${propertyId}::uuid,${connection}::uuid,'PMS')`;
    await admin.$executeRaw`INSERT INTO clock_guest_profiles(tenant_id,property_id,connection_id,external_guest_id,first_name) VALUES(${tenantId}::uuid,${propertyId}::uuid,${connection}::uuid,'123','No Email Guest')`;
    const profiles = await request(app.getHttpServer())
      .get(`/tenants/${tenantId}/properties/${propertyId}/clock-guests`)
      .set('Cookie', cookie)
      .expect(200);
    expect(profiles.body).toHaveLength(1);
    expect(profiles.body[0]).toMatchObject({ firstName: 'No Email Guest', email: null });
    const { TenantDatabaseService } = await import('../src/tenancy/tenant-database.service');
    const hidden = await app
      .get(TenantDatabaseService)
      .withTenantTransaction(
        { tenantId, propertyId: randomUUID() },
        (tx) => tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM clock_guest_profiles`,
      );
    expect(hidden).toEqual([]);
  });
});
