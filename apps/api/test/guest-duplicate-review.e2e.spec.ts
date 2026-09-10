import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PropertyRoleTemplatesService } from '../src/tenancy/property-role-templates.service';
import { cleanupTenant } from './helpers/cleanup-tenant';

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('suspected duplicate guest review', () => {
  const tenantId = randomUUID();
  const propertyId = randomUUID();
  const roomTypeId = randomUUID();
  const ratePlanId = randomUUID();
  const ownerId = randomUUID();
  const flaggedGuestId = randomUUID();
  const canonicalGuestId = randomUUID();
  const dismissedGuestId = randomUUID();
  const dismissedCandidateId = randomUUID();
  const flaggedBookingId = randomUUID();
  const canonicalBookingId = randomUUID();
  const dismissedBookingId = randomUUID();
  const ownerEmail = `guest-review-${randomUUID()}@example.test`;
  const password = 'correct-horse-battery-staple';
  let app: INestApplication;
  let ownerCookie: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(password, 12);
    await admin.$executeRaw`
      INSERT INTO organizations (id, name) VALUES (${tenantId}::uuid, 'Guest review tenant')
    `;
    await admin.$executeRaw`
      INSERT INTO properties (id, tenant_id, name, slug)
      VALUES (${propertyId}::uuid, ${tenantId}::uuid, 'Guest review property', ${`guest-review-${propertyId}`})
    `;
    await admin.$executeRaw`
      INSERT INTO users (id, email, password_hash, email_verified_at)
      VALUES (${ownerId}::uuid, ${ownerEmail}, ${passwordHash}, CURRENT_TIMESTAMP)
    `;
    await admin.$executeRaw`
      INSERT INTO tenant_memberships (tenant_id, user_id, role)
      VALUES (${tenantId}::uuid, ${ownerId}::uuid, 'OWNER')
    `;
    await admin.$executeRaw`
      INSERT INTO room_types (id, tenant_id, property_id, name, max_occupancy)
      VALUES (${roomTypeId}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, 'Review room', 2)
    `;
    await admin.$executeRaw`
      INSERT INTO rate_plans (id, tenant_id, property_id, name, currency)
      VALUES (${ratePlanId}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, 'Review rate', 'EUR')
    `;
    await admin.$executeRaw`
      INSERT INTO guests (
        id, tenant_id, email, first_name, last_name, phone, suspected_duplicate_of_guest_id
      ) VALUES
        (${flaggedGuestId}::uuid, ${tenantId}::uuid, 'flagged@example.test', NULL, 'Flagged', '+355 69 123 4567', ${canonicalGuestId}::uuid),
        (${canonicalGuestId}::uuid, ${tenantId}::uuid, 'canonical@example.test', 'Canonical', NULL, NULL, NULL),
        (${dismissedGuestId}::uuid, ${tenantId}::uuid, 'dismissed@example.test', 'Dismissed', 'Guest', '+355 69 999 1111', ${dismissedCandidateId}::uuid),
        (${dismissedCandidateId}::uuid, ${tenantId}::uuid, 'dismissed-candidate@example.test', 'Candidate', 'Guest', '+355 69 999 1111', NULL)
    `;
    await insertBooking(flaggedBookingId, flaggedGuestId, 'review-flagged');
    await insertBooking(canonicalBookingId, canonicalGuestId, 'review-canonical');
    await insertBooking(dismissedBookingId, dismissedGuestId, 'review-dismissed');
    await admin.$executeRaw`
      INSERT INTO payments (
        tenant_id, property_id, booking_id, kind, provider, external_payment_id,
        status, amount, currency
      ) VALUES (
        ${tenantId}::uuid, ${propertyId}::uuid, ${flaggedBookingId}::uuid, 'CHARGE'::"PaymentKind",
        'test', ${`payment-${randomUUID()}`}, 'succeeded', 25.00, 'EUR'
      )
    `;

    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL =
      'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.WEB_APP_URL = 'http://localhost:3001';
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await moduleRef.get(PropertyRoleTemplatesService).ensureBuiltInTemplates(tenantId, propertyId);
    ownerCookie = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: ownerEmail, password })
        .expect(201)
    ).headers['set-cookie'][0] as string;
  });

  afterAll(async () => {
    await cleanupTenant(admin, tenantId);
    await admin.$executeRaw`DELETE FROM users WHERE id = ${ownerId}::uuid`;
    await app.close();
    await admin.$disconnect();
  });

  it('lists pairs, merges the selected canonical guest, and excludes the tombstone', async () => {
    const propertyUrl = `/tenants/${tenantId}/properties/${propertyId}`;
    const queue = await request(app.getHttpServer())
      .get(`${propertyUrl}/guests/suspected-duplicates`)
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(queue.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          guest: expect.objectContaining({ id: flaggedGuestId, bookingCount: 1 }),
          suspectedDuplicate: expect.objectContaining({ id: canonicalGuestId, bookingCount: 1 }),
        }),
      ]),
    );

    await request(app.getHttpServer())
      .post(`${propertyUrl}/guests/${flaggedGuestId}/merge`)
      .set('Cookie', ownerCookie)
      .send({ canonicalGuestId })
      .expect(201)
      .expect({ canonicalGuestId, mergedGuestId: flaggedGuestId });

    const mergedState = await admin.$queryRaw<
      Array<{
        id: string;
        email: string;
        firstName: string | null;
        lastName: string | null;
        phone: string | null;
        mergedIntoGuestId: string | null;
        suspectedDuplicateOfGuestId: string | null;
      }>
    >`
      SELECT id, email, first_name AS "firstName", last_name AS "lastName", phone,
        merged_into_guest_id AS "mergedIntoGuestId",
        suspected_duplicate_of_guest_id AS "suspectedDuplicateOfGuestId"
      FROM guests WHERE tenant_id = ${tenantId}::uuid
        AND id IN (${flaggedGuestId}::uuid, ${canonicalGuestId}::uuid)
      ORDER BY id
    `;
    expect(mergedState).toEqual(
      expect.arrayContaining([
        {
          id: canonicalGuestId,
          email: 'canonical@example.test',
          firstName: 'Canonical',
          lastName: 'Flagged',
          phone: '+355 69 123 4567',
          mergedIntoGuestId: null,
          suspectedDuplicateOfGuestId: null,
        },
        expect.objectContaining({
          id: flaggedGuestId,
          mergedIntoGuestId: canonicalGuestId,
          suspectedDuplicateOfGuestId: null,
        }),
      ]),
    );

    const bookings = await admin.$queryRaw<Array<{ guestId: string | null }>>`
      SELECT guest_id AS "guestId" FROM bookings
      WHERE tenant_id = ${tenantId}::uuid
        AND id IN (${flaggedBookingId}::uuid, ${canonicalBookingId}::uuid)
      ORDER BY id
    `;
    expect(bookings).toEqual([{ guestId: canonicalGuestId }, { guestId: canonicalGuestId }]);
    const paymentCount = await admin.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count FROM payments p
      JOIN bookings b ON b.tenant_id = p.tenant_id AND b.property_id = p.property_id
        AND b.id = p.booking_id
      WHERE p.tenant_id = ${tenantId}::uuid AND b.guest_id = ${canonicalGuestId}::uuid
    `;
    expect(paymentCount).toEqual([{ count: 1 }]);

    const activeGuests = await request(app.getHttpServer())
      .get(`${propertyUrl}/guests?search=flagged@example.test`)
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(activeGuests.body).toEqual([]);
  });

  it('dismisses a flag without changing either profile', async () => {
    const propertyUrl = `/tenants/${tenantId}/properties/${propertyId}`;
    await request(app.getHttpServer())
      .post(`${propertyUrl}/guests/${dismissedGuestId}/dismiss-duplicate`)
      .set('Cookie', ownerCookie)
      .expect(204);

    const profiles = await admin.$queryRaw<
      Array<{
        id: string;
        email: string;
        firstName: string | null;
        lastName: string | null;
        phone: string | null;
        suspectedDuplicateOfGuestId: string | null;
        mergedIntoGuestId: string | null;
      }>
    >`
      SELECT id, email, first_name AS "firstName", last_name AS "lastName", phone,
        suspected_duplicate_of_guest_id AS "suspectedDuplicateOfGuestId",
        merged_into_guest_id AS "mergedIntoGuestId"
      FROM guests WHERE tenant_id = ${tenantId}::uuid
        AND id IN (${dismissedGuestId}::uuid, ${dismissedCandidateId}::uuid)
      ORDER BY id
    `;
    expect(profiles).toEqual(
      expect.arrayContaining([
        {
          id: dismissedGuestId,
          email: 'dismissed@example.test',
          firstName: 'Dismissed',
          lastName: 'Guest',
          phone: '+355 69 999 1111',
          suspectedDuplicateOfGuestId: null,
          mergedIntoGuestId: null,
        },
        {
          id: dismissedCandidateId,
          email: 'dismissed-candidate@example.test',
          firstName: 'Candidate',
          lastName: 'Guest',
          phone: '+355 69 999 1111',
          suspectedDuplicateOfGuestId: null,
          mergedIntoGuestId: null,
        },
      ]),
    );
    const queue = await request(app.getHttpServer())
      .get(`${propertyUrl}/guests/suspected-duplicates`)
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(queue.body).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          guest: expect.objectContaining({ id: dismissedGuestId }),
        }),
      ]),
    );
  });

  async function insertBooking(id: string, guestId: string, externalReference: string) {
    await admin.$executeRaw`
      INSERT INTO bookings (
        id, tenant_id, property_id, room_type_id, guest_id, external_reference,
        status, payment_method, starts_on, ends_on, rate_plan_id, total_amount
      ) VALUES (
        ${id}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, ${roomTypeId}::uuid, ${guestId}::uuid,
        ${externalReference}, 'CONFIRMED'::"BookingStatus", 'PAY_AT_HOTEL'::"BookingPaymentMethod",
        '2040-01-01'::date, '2040-01-03'::date, ${ratePlanId}::uuid, 25.00
      )
    `;
  }
});
