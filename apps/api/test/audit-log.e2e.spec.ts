import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PropertyRoleTemplatesService } from '../src/tenancy/property-role-templates.service';

const migrationPrisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('audit logs', () => {
  let app: INestApplication;
  let frontDeskId: string;
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const propertyId = randomUUID();
  const ownerId = randomUUID();
  const targetId = randomUUID();
  const ownerEmail = `audit-owner-${randomUUID()}@example.test`;
  const targetEmail = `audit-target-${randomUUID()}@example.test`;
  const inviteeEmail = `audit-invitee-${randomUUID()}@example.test`;
  const password = 'correct-horse-battery-staple';
  let ownerCookie: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(password, 12);
    await migrationPrisma.$executeRaw`
      INSERT INTO "organizations" ("id", "name") VALUES
        (${tenantId}::uuid, 'Audit tenant'), (${otherTenantId}::uuid, 'Other audit tenant')
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "properties" ("id", "tenant_id", "name", "slug")
      VALUES (${propertyId}::uuid, ${tenantId}::uuid, 'Audit property', ${`audit-${propertyId}`})
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "users" ("id", "email", "password_hash", "email_verified_at") VALUES
        (${ownerId}::uuid, ${ownerEmail}, ${passwordHash}, CURRENT_TIMESTAMP),
        (${targetId}::uuid, ${targetEmail}, ${passwordHash}, CURRENT_TIMESTAMP)
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "tenant_memberships" ("tenant_id", "user_id", "role") VALUES
        (${tenantId}::uuid, ${ownerId}::uuid, 'OWNER'),
        (${tenantId}::uuid, ${targetId}::uuid, 'STAFF')
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
    const templates = moduleRef.get(PropertyRoleTemplatesService);
    await templates.ensureBuiltInTemplates(tenantId, propertyId);
    const templatesRows = await migrationPrisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "property_role_templates"
      WHERE "tenant_id" = ${tenantId}::uuid AND "property_id" = ${propertyId}::uuid AND "name" = 'Front Desk'
    `;
    frontDeskId = templatesRows[0].id;
    ownerCookie = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: ownerEmail, password })
        .expect(201)
    ).headers['set-cookie'][0] as string;
  });

  afterAll(async () => {
    await migrationPrisma.$executeRaw`DELETE FROM "audit_logs" WHERE "actor_user_id" IN (${ownerId}::uuid, ${targetId}::uuid)`;
    await migrationPrisma.$executeRaw`DELETE FROM "property_staff_capability_overrides" WHERE "tenant_id" = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "property_staff_assignments" WHERE "tenant_id" = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "property_role_template_capabilities" WHERE "tenant_id" = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "property_role_templates" WHERE "tenant_id" = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "capabilities" WHERE "tenant_id" = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "tenant_memberships" WHERE "tenant_id" = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "properties" WHERE "id" = ${propertyId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "users" WHERE "id" IN (${ownerId}::uuid, ${targetId}::uuid)`;
    await migrationPrisma.$executeRaw`DELETE FROM "organizations" WHERE "id" IN (${tenantId}::uuid, ${otherTenantId}::uuid)`;
    await app.close();
    await migrationPrisma.$disconnect();
  });

  it('records sensitive tenant actions and exposes only the current tenant audit feed', async () => {
    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/staff-invitations`)
      .set('Cookie', ownerCookie)
      .send({
        email: inviteeEmail,
        assignments: [{ propertyId, roleTemplateId: frontDeskId }],
      })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/tenants/${tenantId}/memberships/${targetId}`)
      .set('Cookie', ownerCookie)
      .send({ role: 'ADMIN' })
      .expect(204);
    await request(app.getHttpServer())
      .put(`/tenants/${tenantId}/properties/${propertyId}/staff/${targetId}`)
      .set('Cookie', ownerCookie)
      .send({ roleTemplateId: frontDeskId })
      .expect(204);
    await request(app.getHttpServer())
      .put(
        `/tenants/${tenantId}/properties/${propertyId}/staff/${targetId}/capabilities/settings.manage`,
      )
      .set('Cookie', ownerCookie)
      .send({ granted: true })
      .expect(204);
    await request(app.getHttpServer())
      .put(
        `/tenants/${tenantId}/properties/${propertyId}/staff/${targetId}/capabilities/settings.manage`,
      )
      .set('Cookie', ownerCookie)
      .send({ granted: false })
      .expect(204);

    const response = await request(app.getHttpServer())
      .get(`/tenants/${tenantId}/audit-logs`)
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(response.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorUserId: ownerId,
          action: 'staff.invite_created',
          targetType: 'staff_invitation',
          targetId: inviteeEmail,
          propertyId: null,
        }),
        expect.objectContaining({
          actorUserId: ownerId,
          action: 'membership.role_changed',
          targetType: 'user',
          targetId,
          propertyId: null,
        }),
        expect.objectContaining({
          action: 'property_staff.assigned',
          targetId,
          propertyId,
        }),
        expect.objectContaining({ action: 'capability.override_granted', targetId, propertyId }),
        expect.objectContaining({ action: 'capability.override_revoked', targetId, propertyId }),
      ]),
    );
    await request(app.getHttpServer())
      .get(`/tenants/${otherTenantId}/audit-logs`)
      .set('Cookie', ownerCookie)
      .expect(403);

    await request(app.getHttpServer()).post('/auth/logout').set('Cookie', ownerCookie).expect(204);
    const globalEvents = await migrationPrisma.$queryRaw<
      Array<{ action: string; targetId: string }>
    >`
      SELECT "action", "target_id" AS "targetId" FROM "audit_logs"
      WHERE "tenant_id" IS NULL AND "actor_user_id" = ${ownerId}::uuid
      ORDER BY "created_at"
    `;
    expect(globalEvents).toEqual(
      expect.arrayContaining([
        { action: 'auth.login', targetId: ownerId },
        { action: 'auth.logout', targetId: ownerId },
      ]),
    );
  });
});
