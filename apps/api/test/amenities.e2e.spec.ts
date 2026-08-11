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

describe('amenities', () => {
  let app: INestApplication | undefined;
  let tenantId: string;
  let propertyId: string;
  let userId: string;
  let cookie: string;
  let verificationToken = '';
  const email = `amenities-${randomUUID()}@example.test`;
  const mail: MailProvider = {
    async sendVerificationEmail(command) {
      verificationToken = new URL(command.verificationUrl).searchParams.get('token')!;
    },
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

  it('manages tenant-scoped amenities and room-type tags', async () => {
    const signup = await request(app!.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Amenities Hotel Group',
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
      .post(`${propertyUrl}/amenities`)
      .set('Cookie', cookie)
      .send({ name: 'Wi-Fi' })
      .expect(403);

    await request(app!.getHttpServer())
      .post('/auth/email-verification/confirm')
      .send({ token: verificationToken })
      .expect(204);

    const amenity = await request(app!.getHttpServer())
      .post(`${propertyUrl}/amenities`)
      .set('Cookie', cookie)
      .send({ name: 'Wi-Fi' })
      .expect(201);
    const amenityId = amenity.body.id as string;

    await request(app!.getHttpServer())
      .post(`${propertyUrl}/amenities`)
      .set('Cookie', cookie)
      .send({ name: 'Wi-Fi' })
      .expect(409);

    await request(app!.getHttpServer())
      .post(`/tenants/${randomUUID()}/properties/${propertyId}/amenities`)
      .set('Cookie', cookie)
      .send({ name: 'Outside' })
      .expect(403);

    const roomType = await request(app!.getHttpServer())
      .post(`${propertyUrl}/room-types`)
      .set('Cookie', cookie)
      .send({ name: 'Deluxe Room', maxOccupancy: 2 })
      .expect(201);
    const roomTypeId = roomType.body.id as string;

    const tags = await request(app!.getHttpServer())
      .put(`${propertyUrl}/room-types/${roomTypeId}/amenities`)
      .set('Cookie', cookie)
      .send({ amenityIds: [amenityId] })
      .expect(200);
    expect(tags.body).toEqual([expect.objectContaining({ id: amenityId, name: 'Wi-Fi' })]);

    await request(app!.getHttpServer())
      .delete(`${propertyUrl}/amenities/${amenityId}`)
      .set('Cookie', cookie)
      .expect(409);

    await request(app!.getHttpServer())
      .put(`${propertyUrl}/room-types/${roomTypeId}/amenities`)
      .set('Cookie', cookie)
      .send({ amenityIds: [] })
      .expect(200);

    await admin.$executeRaw`UPDATE tenant_memberships SET role = 'STAFF' WHERE tenant_id = ${tenantId}::uuid AND user_id = ${userId}::uuid`;
    await request(app!.getHttpServer())
      .delete(`${propertyUrl}/amenities/${amenityId}`)
      .set('Cookie', cookie)
      .expect(403);
    await admin.$executeRaw`UPDATE tenant_memberships SET role = 'OWNER' WHERE tenant_id = ${tenantId}::uuid AND user_id = ${userId}::uuid`;

    await request(app!.getHttpServer())
      .delete(`${propertyUrl}/amenities/${amenityId}`)
      .set('Cookie', cookie)
      .expect(204);

    const listed = await request(app!.getHttpServer())
      .get(`${propertyUrl}/amenities`)
      .set('Cookie', cookie)
      .expect(200);
    expect(listed.body).not.toContainEqual(expect.objectContaining({ id: amenityId }));

    const logs = await admin.$queryRaw<Array<{ action: string; target_id: string }>>`
      SELECT action, target_id FROM audit_logs WHERE tenant_id = ${tenantId}::uuid
    `;
    expect(logs).toContainEqual({ action: 'amenity.created', target_id: amenityId });
    expect(logs).toContainEqual({ action: 'room_type.amenities_updated', target_id: roomTypeId });
    expect(logs).toContainEqual({ action: 'amenity.deleted', target_id: amenityId });
  });
});
