import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';
import { cleanupTenant } from './helpers/cleanup-tenant';

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('public catalog individual rooms', () => {
  let app: INestApplication;
  let tenantId: string;
  let ownerId: string;
  let cookie: string;
  let pooledPropertyId: string;
  let individualPropertyId: string;
  let mixedPropertyId: string;
  let verificationToken = '';
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
    if (tenantId) {
      await cleanupTenant(admin, tenantId);
    }
    if (ownerId) await admin.$executeRaw`DELETE FROM users WHERE id = ${ownerId}::uuid`;
    await app.close();
    await admin.$disconnect();
  });

  async function createProperty(name: string): Promise<string> {
    const propertyId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO properties (id, tenant_id, name, slug, address, timezone)
      VALUES (
        ${propertyId}::uuid,
        ${tenantId}::uuid,
        ${name},
        ${`${name.toLowerCase().replaceAll(' ', '-')}-${propertyId.slice(0, 8)}`},
        '2 Main Street',
        'Europe/Tirane'
      )
    `;
    return propertyId;
  }

  it('keeps pooled catalogs unchanged and exposes available physical rooms for individual-capable properties', async () => {
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Public Catalog Rooms Group',
        propertyName: 'Pooled Hotel',
        propertyAddress: '1 Main Street',
        propertyTimezone: 'Europe/Tirane',
        email: `public-catalog-rooms-${randomUUID()}@example.test`,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    ownerId = signup.body.user.id;
    pooledPropertyId = signup.body.property.id;
    cookie = signup.headers['set-cookie'][0];

    await request(app.getHttpServer())
      .post('/auth/email-verification/confirm')
      .send({ token: verificationToken })
      .expect(204);

    const pooledUrl = `/tenants/${tenantId}/properties/${pooledPropertyId}`;
    const pooledRoomType = await request(app.getHttpServer())
      .post(`${pooledUrl}/room-types`)
      .set('Cookie', cookie)
      .send({
        name: 'Pooled Classic',
        maxOccupancy: 2,
        mainImageUrl: 'https://images.example.test/pooled-classic.jpg',
        galleryImageUrls: [
          'https://images.example.test/pooled-classic-1.jpg',
          'https://images.example.test/pooled-classic-2.jpg',
        ],
      })
      .expect(201);
    const beachAmenity = await request(app.getHttpServer())
      .post(`${pooledUrl}/amenities`)
      .set('Cookie', cookie)
      .send({ name: 'Beach access', icon: 'BEACH' })
      .expect(201);
    await request(app.getHttpServer())
      .put(`${pooledUrl}/room-types/${pooledRoomType.body.id}/amenities`)
      .set('Cookie', cookie)
      .send({ amenityIds: [beachAmenity.body.id] })
      .expect(200);
    const pooledFirstRoom = await request(app.getHttpServer())
      .post(`${pooledUrl}/room-types/${pooledRoomType.body.id}/rooms`)
      .set('Cookie', cookie)
      .send({ name: 'Classic Room A' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${pooledUrl}/room-types/${pooledRoomType.body.id}/rooms`)
      .set('Cookie', cookie)
      .send({ name: 'Classic Room B' })
      .expect(201);
    await admin.$executeRaw`
      INSERT INTO room_availability (tenant_id, property_id, room_id, stays_on, is_available)
      VALUES (${tenantId}::uuid, ${pooledPropertyId}::uuid, ${pooledFirstRoom.body.id}::uuid, '2035-09-10', false)
    `;

    const pooledCatalog = await request(app.getHttpServer())
      .get(`${pooledUrl}/public/catalog`)
      .expect(200);
    expect(pooledCatalog.body).toEqual({
      paymentMethods: [],
      roomTypes: [
        {
          id: pooledRoomType.body.id,
          name: 'Pooled Classic',
          description: null,
          amenitiesIntro: null,
          mainImageUrl: 'https://images.example.test/pooled-classic.jpg',
          galleryImageUrls: [
            'https://images.example.test/pooled-classic-1.jpg',
            'https://images.example.test/pooled-classic-2.jpg',
          ],
          maxOccupancy: 2,
          amenities: [{ id: beachAmenity.body.id, name: 'Beach access', icon: 'BEACH' }],
          ratePlans: [],
          requiresRatePlanSelection: true,
        },
      ],
    });

    individualPropertyId = await createProperty('Individual Hotel');
    const individualUrl = `/tenants/${tenantId}/properties/${individualPropertyId}`;
    await request(app.getHttpServer())
      .patch(individualUrl)
      .set('Cookie', cookie)
      .send({ bookingMode: 'INDIVIDUAL_ROOM_ONLY' })
      .expect(200);
    const individualRoomType = await request(app.getHttpServer())
      .post(`${individualUrl}/room-types`)
      .set('Cookie', cookie)
      .send({ name: 'Individual Classic', maxOccupancy: 2 })
      .expect(201);
    const unavailableRoom = await request(app.getHttpServer())
      .post(`${individualUrl}/room-types/${individualRoomType.body.id}/rooms`)
      .set('Cookie', cookie)
      .send({ name: 'Classic Room A', floor: 1, viewType: 'Garden view' })
      .expect(201);
    const availableRoom = await request(app.getHttpServer())
      .post(`${individualUrl}/room-types/${individualRoomType.body.id}/rooms`)
      .set('Cookie', cookie)
      .send({ name: 'Classic Room B', floor: 2, viewType: 'Sea view' })
      .expect(201);
    await request(app.getHttpServer())
      .put(`${individualUrl}/rooms/${unavailableRoom.body.id}/availability`)
      .set('Cookie', cookie)
      .send({ startsOn: '2035-09-10', endsOn: '2035-09-12', isAvailable: false })
      .expect(204);
    await request(app.getHttpServer()).get(`${individualUrl}/public/catalog`).expect(400);
    const individualCatalog = await request(app.getHttpServer())
      .get(`${individualUrl}/public/catalog`)
      .query({ startsOn: '2035-09-10', endsOn: '2035-09-12' })
      .expect(200);
    expect(individualCatalog.body).toMatchObject({
      bookingMode: 'INDIVIDUAL_ROOM_ONLY',
      roomTypes: [
        {
          id: individualRoomType.body.id,
          rooms: [
            {
              id: unavailableRoom.body.id,
              name: 'Classic Room A',
              floor: 1,
              viewType: 'Garden view',
              isAvailable: false,
            },
            {
              id: availableRoom.body.id,
              name: 'Classic Room B',
              floor: 2,
              viewType: 'Sea view',
              isAvailable: true,
            },
          ],
        },
      ],
    });

    mixedPropertyId = await createProperty('Mixed Hotel');
    const mixedUrl = `/tenants/${tenantId}/properties/${mixedPropertyId}`;
    await request(app.getHttpServer())
      .patch(mixedUrl)
      .set('Cookie', cookie)
      .send({ bookingMode: 'MIXED' })
      .expect(200);
    const mixedRoomType = await request(app.getHttpServer())
      .post(`${mixedUrl}/room-types`)
      .set('Cookie', cookie)
      .send({ name: 'Mixed Classic', maxOccupancy: 2 })
      .expect(201);
    const mixedRoom = await request(app.getHttpServer())
      .post(`${mixedUrl}/room-types/${mixedRoomType.body.id}/rooms`)
      .set('Cookie', cookie)
      .send({ name: 'Mixed Room' })
      .expect(201);
    await request(app.getHttpServer())
      .get(`${mixedUrl}/public/catalog`)
      .query({ startsOn: '2035-09-10', endsOn: '2035-09-12' })
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          bookingMode: 'MIXED',
          roomTypes: [
            {
              id: mixedRoomType.body.id,
              rooms: [{ id: mixedRoom.body.id, name: 'Mixed Room', isAvailable: true }],
            },
          ],
        });
      });
  });
});
