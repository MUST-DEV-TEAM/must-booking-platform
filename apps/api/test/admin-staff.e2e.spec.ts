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

describe('tenant staff administration', () => {
  let app: INestApplication;
  let propertyManagerId: string;
  let frontDeskId: string;
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const propertyId = randomUUID();
  const ownerId = randomUUID();
  const adminId = randomUUID();
  const staffId = randomUUID();
  const targetId = randomUUID();
  const ownerEmail = `admin-owner-${randomUUID()}@example.test`;
  const adminEmail = `admin-admin-${randomUUID()}@example.test`;
  const staffEmail = `admin-staff-${randomUUID()}@example.test`;
  const targetEmail = `admin-target-${randomUUID()}@example.test`;
  const password = 'correct-horse-battery-staple';
  let adminCookie: string;
  let staffCookie: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(password, 12);
    await migrationPrisma.$executeRaw`
      INSERT INTO "organizations" ("id", "name") VALUES
        (${tenantId}::uuid, 'Admin API tenant'), (${otherTenantId}::uuid, 'Other tenant')
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "properties" ("id", "tenant_id", "name", "slug")
      VALUES (${propertyId}::uuid, ${tenantId}::uuid, 'Admin property', ${`admin-${propertyId}`})
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "users" ("id", "email", "password_hash") VALUES
        (${ownerId}::uuid, ${ownerEmail}, ${passwordHash}),
        (${adminId}::uuid, ${adminEmail}, ${passwordHash}),
        (${staffId}::uuid, ${staffEmail}, ${passwordHash}),
        (${targetId}::uuid, ${targetEmail}, ${passwordHash})
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "tenant_memberships" ("tenant_id", "user_id", "role") VALUES
        (${tenantId}::uuid, ${ownerId}::uuid, 'OWNER'),
        (${tenantId}::uuid, ${adminId}::uuid, 'ADMIN'),
        (${tenantId}::uuid, ${staffId}::uuid, 'STAFF'),
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
    const templateRows = await migrationPrisma.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT "id", "name" FROM "property_role_templates"
      WHERE "tenant_id" = ${tenantId}::uuid AND "property_id" = ${propertyId}::uuid
    `;
    propertyManagerId = templateRows.find((template) => template.name === 'Property Manager')!.id;
    frontDeskId = templateRows.find((template) => template.name === 'Front Desk')!.id;
    adminCookie = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: adminEmail, password })
        .expect(201)
    ).headers['set-cookie'][0] as string;
    staffCookie = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: staffEmail, password })
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
    await migrationPrisma.$executeRaw`DELETE FROM "users" WHERE "id" IN (${ownerId}::uuid, ${adminId}::uuid, ${staffId}::uuid, ${targetId}::uuid)`;
    await migrationPrisma.$executeRaw`DELETE FROM "organizations" WHERE "id" IN (${tenantId}::uuid, ${otherTenantId}::uuid)`;
    await app.close();
    await migrationPrisma.$disconnect();
  });

  it('lets a Tenant Admin manage memberships and property-staff assignments only within its tenant', async () => {
    const memberships = await request(app.getHttpServer())
      .get(`/tenants/${tenantId}/memberships`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(memberships.body).toEqual(
      expect.arrayContaining([
        { userId: targetId, email: targetEmail, role: 'STAFF' },
        { userId: ownerId, email: ownerEmail, role: 'OWNER' },
      ]),
    );

    await request(app.getHttpServer())
      .patch(`/tenants/${tenantId}/memberships/${targetId}`)
      .set('Cookie', adminCookie)
      .send({ role: 'ADMIN' })
      .expect(403);
    await migrationPrisma.$executeRaw`
      UPDATE "users" SET "email_verified_at" = CURRENT_TIMESTAMP WHERE "id" = ${adminId}::uuid
    `;

    await request(app.getHttpServer())
      .patch(`/tenants/${tenantId}/memberships/${targetId}`)
      .set('Cookie', adminCookie)
      .send({ role: 'ADMIN' })
      .expect(204);
    await request(app.getHttpServer())
      .patch(`/tenants/${tenantId}/memberships/${ownerId}`)
      .set('Cookie', adminCookie)
      .send({ role: 'STAFF' })
      .expect(403);

    await request(app.getHttpServer())
      .put(`/tenants/${tenantId}/properties/${propertyId}/staff/${targetId}`)
      .set('Cookie', adminCookie)
      .send({ roleTemplateId: propertyManagerId })
      .expect(204);
    await request(app.getHttpServer())
      .put(`/tenants/${tenantId}/properties/${propertyId}/staff/${targetId}`)
      .set('Cookie', adminCookie)
      .send({ roleTemplateId: frontDeskId })
      .expect(204);

    const assignments = await request(app.getHttpServer())
      .get(`/tenants/${tenantId}/properties/${propertyId}/staff`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(assignments.body).toEqual([
      {
        userId: targetId,
        email: targetEmail,
        roleTemplateId: frontDeskId,
        roleTemplateName: 'Front Desk',
        overrides: [],
      },
    ]);

    await request(app.getHttpServer())
      .put(
        `/tenants/${tenantId}/properties/${propertyId}/staff/${targetId}/capabilities/settings.manage`,
      )
      .set('Cookie', adminCookie)
      .send({ granted: true })
      .expect(204);
    await request(app.getHttpServer())
      .put(
        `/tenants/${tenantId}/properties/${propertyId}/staff/${targetId}/capabilities/settings.manage`,
      )
      .set('Cookie', adminCookie)
      .send({ granted: false })
      .expect(204);
    const overrides = await migrationPrisma.$queryRaw<Array<{ granted: boolean }>>`
      SELECT "granted" FROM "property_staff_capability_overrides" o
      JOIN "capabilities" c ON c."tenant_id" = o."tenant_id" AND c."id" = o."capability_id"
      WHERE o."tenant_id" = ${tenantId}::uuid AND o."property_id" = ${propertyId}::uuid
        AND o."user_id" = ${targetId}::uuid AND c."key" = 'settings.manage'
    `;
    expect(overrides).toEqual([{ granted: false }]);

    await request(app.getHttpServer())
      .get(`/tenants/${otherTenantId}/memberships`)
      .set('Cookie', adminCookie)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/tenants/${tenantId}/memberships`)
      .set('Cookie', staffCookie)
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/tenants/${tenantId}/memberships/${targetId}`)
      .set('Cookie', adminCookie)
      .expect(204);
    const removed = await migrationPrisma.$queryRaw<Array<{ found: number }>>`
      SELECT 1 AS found FROM "tenant_memberships"
      WHERE "tenant_id" = ${tenantId}::uuid AND "user_id" = ${targetId}::uuid
    `;
    expect(removed).toEqual([]);
  });
});
