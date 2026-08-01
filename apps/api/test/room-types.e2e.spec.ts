import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { STORAGE_PROVIDER, type StorageProvider } from '../src/storage/storage.provider';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('room types', () => {
  let app: INestApplication;
  let tenantId: string;
  let propertyId: string;
  let userId: string;
  let cookie: string;
  const email = `room-types-${randomUUID()}@example.test`;
  const password = 'correct-horse-battery-staple';
  let token = '';
  const mail: MailProvider = {
    async sendVerificationEmail(command) {
      token = new URL(command.verificationUrl).searchParams.get('token')!;
    },
    async sendWelcomeEmail() {},
    async sendPasswordResetEmail() {},
    async sendPaymentConfirmationEmail() {},
    async sendRefundConfirmationEmail() {},
  };
  const storage: StorageProvider = {
    async createPresignedUpload(command) {
      return {
        uploadUrl: `https://storage.example.test/upload?key=${encodeURIComponent(command.key)}`,
      };
    },
    publicUrl(key: string) {
      return `https://media.example.test/${key}`;
    },
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
      .overrideProvider(STORAGE_PROVIDER)
      .useValue(storage)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (tenantId) {
      await admin.$executeRaw`DELETE FROM audit_logs WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM room_type_images WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM rooms WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM room_types WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM tenant_memberships WHERE tenant_id = ${tenantId}::uuid`;
    }
    if (propertyId) await admin.$executeRaw`DELETE FROM properties WHERE id = ${propertyId}::uuid`;
    if (tenantId) await admin.$executeRaw`DELETE FROM organizations WHERE id = ${tenantId}::uuid`;
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id = ${userId}::uuid`;
    await app.close();
    await admin.$disconnect();
  });

  it('enforces verified owner/admin CRUD, tenant isolation, and image upload persistence for room types', async () => {
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Room Types Hotel Group',
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

    // Unverified owner is blocked from creating a room type.
    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/room-types`)
      .set('Cookie', cookie)
      .send({ name: 'Deluxe Room', maxOccupancy: 2 })
      .expect(403);

    await request(app.getHttpServer())
      .post('/auth/email-verification/confirm')
      .send({ token })
      .expect(204);

    const created = await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/room-types`)
      .set('Cookie', cookie)
      .send({ name: 'Deluxe Room', description: 'A nice room', maxOccupancy: 2 })
      .expect(201);
    expect(created.body).toMatchObject({
      name: 'Deluxe Room',
      description: 'A nice room',
      maxOccupancy: 2,
    });
    const roomTypeId = created.body.id as string;

    const list = await request(app.getHttpServer())
      .get(`/tenants/${tenantId}/properties/${propertyId}/room-types`)
      .set('Cookie', cookie)
      .expect(200);
    expect(list.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: roomTypeId, name: 'Deluxe Room' })]),
    );

    // Duplicate name for the same property is rejected.
    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/room-types`)
      .set('Cookie', cookie)
      .send({ name: 'Deluxe Room', maxOccupancy: 3 })
      .expect(409);

    // Tenant isolation: a different tenant path is rejected outright.
    await request(app.getHttpServer())
      .post(`/tenants/${randomUUID()}/properties/${propertyId}/room-types`)
      .set('Cookie', cookie)
      .send({ name: 'Outside', maxOccupancy: 2 })
      .expect(403);

    const updated = await request(app.getHttpServer())
      .patch(`/tenants/${tenantId}/properties/${propertyId}/room-types/${roomTypeId}`)
      .set('Cookie', cookie)
      .send({ name: 'Deluxe King Room', description: 'Updated', maxOccupancy: 2 })
      .expect(200);
    expect(updated.body).toMatchObject({ name: 'Deluxe King Room' });

    // Staff role cannot mutate room types.
    await admin.$executeRaw`UPDATE tenant_memberships SET role = 'STAFF' WHERE tenant_id = ${tenantId}::uuid AND user_id = ${userId}::uuid`;
    await request(app.getHttpServer())
      .patch(`/tenants/${tenantId}/properties/${propertyId}/room-types/${roomTypeId}`)
      .set('Cookie', cookie)
      .send({ name: 'Should Fail', maxOccupancy: 2 })
      .expect(403);
    await admin.$executeRaw`UPDATE tenant_memberships SET role = 'OWNER' WHERE tenant_id = ${tenantId}::uuid AND user_id = ${userId}::uuid`;

    // Image upload: request a presigned URL and confirm the record persists and is listable.
    const upload = await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/room-types/${roomTypeId}/images`)
      .set('Cookie', cookie)
      .send({ contentType: 'image/png', contentLength: 1024 })
      .expect(201);
    expect(upload.body.uploadUrl).toContain('https://storage.example.test/upload');
    expect(upload.body.publicUrl).toContain('https://media.example.test/room-types/');

    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/room-types/${roomTypeId}/images`)
      .set('Cookie', cookie)
      .send({ contentType: 'application/pdf', contentLength: 1024 })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/room-types/${roomTypeId}/images`)
      .set('Cookie', cookie)
      .send({ contentType: 'image/png', contentLength: 50 * 1024 * 1024 })
      .expect(400);

    const images = await request(app.getHttpServer())
      .get(`/tenants/${tenantId}/properties/${propertyId}/room-types/${roomTypeId}/images`)
      .set('Cookie', cookie)
      .expect(200);
    expect(images.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: upload.body.id, url: upload.body.publicUrl }),
      ]),
    );

    // Deleting a room type that still has an image is rejected.
    await request(app.getHttpServer())
      .delete(`/tenants/${tenantId}/properties/${propertyId}/room-types/${roomTypeId}`)
      .set('Cookie', cookie)
      .expect(409);

    const logs = await admin.$queryRaw<Array<{ action: string; target_id: string }>>`
      SELECT action, target_id FROM audit_logs WHERE tenant_id = ${tenantId}::uuid
    `;
    expect(logs).toContainEqual({ action: 'room_type.created', target_id: roomTypeId });
    expect(logs).toContainEqual({ action: 'room_type_image.created', target_id: upload.body.id });
  });
});
