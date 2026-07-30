import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { AvailabilityService } from '../src/tenancy/availability.service';
import { TenantDatabaseService } from '../src/tenancy/tenant-database.service';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('local availability', () => {
  let app: INestApplication | undefined;
  let tenantId: string;
  let propertyId: string;
  let userId: string;
  let cookie: string;
  let verificationToken = '';
  const email = `availability-${randomUUID()}@example.test`;
  const mail: MailProvider = {
    async sendVerificationEmail(command) {
      verificationToken = new URL(command.verificationUrl).searchParams.get('token')!;
    },
    async sendWelcomeEmail() {},
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
    if (tenantId) {
      await admin.$executeRaw`DELETE FROM audit_logs WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM inventory_units WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM room_types WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM tenant_memberships WHERE tenant_id = ${tenantId}::uuid`;
    }
    if (propertyId) await admin.$executeRaw`DELETE FROM properties WHERE id = ${propertyId}::uuid`;
    if (tenantId) await admin.$executeRaw`DELETE FROM organizations WHERE id = ${tenantId}::uuid`;
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id = ${userId}::uuid`;
    if (app) await app.close();
    await admin.$disconnect();
  });

  it('answers availability exclusively from local per-night inventory', async () => {
    const signup = await request(app!.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Availability Hotel Group',
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
    const propertyUrl = `/tenants/${tenantId}/properties/${propertyId}`;

    await request(app!.getHttpServer())
      .post('/auth/email-verification/confirm')
      .send({ token: verificationToken })
      .expect(204);

    const roomType = await request(app!.getHttpServer())
      .post(`${propertyUrl}/room-types`)
      .set('Cookie', cookie)
      .send({ name: 'Deluxe Room', maxOccupancy: 2 })
      .expect(201);
    const roomTypeId = roomType.body.id as string;
    const availabilityService = app!.get(AvailabilityService);
    const database = app!.get(TenantDatabaseService);

    const unavailable = await request(app!.getHttpServer())
      .get(`${propertyUrl}/availability`)
      .set('Cookie', cookie)
      .query({ roomTypeId, startsOn: '2026-08-01', endsOn: '2026-08-02' })
      .expect(200);
    expect(unavailable.body).toMatchObject({ isAvailable: false, availableUnits: 0 });

    await request(app!.getHttpServer())
      .put(`${propertyUrl}/inventory-units`)
      .set('Cookie', cookie)
      .send({ roomTypeId, startsOn: '2026-08-01', endsOn: '2026-08-04', availableUnits: 2 })
      .expect(204);

    const singleNightAvailable = await request(app!.getHttpServer())
      .get(`${propertyUrl}/availability`)
      .set('Cookie', cookie)
      .query({ roomTypeId, startsOn: '2026-08-01', endsOn: '2026-08-02' })
      .expect(200);
    expect(singleNightAvailable.body).toMatchObject({ isAvailable: true, availableUnits: 2 });

    await database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await expect(
        availabilityService.reserveBookedUnits(tx, tenantId, propertyId, {
          roomTypeId,
          startsOn: '2026-08-01',
          endsOn: '2026-08-04',
          units: 1,
        }),
      ).resolves.toBe(true);
    });

    const availableAfterReservation = await request(app!.getHttpServer())
      .get(`${propertyUrl}/availability`)
      .set('Cookie', cookie)
      .query({ roomTypeId, startsOn: '2026-08-01', endsOn: '2026-08-04' })
      .expect(200);
    expect(availableAfterReservation.body).toMatchObject({ isAvailable: true, availableUnits: 1 });

    await database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await availabilityService.releaseBookedUnits(tx, tenantId, propertyId, {
        roomTypeId,
        startsOn: '2026-08-01',
        endsOn: '2026-08-04',
        units: 1,
      });
    });

    const availableAfterRelease = await request(app!.getHttpServer())
      .get(`${propertyUrl}/availability`)
      .set('Cookie', cookie)
      .query({ roomTypeId, startsOn: '2026-08-01', endsOn: '2026-08-04' })
      .expect(200);
    expect(availableAfterRelease.body).toMatchObject({ isAvailable: true, availableUnits: 2 });

    await database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await expect(
        availabilityService.reserveBookedUnits(tx, tenantId, propertyId, {
          roomTypeId,
          startsOn: '2026-08-01',
          endsOn: '2026-08-04',
          units: 3,
        }),
      ).resolves.toBe(false);
    });

    const unavailableReservationDidNotPartiallyApply = await request(app!.getHttpServer())
      .get(`${propertyUrl}/availability`)
      .set('Cookie', cookie)
      .query({ roomTypeId, startsOn: '2026-08-01', endsOn: '2026-08-04' })
      .expect(200);
    expect(unavailableReservationDidNotPartiallyApply.body).toMatchObject({
      isAvailable: true,
      availableUnits: 2,
    });

    await request(app!.getHttpServer())
      .put(`${propertyUrl}/inventory-units`)
      .set('Cookie', cookie)
      .send({ roomTypeId, startsOn: '2026-08-02', endsOn: '2026-08-04', availableUnits: 1 })
      .expect(204);

    const overlapUpdate = await request(app!.getHttpServer())
      .get(`${propertyUrl}/availability`)
      .set('Cookie', cookie)
      .query({ roomTypeId, startsOn: '2026-08-01', endsOn: '2026-08-04' })
      .expect(200);
    expect(overlapUpdate.body).toMatchObject({ isAvailable: true, availableUnits: 1 });

    const nonOverlappingFirstNight = await request(app!.getHttpServer())
      .get(`${propertyUrl}/availability`)
      .set('Cookie', cookie)
      .query({ roomTypeId, startsOn: '2026-08-01', endsOn: '2026-08-02' })
      .expect(200);
    expect(nonOverlappingFirstNight.body).toMatchObject({ isAvailable: true, availableUnits: 2 });

    await request(app!.getHttpServer())
      .put(`${propertyUrl}/inventory-units`)
      .set('Cookie', cookie)
      .send({ roomTypeId, startsOn: '2026-08-02', endsOn: '2026-08-03', availableUnits: 0 })
      .expect(204);

    const rangeWithNoInventory = await request(app!.getHttpServer())
      .get(`${propertyUrl}/availability`)
      .set('Cookie', cookie)
      .query({ roomTypeId, startsOn: '2026-08-01', endsOn: '2026-08-03' })
      .expect(200);
    expect(rangeWithNoInventory.body).toMatchObject({ isAvailable: false, availableUnits: 0 });

    const singleNightZeroInventory = await request(app!.getHttpServer())
      .get(`${propertyUrl}/availability`)
      .set('Cookie', cookie)
      .query({ roomTypeId, startsOn: '2026-08-02', endsOn: '2026-08-03' })
      .expect(200);
    expect(singleNightZeroInventory.body).toMatchObject({ isAvailable: false, availableUnits: 0 });

    await request(app!.getHttpServer())
      .get(`${propertyUrl}/availability`)
      .set('Cookie', cookie)
      .query({ roomTypeId, startsOn: '2026-08-02', endsOn: '2026-08-02' })
      .expect(400);

    await request(app!.getHttpServer())
      .get(`/tenants/${randomUUID()}/properties/${propertyId}/availability`)
      .set('Cookie', cookie)
      .query({ roomTypeId, startsOn: '2026-08-01', endsOn: '2026-08-02' })
      .expect(403);

    await admin.$executeRaw`UPDATE tenant_memberships SET role = 'STAFF' WHERE tenant_id = ${tenantId}::uuid AND user_id = ${userId}::uuid`;
    await request(app!.getHttpServer())
      .put(`${propertyUrl}/inventory-units`)
      .set('Cookie', cookie)
      .send({ roomTypeId, startsOn: '2026-08-01', endsOn: '2026-08-02', availableUnits: 1 })
      .expect(403);

    const logs = await admin.$queryRaw<Array<{ action: string; target_id: string }>>`
      SELECT action, target_id FROM audit_logs WHERE tenant_id = ${tenantId}::uuid
    `;
    expect(logs).toContainEqual({ action: 'inventory_units.set', target_id: roomTypeId });
  });
});
