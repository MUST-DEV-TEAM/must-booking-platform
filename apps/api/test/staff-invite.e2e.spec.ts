import { randomUUID } from 'node:crypto';

import { BadRequestException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PropertyRoleTemplatesService } from '../src/tenancy/property-role-templates.service';
import { StaffInviteService } from '../src/tenancy/staff-invite.service';

const migrationPrisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('staff invitations', () => {
  let app: INestApplication;
  let templates: PropertyRoleTemplatesService;
  const tenantId = randomUUID();
  const propertyId = randomUUID();
  const ownerId = randomUUID();
  const existingUserId = randomUUID();
  const ownerEmail = `invite-owner-${randomUUID()}@example.test`;
  const existingEmail = `invite-existing-${randomUUID()}@example.test`;
  const newEmail = `invite-new-${randomUUID()}@example.test`;
  const overLimitEmail = `invite-over-limit-${randomUUID()}@example.test`;
  const failedActivationEmail = `invite-failed-${randomUUID()}@example.test`;
  const password = 'correct-horse-battery-staple';
  let ownerCookie: string;
  let existingUserCookie: string;
  let frontDeskTemplateId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(password, 12);
    await migrationPrisma.$executeRaw`INSERT INTO "organizations" ("id", "name") VALUES (${tenantId}::uuid, 'Staff invitations tenant')`;
    await migrationPrisma.$executeRaw`INSERT INTO "properties" ("id", "tenant_id", "name", "slug") VALUES (${propertyId}::uuid, ${tenantId}::uuid, 'Staff invitations property', ${`staff-invitations-${tenantId}`})`;
    await migrationPrisma.$executeRaw`
      INSERT INTO "users" ("id", "email", "password_hash") VALUES
        (${ownerId}::uuid, ${ownerEmail}, ${passwordHash}),
        (${existingUserId}::uuid, ${existingEmail}, ${passwordHash})
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "tenant_memberships" ("tenant_id", "user_id", "role")
      VALUES (${tenantId}::uuid, ${ownerId}::uuid, 'OWNER')
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
    templates = moduleRef.get(PropertyRoleTemplatesService);
    await templates.ensureBuiltInTemplates(tenantId, propertyId);
    const rows = await migrationPrisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "property_role_templates"
      WHERE "tenant_id" = ${tenantId}::uuid AND "property_id" = ${propertyId}::uuid AND "name" = 'Front Desk'
    `;
    frontDeskTemplateId = rows[0].id;

    ownerCookie = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: ownerEmail, password })
        .expect(201)
    ).headers['set-cookie'][0] as string;
    existingUserCookie = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: existingEmail, password })
        .expect(201)
    ).headers['set-cookie'][0] as string;
  });

  afterAll(async () => {
    await migrationPrisma.$executeRaw`DELETE FROM "property_staff_capability_overrides" WHERE "tenant_id" = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "property_staff_assignments" WHERE "tenant_id" = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "property_role_template_capabilities" WHERE "tenant_id" = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "property_role_templates" WHERE "tenant_id" = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "capabilities" WHERE "tenant_id" = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "tenant_memberships" WHERE "tenant_id" = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "properties" WHERE "id" = ${propertyId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "users" WHERE "email" IN (${ownerEmail}, ${existingEmail}, ${newEmail}, ${overLimitEmail}, ${failedActivationEmail})`;
    await migrationPrisma.$executeRaw`DELETE FROM "organizations" WHERE "id" = ${tenantId}::uuid`;
    await app.close();
    await migrationPrisma.$disconnect();
  });

  async function createInvite(
    email: string,
    roleTemplateId = frontDeskTemplateId,
  ): Promise<string> {
    await migrationPrisma.$executeRaw`
      UPDATE "users" SET "email_verified_at" = CURRENT_TIMESTAMP WHERE "id" = ${ownerId}::uuid
    `;
    const response = await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/staff-invitations`)
      .set('Cookie', ownerCookie)
      .send({
        email,
        assignments: [
          {
            propertyId,
            roleTemplateId,
            capabilityKeys: ['settings.manage'],
          },
        ],
      })
      .expect(201);
    expect(response.body.token).toEqual(expect.any(String));
    return response.body.token as string;
  }

  it('blocks an unverified Owner from inviting staff', async () => {
    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/staff-invitations`)
      .set('Cookie', ownerCookie)
      .send({
        email: newEmail,
        assignments: [{ propertyId, roleTemplateId: frontDeskTemplateId }],
      })
      .expect(403);
  });

  it('rejects an invitation once the current plan staff-seat limit is reached', async () => {
    const limitUserIds = [randomUUID(), randomUUID()];
    const limitEmails = limitUserIds.map((id) => `invite-limit-${id}@example.test`);
    await migrationPrisma.$executeRaw`
      UPDATE "users" SET "email_verified_at" = CURRENT_TIMESTAMP WHERE "id" = ${ownerId}::uuid
    `;
    try {
      for (const [index, userId] of limitUserIds.entries()) {
        await migrationPrisma.$executeRaw`
          INSERT INTO "users" ("id", "email") VALUES (${userId}::uuid, ${limitEmails[index]})
        `;
        await migrationPrisma.$executeRaw`
          INSERT INTO "tenant_memberships" ("tenant_id", "user_id", "role")
          VALUES (${tenantId}::uuid, ${userId}::uuid, 'STAFF')
        `;
      }

      const response = await request(app.getHttpServer())
        .post(`/tenants/${tenantId}/staff-invitations`)
        .set('Cookie', ownerCookie)
        .send({
          email: overLimitEmail,
          assignments: [{ propertyId, roleTemplateId: frontDeskTemplateId }],
        })
        .expect(409);
      expect(response.body.message).toBe('The current plan has reached its staff-seat limit.');
    } finally {
      for (const userId of limitUserIds) {
        await migrationPrisma.$executeRaw`
          DELETE FROM "tenant_memberships" WHERE "tenant_id" = ${tenantId}::uuid AND "user_id" = ${userId}::uuid
        `;
        await migrationPrisma.$executeRaw`DELETE FROM "users" WHERE "id" = ${userId}::uuid`;
      }
    }
  });

  it('lets an Owner create an invitation and a new user activate exactly its assigned access', async () => {
    const token = await createInvite(newEmail);

    await request(app.getHttpServer())
      .post('/auth/staff-invitations/activate')
      .send({ token, email: newEmail, password })
      .expect(204);

    const access = await migrationPrisma.$queryRaw<
      Array<{ role: string; roleTemplateId: string; hasSettingsOverride: boolean }>
    >`
      SELECT tm."role", psa."role_template_id" AS "roleTemplateId",
        EXISTS (
          SELECT 1 FROM "property_staff_capability_overrides" o
          JOIN "capabilities" c ON c."tenant_id" = o."tenant_id" AND c."id" = o."capability_id"
          WHERE o."tenant_id" = ${tenantId}::uuid AND o."property_id" = ${propertyId}::uuid
            AND o."user_id" = u."id" AND c."key" = 'settings.manage' AND o."granted" = true
        ) AS "hasSettingsOverride"
      FROM "users" u
      JOIN "tenant_memberships" tm ON tm."user_id" = u."id" AND tm."tenant_id" = ${tenantId}::uuid
      JOIN "property_staff_assignments" psa ON psa."user_id" = u."id" AND psa."tenant_id" = ${tenantId}::uuid
      WHERE u."email" = ${newEmail}
    `;
    expect(access).toEqual([
      { role: 'STAFF', roleTemplateId: frontDeskTemplateId, hasSettingsOverride: true },
    ]);
  });

  it('lets an existing signed-in user accept an invitation using their session user ID', async () => {
    const token = await createInvite(existingEmail);

    await request(app.getHttpServer())
      .post('/auth/staff-invitations/accept')
      .set('Cookie', existingUserCookie)
      .send({ token })
      .expect(204);

    const assignments = await migrationPrisma.$queryRaw<Array<{ userId: string; role: string }>>`
      SELECT psa."user_id" AS "userId", tm."role"
      FROM "property_staff_assignments" psa
      JOIN "tenant_memberships" tm ON tm."tenant_id" = psa."tenant_id" AND tm."user_id" = psa."user_id"
      WHERE psa."tenant_id" = ${tenantId}::uuid AND psa."property_id" = ${propertyId}::uuid
        AND psa."user_id" = ${existingUserId}::uuid
    `;
    expect(assignments).toEqual([{ userId: existingUserId, role: 'STAFF' }]);
  });

  it('rejects duplicate-email activation as a client error', async () => {
    const token = await createInvite(existingEmail);

    await request(app.getHttpServer())
      .post('/auth/staff-invitations/activate')
      .send({ token, email: existingEmail, password })
      .expect(400);
  });

  it('does not translate unrelated database errors into an email-conflict error', async () => {
    const databaseFailure = { code: 'P2010', meta: { code: '23503' } };
    const transaction = {
      $queryRaw: async () => [{ maxStaffSeats: 3 }, { found: false }, { count: 0 }],
      $executeRaw: async () => {
        throw databaseFailure;
      },
    };
    const service = new StaffInviteService(
      {
        withTenantTransaction: async (
          _context: unknown,
          operation: (tx: typeof transaction) => Promise<void>,
        ) => operation(transaction),
      } as never,
      {} as never,
    );
    (service as unknown as { consumeInvite: () => Promise<unknown> }).consumeInvite = async () => ({
      tenantId,
      email: failedActivationEmail,
      assignments: [],
    });

    await expect(service.activate('unused-token', failedActivationEmail, password)).rejects.toBe(
      databaseFailure,
    );
    await expect(
      service.activate('unused-token', existingEmail, password),
    ).rejects.not.toBeInstanceOf(BadRequestException);
  });
});
