import * as crypto from 'node:crypto';
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

describe('Inventory overview I3', () => {
  let app: INestApplication;
  let tenantId: string;
  let propertyId: string;
  let roomTypeId: string;
  let userId: string;
  let cookie: string;
  const email = `rooms-${randomUUID()}@example.test`;
  const password = randomUUID() + randomUUID();
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

  it('summarizes real local stock and uses the same evaluator for preview and search', async () => {
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Overview group',
        propertyName: 'Overview hotel',
        propertyAddress: 'Local test',
        propertyTimezone: 'Pacific/Auckland',
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
    const root = `/tenants/${tenantId}/properties/${propertyId}`,
      url = `${root}/inventory`;
    const send = (path: string, body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post(`${url}/${path}`)
        .set('Cookie', cookie)
        .set('Idempotency-Key', randomUUID())
        .send(body);
    const type = await request(app.getHttpServer())
      .post(`${root}/room-types`)
      .set('Cookie', cookie)
      .send({ name: 'King', maxOccupancy: 2 })
      .expect(201);
    roomTypeId = type.body.id;
    await request(app.getHttpServer())
      .patch(`${root}/room-types/${roomTypeId}`)
      .set('Cookie', cookie)
      .send({ name: 'King', maxOccupancy: 2, status: 'PUBLISHED' })
      .expect(200);
    const empty = await request(app.getHttpServer())
      .get(`${url}/overview`)
      .set('Cookie', cookie)
      .expect(200);
    expect(empty.body.totalNights).toBe(0);
    expect(empty.body.sellablePercentage).toBeNull();
    const today = empty.body.today;
    const add = (n: number) =>
      new Date(Date.parse(today) + n * 86400000).toISOString().slice(0, 10);
    await request(app.getHttpServer())
      .put(`${root}/inventory-units`)
      .set('Idempotency-Key', crypto.randomUUID())
      .set('Cookie', cookie)
      .send({ roomTypeId, startsOn: today, endsOn: add(30), availableUnits: 3 })
      .expect(204);
    const rule = await send('restrictions', {
      name: 'Minimum three',
      type: 'minimum_stay',
      value: 3,
      scope: 'property',
      targetIds: [],
      startsOn: today,
      endsOn: null,
    }).expect(201);
    await send(`restrictions/${rule.body.id}/activate`, { version: 1 }).expect(201);
    const stop = await send('restrictions', {
      name: 'Closed one day',
      type: 'stop_sell',
      value: 1,
      scope: 'property',
      targetIds: [],
      startsOn: add(5),
      endsOn: add(5),
    }).expect(201);
    await send(`restrictions/${stop.body.id}/activate`, { version: 1 }).expect(201);
    const block = await send('blocks', {
      title: 'One night maintenance',
      reason: 'maintenance',
      all: false,
      roomTypeIds: [roomTypeId],
      startsOn: add(10),
      endsOn: add(11),
    }).expect(201);
    await send(`blocks/${block.body.id}/activate`, { version: 1 }).expect(201);
    const overview = await request(app.getHttpServer())
      .get(`${url}/overview`)
      .set('Cookie', cookie)
      .expect(200);
    expect(overview.body).toMatchObject({
      totalNights: 90,
      sellableNights: 84,
      sellablePercentage: 93,
      activeRestrictions: 1,
      countsByType: { minimum_stay: 1 },
    });
    expect(overview.body.coverage[0].days).toHaveLength(30);
    const input = { roomTypeId, startsOn: add(1), endsOn: add(2), channel: 'staff' };
    const preview = await send('preview', input).expect(201);
    const evaluated = await request(app.getHttpServer())
      .get(`${root}/booking-rules/evaluate`)
      .set('Cookie', cookie)
      .query(input)
      .expect(200);
    expect(preview.body.booking).toEqual(evaluated.body.booking);
    expect(preview.body.booking.valid).toBe(false);
    expect(preview.body.booking.errors.some((e: { code: string }) => e.code === 'MIN_STAY')).toBe(
      true,
    );
    expect(
      (await send('preview', { ...input, endsOn: add(4) }).expect(201)).body.booking.valid,
    ).toBe(true);
    await send('preview', { ...input, channel: 'invented' }).expect(400);
    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${randomUUID()}/inventory/preview`)
      .set('Cookie', cookie)
      .send(input)
      .expect(403);
    await admin.$executeRaw`UPDATE tenant_memberships SET role='STAFF' WHERE tenant_id=${tenantId}::uuid AND user_id=${userId}::uuid`;
    await send('preview', input).expect(403);
    await admin.$executeRaw`UPDATE tenant_memberships SET role='OWNER' WHERE tenant_id=${tenantId}::uuid AND user_id=${userId}::uuid`;
    const conflicts = await request(app.getHttpServer())
      .get(`${url}/conflicts`)
      .set('Cookie', cookie)
      .expect(200);
    expect(conflicts.body).toMatchObject({ available: false, readOnly: true, items: null });
    expect(overview.body.coverage[0].rooms).toEqual([]);
    await admin.$executeRaw`UPDATE properties SET booking_mode='MIXED' WHERE tenant_id=${tenantId}::uuid AND id=${propertyId}::uuid`;
    for (const name of ['101', '102', '103'])
      await request(app.getHttpServer())
        .post(`${root}/room-types/${roomTypeId}/rooms`)
        .set('Cookie', cookie)
        .send({ name })
        .expect(201);
    await admin.$executeRaw`UPDATE rooms SET is_active=false WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND name='103'`;
    const physical = await request(app.getHttpServer())
      .get(`${url}/overview`)
      .set('Cookie', cookie)
      .expect(200);
    expect(physical.body.coverage[0].rooms.map((room: { name: string }) => room.name)).toEqual([
      '101',
      '102',
    ]);
    const firstRoom = physical.body.coverage[0].rooms[0];
    expect(firstRoom.days).toHaveLength(30);
    expect(firstRoom.days[5]).toMatchObject({ date: add(5), available: false });
    expect(firstRoom.days[10]).toMatchObject({ date: add(10), available: false });
    const calendar = await request(app.getHttpServer())
      .get(`${root}/availability-calendar`)
      .set('Cookie', cookie)
      .query({ roomTypeId, roomId: firstRoom.id, month: today.slice(0, 7) })
      .expect(200);
    expect(firstRoom.days[0].available).toBe(
      calendar.body.days.find((day: { date: string }) => day.date === today).isAvailable,
    );
    const draft = await request(app.getHttpServer())
      .post(`${root}/room-types`)
      .set('Cookie', cookie)
      .send({ name: 'Unpublished family', maxOccupancy: 2, status: 'DRAFT' })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`${root}/room-types/${draft.body.id}`)
      .set('Cookie', cookie)
      .send({ name: 'Unpublished family', maxOccupancy: 2, status: 'DRAFT' })
      .expect(200);
    const afterDraft = await request(app.getHttpServer())
      .get(`${url}/overview`)
      .set('Cookie', cookie)
      .expect(200);
    expect(
      afterDraft.body.coverage.some(
        (type: { roomTypeId: string }) => type.roomTypeId === draft.body.id,
      ),
    ).toBe(false);
  });
});
