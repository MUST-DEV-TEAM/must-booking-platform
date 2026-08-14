import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { cleanupTenant } from './helpers/cleanup-tenant';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';

const hasSandboxCredentials =
  !!process.env.CLOCK_SANDBOX_API_USER &&
  !!process.env.CLOCK_SANDBOX_API_KEY &&
  !!process.env.CLOCK_SANDBOX_PMS_API_URL;

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe.skipIf(!hasSandboxCredentials)('Clock catalog sync (real sandbox)', () => {
  let app: INestApplication | undefined;
  let tenantId: string;
  let propertyId: string;
  let userId: string;
  let pmsPlanId: string;
  let cookie: string;
  let verificationToken = '';
  const email = `clock-catalog-${randomUUID()}@example.test`;
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
    if (pmsPlanId) await admin.$executeRaw`DELETE FROM plans WHERE id = ${pmsPlanId}::uuid`;
    if (app) await app.close();
    await admin.$disconnect();
  });

  it('syncs real Clock room types/rooms, stages proposals, and confirms them into the local catalog', async () => {
    const signup = await request(app!.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Clock Catalog Hotel',
        propertyName: 'Main Property',
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
    await request(app!.getHttpServer())
      .post('/auth/email-verification/confirm')
      .send({ token: verificationToken })
      .expect(204);

    pmsPlanId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO plans (id, name, max_properties, max_staff_seats, pms_enabled, max_pms_connections_per_property)
      VALUES (${pmsPlanId}::uuid, ${'Clock Catalog Test Plan ' + pmsPlanId}, 10, 10, true, 5)
    `;
    await admin.$executeRaw`UPDATE organizations SET plan_id = ${pmsPlanId}::uuid WHERE id = ${tenantId}::uuid`;

    const url = new URL(process.env.CLOCK_SANDBOX_PMS_API_URL!);
    const [, , accountId, subscriptionId] = url.pathname.split('/');
    const tenantUrl = `/tenants/${tenantId}`;

    const connection = await request(app!.getHttpServer())
      .post(`${tenantUrl}/integration-connections`)
      .set('Cookie', cookie)
      .send({
        kind: 'PMS',
        provider: 'CLOCK_PMS',
        name: 'Sandbox Clock',
        credentials: {
          host: url.host,
          accountId,
          subscriptionId,
          apiUser: process.env.CLOCK_SANDBOX_API_USER!,
          apiKey: process.env.CLOCK_SANDBOX_API_KEY!,
        },
      })
      .expect(201);
    await request(app!.getHttpServer())
      .patch(`${tenantUrl}/properties/${propertyId}/integration-connections/${connection.body.id}`)
      .set('Cookie', cookie)
      .send({ enabled: true })
      .expect(200);

    const synced = await request(app!.getHttpServer())
      .post(`${tenantUrl}/properties/${propertyId}/clock-catalog/sync`)
      .set('Cookie', cookie)
      .expect(201);
    expect(synced.body.proposed + synced.body.updated).toBeGreaterThan(0);

    const mappings = await request(app!.getHttpServer())
      .get(`${tenantUrl}/properties/${propertyId}/clock-catalog/mappings`)
      .set('Cookie', cookie)
      .expect(200);
    expect(mappings.body.length).toBeGreaterThan(0);
    const roomTypeMapping = mappings.body.find(
      (m: { entityType: string }) => m.entityType === 'ROOM_TYPE',
    );
    expect(roomTypeMapping).toBeDefined();
    expect(roomTypeMapping.syncStatus).toBe('PROPOSED');

    await request(app!.getHttpServer())
      .post(
        `${tenantUrl}/properties/${propertyId}/clock-catalog/mappings/${roomTypeMapping.id}/confirm`,
      )
      .set('Cookie', cookie)
      .expect(201);

    const localRoomTypes = await admin.$queryRaw<Array<{ name: string }>>`
      SELECT name FROM room_types WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
    `;
    expect(localRoomTypes).toContainEqual({ name: roomTypeMapping.externalName });

    const roomMapping = mappings.body.find(
      (m: { entityType: string; externalParentId: string | null }) =>
        m.entityType === 'ROOM' && m.externalParentId === roomTypeMapping.externalEntityId,
    );
    if (roomMapping) {
      await request(app!.getHttpServer())
        .post(
          `${tenantUrl}/properties/${propertyId}/clock-catalog/mappings/${roomMapping.id}/confirm`,
        )
        .set('Cookie', cookie)
        .expect(201);
      const localRooms = await admin.$queryRaw<Array<{ name: string }>>`
        SELECT name FROM rooms WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
      `;
      expect(localRooms).toContainEqual({ name: roomMapping.externalName });
    }
  }, 30_000);
});
