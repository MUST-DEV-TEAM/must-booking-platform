import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('room-level availability', () => {
  let app: INestApplication;
  let tenantId: string;
  let ownerId: string;
  let cookie: string;
  let pooledPropertyId: string;
  let individualPropertyId: string;
  let verificationToken = '';
  const mail: MailProvider = {
    async sendVerificationEmail(command) {
      verificationToken = new URL(command.verificationUrl).searchParams.get('token')!;
    },
    async sendWelcomeEmail() {},
    async sendPasswordResetEmail() {},
    async sendPaymentConfirmationEmail() {},
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
      await admin.$executeRaw`DELETE FROM audit_logs WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM room_availability WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM inventory_units WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM rooms WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM room_types WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM property_staff_capability_overrides WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM property_staff_assignments WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM property_role_template_capabilities WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM property_role_templates WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM capabilities WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM tenant_memberships WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM properties WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM organizations WHERE id = ${tenantId}::uuid`;
    }
    if (ownerId) await admin.$executeRaw`DELETE FROM users WHERE id = ${ownerId}::uuid`;
    await app.close();
    await admin.$disconnect();
  });

  it('tracks individual rooms while leaving pooled availability completely independent', async () => {
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Room Availability Group',
        propertyName: 'Pooled Hotel',
        propertyAddress: '1 Main Street',
        propertyTimezone: 'Europe/Tirane',
        email: `room-availability-${randomUUID()}@example.test`,
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

    individualPropertyId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO properties (id, tenant_id, name, slug, address, timezone)
      VALUES (
        ${individualPropertyId}::uuid,
        ${tenantId}::uuid,
        'Individual Hotel',
        'individual-hotel-${individualPropertyId.slice(0, 8)}',
        '2 Main Street',
        'Europe/Tirane'
      )
    `;
    const individualUrl = `/tenants/${tenantId}/properties/${individualPropertyId}`;

    await request(app.getHttpServer())
      .patch(individualUrl)
      .set('Cookie', cookie)
      .send({ bookingMode: 'INDIVIDUAL_ROOM_ONLY' })
      .expect(200);
    const individualRoomType = await request(app.getHttpServer())
      .post(`${individualUrl}/room-types`)
      .set('Cookie', cookie)
      .send({ name: 'King Room', maxOccupancy: 2 })
      .expect(201);
    const room = await request(app.getHttpServer())
      .post(`${individualUrl}/room-types/${individualRoomType.body.id}/rooms`)
      .set('Cookie', cookie)
      .send({ name: 'King 101' })
      .expect(201);

    await request(app.getHttpServer())
      .put(`${individualUrl}/rooms/${room.body.id}/availability`)
      .set('Cookie', cookie)
      .send({ startsOn: '2035-08-10', endsOn: '2035-08-12', isAvailable: false })
      .expect(204);
    await request(app.getHttpServer())
      .get(`${individualUrl}/rooms/${room.body.id}/availability`)
      .set('Cookie', cookie)
      .query({ startsOn: '2035-08-10', endsOn: '2035-08-12' })
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({ roomId: room.body.id, isAvailable: false });
      });

    await request(app.getHttpServer())
      .patch(individualUrl)
      .set('Cookie', cookie)
      .send({ bookingMode: 'MIXED' })
      .expect(200);
    await request(app.getHttpServer())
      .put(`${individualUrl}/rooms/${room.body.id}/availability`)
      .set('Cookie', cookie)
      .send({ startsOn: '2035-08-12', endsOn: '2035-08-13', isAvailable: false })
      .expect(204);

    const pooledUrl = `/tenants/${tenantId}/properties/${pooledPropertyId}`;
    const pooledRoomType = await request(app.getHttpServer())
      .post(`${pooledUrl}/room-types`)
      .set('Cookie', cookie)
      .send({ name: 'Pooled Room', maxOccupancy: 2 })
      .expect(201);
    const pooledRoom = await request(app.getHttpServer())
      .post(`${pooledUrl}/room-types/${pooledRoomType.body.id}/rooms`)
      .set('Cookie', cookie)
      .send({ name: 'Pooled 101' })
      .expect(201);
    await request(app.getHttpServer())
      .put(`${pooledUrl}/inventory-units`)
      .set('Cookie', cookie)
      .send({
        roomTypeId: pooledRoomType.body.id,
        startsOn: '2035-08-10',
        endsOn: '2035-08-12',
        availableUnits: 1,
      })
      .expect(204);
    await request(app.getHttpServer())
      .put(`${pooledUrl}/rooms/${pooledRoom.body.id}/availability`)
      .set('Cookie', cookie)
      .send({ startsOn: '2035-08-10', endsOn: '2035-08-12', isAvailable: false })
      .expect(400);
    await admin.$executeRaw`
      INSERT INTO room_availability (tenant_id, property_id, room_id, stays_on, is_available)
      VALUES (${tenantId}::uuid, ${pooledPropertyId}::uuid, ${pooledRoom.body.id}::uuid, '2035-08-10', false)
    `;
    await request(app.getHttpServer())
      .get(`${pooledUrl}/availability`)
      .set('Cookie', cookie)
      .query({ roomTypeId: pooledRoomType.body.id, startsOn: '2035-08-10', endsOn: '2035-08-11' })
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({ isAvailable: true, availableUnits: 1 });
      });

    await request(app.getHttpServer())
      .get(
        `/tenants/${randomUUID()}/properties/${individualPropertyId}/rooms/${room.body.id}/availability`,
      )
      .set('Cookie', cookie)
      .query({ startsOn: '2035-08-10', endsOn: '2035-08-11' })
      .expect(403);
    await request(app.getHttpServer())
      .get(`${individualUrl}/rooms/${pooledRoom.body.id}/availability`)
      .set('Cookie', cookie)
      .query({ startsOn: '2035-08-10', endsOn: '2035-08-11' })
      .expect(404);
  });
});
