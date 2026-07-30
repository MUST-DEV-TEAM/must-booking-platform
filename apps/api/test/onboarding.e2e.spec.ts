import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { PropertyRoleTemplatesService } from '../src/tenancy/property-role-templates.service';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';

const migrationPrisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('self-serve onboarding', () => {
  let app: INestApplication;
  let templates: PropertyRoleTemplatesService;
  let ownerId: string;
  let tenantId: string;
  let propertyId: string;
  let ownerCookie: string;
  const ownerEmail = `onboarding-owner-${randomUUID()}@example.test`;
  const staffEmails = [
    `onboarding-staff-${randomUUID()}@example.test`,
    `onboarding-staff-${randomUUID()}@example.test`,
  ];
  const password = 'correct-horse-battery-staple';
  const sentEmails: Array<
    | { kind: 'verification'; command: Parameters<MailProvider['sendVerificationEmail']>[0] }
    | { kind: 'welcome'; command: Parameters<MailProvider['sendWelcomeEmail']>[0] }
  > = [];
  const mail: MailProvider = {
    async sendVerificationEmail(command) {
      sentEmails.push({ kind: 'verification', command });
    },
    async sendWelcomeEmail(command) {
      sentEmails.push({ kind: 'welcome', command });
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
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    templates = moduleRef.get(PropertyRoleTemplatesService);
  });

  afterAll(async () => {
    if (tenantId) {
      await migrationPrisma.$executeRaw`DELETE FROM "audit_logs" WHERE "tenant_id" = ${tenantId}::uuid`;
      await migrationPrisma.$executeRaw`DELETE FROM "property_staff_capability_overrides" WHERE "tenant_id" = ${tenantId}::uuid`;
      await migrationPrisma.$executeRaw`DELETE FROM "property_staff_assignments" WHERE "tenant_id" = ${tenantId}::uuid`;
      await migrationPrisma.$executeRaw`DELETE FROM "property_role_template_capabilities" WHERE "tenant_id" = ${tenantId}::uuid`;
      await migrationPrisma.$executeRaw`DELETE FROM "property_role_templates" WHERE "tenant_id" = ${tenantId}::uuid`;
      await migrationPrisma.$executeRaw`DELETE FROM "capabilities" WHERE "tenant_id" = ${tenantId}::uuid`;
      await migrationPrisma.$executeRaw`DELETE FROM "tenant_memberships" WHERE "tenant_id" = ${tenantId}::uuid`;
    }
    if (propertyId)
      await migrationPrisma.$executeRaw`DELETE FROM "properties" WHERE "id" = ${propertyId}::uuid`;
    if (tenantId)
      await migrationPrisma.$executeRaw`DELETE FROM "organizations" WHERE "id" = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "users" WHERE "email" IN (${ownerEmail}, ${staffEmails[0]}, ${staffEmails[1]})`;
    await app.close();
    await migrationPrisma.$disconnect();
  });

  it('signs up, verifies email, welcomes the Owner, and reports the Free staff-seat cap', async () => {
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Onboarding Hotels',
        propertyName: 'Onboarding Hotel',
        propertyAddress: '1 Example Street, Tirana',
        propertyTimezone: 'Europe/Tirane',
        email: ownerEmail,
        password,
      })
      .expect(201);
    ownerId = signup.body.user.id as string;
    tenantId = signup.body.organization.id as string;
    propertyId = signup.body.property.id as string;
    ownerCookie = signup.headers['set-cookie'][0] as string;

    expect(
      (
        await request(app.getHttpServer())
          .get('/auth/session')
          .set('Cookie', ownerCookie)
          .expect(200)
      ).body,
    ).toEqual({ user: { id: ownerId, email: ownerEmail, emailVerified: false } });
    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/staff-invitations`)
      .set('Cookie', ownerCookie)
      .send({ email: staffEmails[0], assignments: [{ propertyId, roleTemplateId: randomUUID() }] })
      .expect(403);

    const verification = sentEmails.find((email) => email.kind === 'verification');
    if (!verification || verification.kind !== 'verification')
      throw new Error('Verification email was not sent.');
    const token = new URL(verification.command.verificationUrl).searchParams.get('token');
    await request(app.getHttpServer())
      .post('/auth/email-verification/confirm')
      .send({ token })
      .expect(204);
    expect(sentEmails).toContainEqual(
      expect.objectContaining({
        kind: 'welcome',
        command: expect.objectContaining({ to: ownerEmail }),
      }),
    );
    expect(
      (
        await request(app.getHttpServer())
          .get('/auth/session')
          .set('Cookie', ownerCookie)
          .expect(200)
      ).body,
    ).toEqual({ user: { id: ownerId, email: ownerEmail, emailVerified: true } });

    await templates.ensureBuiltInTemplates(tenantId, propertyId);
    const template = await migrationPrisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "property_role_templates"
      WHERE "tenant_id" = ${tenantId}::uuid AND "property_id" = ${propertyId}::uuid AND "name" = 'Front Desk'
    `;
    const roleTemplateId = template[0].id;
    for (const email of staffEmails) {
      const invitation = await request(app.getHttpServer())
        .post(`/tenants/${tenantId}/staff-invitations`)
        .set('Cookie', ownerCookie)
        .send({ email, assignments: [{ propertyId, roleTemplateId }] })
        .expect(201);
      await request(app.getHttpServer())
        .post('/auth/staff-invitations/activate')
        .send({ token: invitation.body.token, email, password })
        .expect(204);
    }

    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/staff-invitations`)
      .set('Cookie', ownerCookie)
      .send({
        email: `onboarding-over-limit-${randomUUID()}@example.test`,
        assignments: [{ propertyId, roleTemplateId }],
      })
      .expect(409);
    expect(
      (
        await request(app.getHttpServer())
          .get(`/tenants/${tenantId}/plan-usage`)
          .set('Cookie', ownerCookie)
          .expect(200)
      ).body,
    ).toMatchObject({
      plan: { name: 'Free', maxStaffSeats: 3 },
      usage: { staffSeats: 3 },
    });
  });
});
