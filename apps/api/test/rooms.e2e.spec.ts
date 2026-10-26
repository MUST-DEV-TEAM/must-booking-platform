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

    const categoriesUrl = `/tenants/${tenantId}/properties/${propertyId}/room-categories`;
    const category = await request(app.getHttpServer())
      .post(categoriesUrl)
      .set('Cookie', cookie)
      .send({ name: 'Suites', description: 'Large guest rooms.' })
      .expect(201);
    const categoryId = category.body.id as string;
    expect(category.body.updatedAt).toEqual(expect.any(String));
    await request(app.getHttpServer())
      .post(categoriesUrl)
      .set('Cookie', cookie)
      .send({ name: ' suites ' })
      .expect(409);
    await request(app.getHttpServer())
      .post(categoriesUrl)
      .set('Cookie', cookie)
      .send({ name: 'x'.repeat(201) })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`${categoriesUrl}/${randomUUID()}`)
      .set('Cookie', cookie)
      .send({ storefrontVisible: false })
      .expect(404);
    await request(app.getHttpServer())
      .put(`${categoriesUrl}/order`)
      .set('Cookie', cookie)
      .send({ categoryIds: [randomUUID()] })
      .expect(400);
    const concurrent = await Promise.all(
      ['Garden', 'garden'].map((name) =>
        request(app.getHttpServer()).post(categoriesUrl).set('Cookie', cookie).send({ name }),
      ),
    );
    expect(concurrent.map((r) => r.status).sort()).toEqual([201, 409]);
    const gardenId = concurrent.find((r) => r.status === 201)!.body.id;
    await request(app.getHttpServer())
      .patch(`${categoriesUrl}/${gardenId}`)
      .set('Cookie', cookie)
      .send({ name: 'SUITES' })
      .expect(409);
    await request(app.getHttpServer())
      .delete(`${categoriesUrl}/${gardenId}`)
      .set('Cookie', cookie)
      .expect(204);
    await request(app.getHttpServer())
      .get(categoriesUrl)
      .set('Cookie', cookie)
      .expect((r) => expect(r.body.map((c: { sortOrder: number }) => c.sortOrder)).toEqual([0]));

    await request(app.getHttpServer())
      .patch(`/tenants/${tenantId}/properties/${propertyId}/room-types/${roomTypeId}`)
      .set('Cookie', cookie)
      .send({ name: 'Standard Room', maxOccupancy: 2, categoryId })
      .expect(200);
    const typeList = await request(app.getHttpServer())
      .get(`/tenants/${tenantId}/properties/${propertyId}/room-types`)
      .set('Cookie', cookie)
      .expect(200);
    expect(typeList.body[0]).toMatchObject({
      categoryId,
      categoryName: 'Suites',
      readiness: {
        missingCount: 4,
        firstFix: { key: 'basicInfo', label: 'Add details' },
      },
    });
    const categoryList = await request(app.getHttpServer())
      .get(categoriesUrl)
      .set('Cookie', cookie)
      .expect(200);
    expect(categoryList.body).toContainEqual(
      expect.objectContaining({ id: categoryId, roomCount: 1, storefrontVisible: true }),
    );
    await request(app.getHttpServer())
      .put(`${categoriesUrl}/order`)
      .set('Cookie', cookie)
      .send({ categoryIds: [categoryId] })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`${categoriesUrl}/${categoryId}`)
      .set('Cookie', cookie)
      .send({ storefrontVisible: false })
      .expect(200);
    const hiddenCategoryCatalog = await request(app.getHttpServer())
      .get(`/tenants/${tenantId}/properties/${propertyId}/public/catalog`)
      .expect(200);
    expect(hiddenCategoryCatalog.body.roomTypes[0].category).toBeNull();
    await request(app.getHttpServer())
      .patch(`${categoriesUrl}/${categoryId}`)
      .set('Cookie', cookie)
      .send({ storefrontVisible: true })
      .expect(200);
    const visibleCategoryCatalog = await request(app.getHttpServer())
      .get(`/tenants/${tenantId}/properties/${propertyId}/public/catalog`)
      .expect(200);
    expect(visibleCategoryCatalog.body.roomTypes[0].category).toMatchObject({
      id: categoryId,
      name: 'Suites',
      sortOrder: 0,
    });

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
      expect.arrayContaining([
        expect.objectContaining({ id: roomId, name: 'Room 101', isActive: true }),
      ]),
    );

    const importUrl = `/tenants/${tenantId}/properties/${propertyId}/accommodations/import`;
    const roomImport = {
      kind: 'rooms',
      rows: [
        {
          id: roomId,
          roomTypeId,
          roomTypeName: 'Standard Room',
          name: 'Room 101',
          title: 'CSV-updated title',
          isActive: 'true',
        },
        {
          roomTypeId,
          roomTypeName: 'Standard Room',
          name: 'Room 103',
          title: 'New room from CSV',
          isActive: 'false',
        },
      ],
    };
    await request(app.getHttpServer())
      .post(`${importUrl}/preview`)
      .set('Cookie', cookie)
      .send(roomImport)
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          kind: 'rooms',
          summary: { create: 1, update: 1, errors: 0 },
          canConfirm: true,
        });
      });
    await request(app.getHttpServer())
      .post(`${importUrl}/confirm`)
      .set('Cookie', cookie)
      .send(roomImport)
      .expect(201, { create: 1, update: 1, errors: 0 });
    const importedRooms = await request(app.getHttpServer())
      .get(`/tenants/${tenantId}/properties/${propertyId}/room-types/${roomTypeId}/rooms`)
      .set('Cookie', cookie)
      .expect(200);
    expect(importedRooms.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: roomId, title: 'CSV-updated title', isActive: true }),
        expect.objectContaining({ name: 'Room 103', title: 'New room from CSV', isActive: false }),
      ]),
    );
    const importedRoomId = importedRooms.body.find(
      (room: { name: string }) => room.name === 'Room 103',
    )?.id as string;
    await request(app.getHttpServer())
      .delete(
        `/tenants/${tenantId}/properties/${propertyId}/room-types/${roomTypeId}/rooms/${importedRoomId}`,
      )
      .set('Cookie', cookie)
      .expect(204);

    await request(app.getHttpServer())
      .patch(
        `/tenants/${tenantId}/properties/${propertyId}/room-types/${roomTypeId}/rooms/${roomId}`,
      )
      .set('Cookie', cookie)
      .send({ name: 'Room 101', isActive: false })
      .expect(200)
      .expect((response) => expect(response.body.isActive).toBe(false));
    await request(app.getHttpServer())
      .patch(
        `/tenants/${tenantId}/properties/${propertyId}/room-types/${roomTypeId}/rooms/${roomId}`,
      )
      .set('Cookie', cookie)
      .send({ name: 'Room 101', isActive: true })
      .expect(200)
      .expect((response) => expect(response.body.isActive).toBe(true));

    const accommodationActivity = await request(app.getHttpServer())
      .get(`/tenants/${tenantId}/properties/${propertyId}/audit-logs`)
      .set('Cookie', cookie)
      .expect(200);
    expect(accommodationActivity.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'room.created',
          actorName: email,
          targetName: 'Room 101',
        }),
        expect.objectContaining({
          action: 'room.active_changed',
          targetName: 'Room 101',
          details: { to: true },
        }),
        expect.objectContaining({
          action: 'accommodation.imported',
          targetType: 'accommodation_import',
        }),
      ]),
    );

    const roomImagesUrl = `/tenants/${tenantId}/properties/${propertyId}/rooms/${roomId}/images`;
    await request(app.getHttpServer()).get(roomImagesUrl).set('Cookie', cookie).expect(200, []);
    const roomImage = await request(app.getHttpServer())
      .post(`${roomImagesUrl}/from-url`)
      .set('Cookie', cookie)
      .send({ url: 'https://images.example.test/room-101.jpg' })
      .expect(201);
    const imageId = roomImage.body.id as string;
    expect(roomImage.body).toMatchObject({
      sourceUrl: 'https://images.example.test/room-101.jpg',
      sortOrder: 0,
      isPrimary: true,
    });
    const listedImages = await request(app.getHttpServer())
      .get(roomImagesUrl)
      .set('Cookie', cookie)
      .expect(200);
    expect(listedImages.body).toContainEqual(
      expect.objectContaining({
        id: imageId,
        sourceUrl: 'https://images.example.test/room-101.jpg',
        url: 'https://images.example.test/room-101.jpg',
        isPrimary: true,
      }),
    );
    await request(app.getHttpServer())
      .put(`${roomImagesUrl}/order`)
      .set('Cookie', cookie)
      .send({ imageIds: [imageId] })
      .expect(200);
    await request(app.getHttpServer())
      .put(`${roomImagesUrl}/primary`)
      .set('Cookie', cookie)
      .send({ imageId })
      .expect(200);
    await request(app.getHttpServer())
      .delete(`${roomImagesUrl}/${imageId}`)
      .set('Cookie', cookie)
      .expect(204);

    const libraryObjectKey = `library/${tenantId}/${propertyId}/room-test.jpg`;
    const libraryRows = await admin.$queryRaw<Array<{ id: string }>>`
      INSERT INTO property_library_images (tenant_id, property_id, object_key, confirmed_at)
      VALUES (${tenantId}::uuid, ${propertyId}::uuid, ${libraryObjectKey}, CURRENT_TIMESTAMP)
      RETURNING id
    `;
    await request(app.getHttpServer())
      .post(`${roomImagesUrl}/from-library`)
      .set('Cookie', cookie)
      .send({ libraryImageIds: [libraryRows[0].id] })
      .expect(201, { added: 1 });
    const attachedRows = await admin.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM room_images
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        AND room_id = ${roomId}::uuid AND object_key = ${libraryObjectKey}
    `;
    await request(app.getHttpServer())
      .delete(`${roomImagesUrl}/${attachedRows[0].id}`)
      .set('Cookie', cookie)
      .expect(204);

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
      .delete(`${categoriesUrl}/${categoryId}`)
      .set('Cookie', cookie)
      .expect(204);
    await request(app.getHttpServer())
      .get(`/tenants/${tenantId}/properties/${propertyId}/room-types`)
      .set('Cookie', cookie)
      .expect((r) =>
        expect(r.body).toContainEqual(
          expect.objectContaining({ id: roomTypeId, categoryId: null }),
        ),
      );
    await request(app.getHttpServer())
      .get(`/tenants/${tenantId}/properties/${propertyId}/room-types/${roomTypeId}/rooms`)
      .set('Cookie', cookie)
      .expect((r) => expect(r.body).toContainEqual(expect.objectContaining({ id: roomId })));

    await request(app.getHttpServer())
      .delete(
        `/tenants/${tenantId}/properties/${propertyId}/room-types/${roomTypeId}/rooms/${roomId}`,
      )
      .set('Cookie', cookie)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/tenants/${tenantId}/properties/${propertyId}/room-types`)
      .set('Cookie', cookie)
      .expect((response) => expect(response.body[0].categoryId).toBeNull());

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
