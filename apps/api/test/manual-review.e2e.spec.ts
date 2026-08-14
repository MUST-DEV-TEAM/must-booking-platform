import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

// Milestone 11 Task 12. The real trigger (a Clock booking-creation timeout
// that ClockBookingService can't confirm — see clock-booking.service.ts's
// PMS_UNKNOWN_RESULT branch) isn't independently re-exercised here (it would
// require forcing a real network timeout against the Clock sandbox); this
// instead verifies the platform-admin surface for real end to end — list,
// tenant-scoped RLS isolation, and resolve — against a manually-seeded row,
// which is exactly what that trigger (and any future one) writes into.
describe('Manual review (platform admin)', () => {
  let app: INestApplication;
  const organizationId = randomUUID();
  const otherOrganizationId = randomUUID();
  const propertyId = randomUUID();
  const otherPropertyId = randomUUID();
  const platformAdminId = randomUUID();
  const itemId = randomUUID();
  const email = `manual-review-admin-${randomUUID()}@must.al`;
  const password = 'correct-horse-battery-staple';
  const mail: MailProvider = {
    async sendVerificationEmail() {},
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
    const hash = await bcrypt.hash(password, 12);
    await admin.$executeRaw`INSERT INTO "organizations" ("id", "name") VALUES (${organizationId}::uuid, 'Manual Review Tenant')`;
    await admin.$executeRaw`INSERT INTO "organizations" ("id", "name") VALUES (${otherOrganizationId}::uuid, 'Other Tenant')`;
    await admin.$executeRaw`
      INSERT INTO "properties" ("id", "tenant_id", "name", "slug", "address", "timezone", "stripe_enabled")
      VALUES (${propertyId}::uuid, ${organizationId}::uuid, 'Main Property', 'manual-review-property', '', 'UTC', true)
    `;
    await admin.$executeRaw`
      INSERT INTO "properties" ("id", "tenant_id", "name", "slug", "address", "timezone", "stripe_enabled")
      VALUES (${otherPropertyId}::uuid, ${otherOrganizationId}::uuid, 'Other Property', 'other-property', '', 'UTC', true)
    `;
    await admin.$executeRaw`
      INSERT INTO "users" ("id", "email", "password_hash", "email_verified_at", "is_platform_admin")
      VALUES (${platformAdminId}::uuid, ${email}, ${hash}, CURRENT_TIMESTAMP, true)
    `;
    await admin.$executeRaw`
      INSERT INTO manual_review_items (id, tenant_id, property_id, category, reference_type, reference_id, message)
      VALUES (${itemId}::uuid, ${organizationId}::uuid, ${propertyId}::uuid, 'UNKNOWN_RESULT', 'booking', 'booking-xyz', 'Booking creation timed out.')
    `;

    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL =
      'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.WEB_APP_URL = 'http://localhost:3001';
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_PROVIDER)
      .useValue(mail)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await admin.$executeRaw`DELETE FROM manual_review_items WHERE tenant_id IN (${organizationId}::uuid, ${otherOrganizationId}::uuid)`;
    await admin.$executeRaw`DELETE FROM audit_logs WHERE tenant_id = ${organizationId}::uuid`;
    await admin.$executeRaw`DELETE FROM properties WHERE tenant_id IN (${organizationId}::uuid, ${otherOrganizationId}::uuid)`;
    await admin.$executeRaw`DELETE FROM users WHERE id = ${platformAdminId}::uuid`;
    await admin.$executeRaw`DELETE FROM organizations WHERE id IN (${organizationId}::uuid, ${otherOrganizationId}::uuid)`;
    await app.close();
    await admin.$disconnect();
  });

  it('lists the item for its own tenant, not for another, then resolves it', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    const cookie = login.headers['set-cookie'][0] as string;

    const detail = await request(app.getHttpServer())
      .get(`/platform/tenants/${organizationId}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(detail.body.manualReviewItems).toEqual([
      expect.objectContaining({
        id: itemId,
        category: 'UNKNOWN_RESULT',
        referenceType: 'booking',
        referenceId: 'booking-xyz',
        status: 'OPEN',
      }),
    ]);

    const otherDetail = await request(app.getHttpServer())
      .get(`/platform/tenants/${otherOrganizationId}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(otherDetail.body.manualReviewItems).toEqual([]);

    await request(app.getHttpServer())
      .post(`/platform/tenants/${organizationId}/manual-review/${itemId}/resolve`)
      .set('Cookie', cookie)
      .expect(201);

    const resolved = await admin.$queryRaw<
      Array<{ status: string; resolvedByUserId: string | null }>
    >`
      SELECT status::text AS status, resolved_by_user_id AS "resolvedByUserId"
      FROM manual_review_items WHERE id = ${itemId}::uuid
    `;
    expect(resolved[0]).toEqual({ status: 'RESOLVED', resolvedByUserId: platformAdminId });

    const auditRows = await admin.$queryRaw<Array<{ action: string }>>`
      SELECT action FROM audit_logs
      WHERE tenant_id = ${organizationId}::uuid AND action = 'platform.manual_review.resolved'
    `;
    expect(auditRows).toHaveLength(1);
  });
});
