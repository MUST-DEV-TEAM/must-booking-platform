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

describe('rooms', () => {
  let app: INestApplication;
  let tenantId: string;
  let propertyId: string;
  let roomTypeId: string;
  let userId: string;
  let cookie: string;
  const email = `rooms-${randomUUID()}@example.test`;
  const password = 'correct-horse-battery-staple';
  let token = '';
  const mail: MailProvider = {
    async sendVerificationEmail(command) {
      token = new URL(command.verificationUrl).searchParams.get('token')!;
    },
    async sendWelcomeEmail() {},
    async sendPasswordResetEmail() {},
    async sendStaffInvitationEmail() {},
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
    await app.close();
    await admin.$disconnect();
  });

  it('enforces verified owner/admin CRUD and tenant/room-type scoping for physical rooms', async () => {
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Rooms Hotel Group',
        propertyName: 'First Property',
        propertyAddress: '1 Main Street',
        propertyTimezone: 'Europe/Tirane',
        email,
        password,
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    propertyId = signup.body.property.id;
    userId = signup.body.user.id;
    cookie = signup.headers['set-cookie'][0];

    await request(app.getHttpServer())
      .post('/auth/email-verification/confirm')
      .send({ token })
      .expect(204);

    const roomType = await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/room-types`)
      .set('Cookie', cookie)
      .send({ name: 'Standard Room', maxOccupancy: 2 })
      .expect(201);
    roomTypeId = roomType.body.id;

    // A room-type ID that doesn't belong to this property is rejected with 404, not a raw DB error.
    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/room-types/${randomUUID()}/rooms`)
      .set('Cookie', cookie)
      .send({ name: 'Room 101' })
      .expect(404);

    const created = await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/room-types/${roomTypeId}/rooms`)
      .set('Cookie', cookie)
      .send({ name: 'Room 101' })
      .expect(201);
    const roomId = created.body.id as string;

    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/room-types/${roomTypeId}/rooms`)
      .set('Cookie', cookie)
      .send({ name: 'Room 101' })
      .expect(409);

    const list = await request(app.getHttpServer())
      .get(`/tenants/${tenantId}/properties/${propertyId}/room-types/${roomTypeId}/rooms`)
      .set('Cookie', cookie)
      .expect(200);
    expect(list.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: roomId, name: 'Room 101' })]),
    );

    await request(app.getHttpServer())
      .patch(
        `/tenants/${tenantId}/properties/${propertyId}/room-types/${roomTypeId}/rooms/${roomId}`,
      )
      .set('Cookie', cookie)
      .send({ name: 'Room 102' })
      .expect(200);

    await admin.$executeRaw`UPDATE tenant_memberships SET role = 'STAFF' WHERE tenant_id = ${tenantId}::uuid AND user_id = ${userId}::uuid`;
    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/room-types/${roomTypeId}/rooms`)
      .set('Cookie', cookie)
      .send({ name: 'Should Fail' })
      .expect(403);
    await admin.$executeRaw`UPDATE tenant_memberships SET role = 'OWNER' WHERE tenant_id = ${tenantId}::uuid AND user_id = ${userId}::uuid`;

    await request(app.getHttpServer())
      .delete(
        `/tenants/${tenantId}/properties/${propertyId}/room-types/${roomTypeId}/rooms/${roomId}`,
      )
      .set('Cookie', cookie)
      .expect(204);

    // Now the room type can be deleted since it has no remaining rooms.
    await request(app.getHttpServer())
      .delete(`/tenants/${tenantId}/properties/${propertyId}/room-types/${roomTypeId}`)
      .set('Cookie', cookie)
      .expect(204);

    const logs = await admin.$queryRaw<Array<{ action: string; target_id: string }>>`
      SELECT action, target_id FROM audit_logs WHERE tenant_id = ${tenantId}::uuid
    `;
    expect(logs).toContainEqual({ action: 'room.created', target_id: roomId });
    expect(logs).toContainEqual({ action: 'room.deleted', target_id: roomId });
    expect(logs).toContainEqual({ action: 'room_type.deleted', target_id: roomTypeId });
  });
});
