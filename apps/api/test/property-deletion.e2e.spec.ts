import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migrationPrisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('property deletion', () => {
  let app: INestApplication;
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const ownerId = randomUUID();
  const platformAdminId = randomUUID();
  const ownerEmail = `property-owner-${randomUUID()}@example.test`;
  const platformEmail = `property-platform-${randomUUID()}@example.test`;
  const ownerPropertyId = randomUUID();
  const platformPropertyId = randomUUID();
  const blockedPropertyId = randomUUID();
  const roomTypeId = randomUUID();
  let ownerCookie: string;
  let platformCookie: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('correct-horse-battery-staple', 12);
    await migrationPrisma.$executeRaw`
      INSERT INTO "organizations" ("id", "name") VALUES
        (${tenantId}::uuid, 'Property deletion tenant'),
        (${otherTenantId}::uuid, 'Other property deletion tenant')
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "properties" ("id", "tenant_id", "name", "slug") VALUES
        (${ownerPropertyId}::uuid, ${tenantId}::uuid, 'Owner empty property', 'owner-empty-property'),
        (${blockedPropertyId}::uuid, ${tenantId}::uuid, 'Blocked property', 'blocked-property'),
        (${platformPropertyId}::uuid, ${otherTenantId}::uuid, 'Platform empty property', 'platform-empty-property')
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "room_types" ("id", "tenant_id", "property_id", "name", "max_occupancy")
      VALUES (${roomTypeId}::uuid, ${tenantId}::uuid, ${blockedPropertyId}::uuid, 'Cannot delete me', 2)
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "users" ("id", "email", "password_hash", "email_verified_at", "is_platform_admin") VALUES
        (${ownerId}::uuid, ${ownerEmail}, ${passwordHash}, CURRENT_TIMESTAMP, false),
        (${platformAdminId}::uuid, ${platformEmail}, ${passwordHash}, CURRENT_TIMESTAMP, true)
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
    ownerCookie = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: ownerEmail, password: 'correct-horse-battery-staple' })
        .expect(201)
    ).headers['set-cookie'][0] as string;
    platformCookie = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: platformEmail, password: 'correct-horse-battery-staple' })
        .expect(201)
    ).headers['set-cookie'][0] as string;
  });

  afterAll(async () => {
    await migrationPrisma.$executeRaw`
      DELETE FROM "audit_logs" WHERE "actor_user_id" IN (${ownerId}::uuid, ${platformAdminId}::uuid)
    `;
    await migrationPrisma.$executeRaw`
      DELETE FROM "room_types" WHERE "id" = ${roomTypeId}::uuid
    `;
    await migrationPrisma.$executeRaw`
      DELETE FROM "properties" WHERE "id" IN (${ownerPropertyId}::uuid, ${blockedPropertyId}::uuid, ${platformPropertyId}::uuid)
    `;
    await migrationPrisma.$executeRaw`
      DELETE FROM "tenant_memberships" WHERE "tenant_id" = ${tenantId}::uuid
    `;
    await migrationPrisma.$executeRaw`
      DELETE FROM "users" WHERE "id" IN (${ownerId}::uuid, ${platformAdminId}::uuid)
    `;
    await migrationPrisma.$executeRaw`
      DELETE FROM "organizations" WHERE "id" IN (${tenantId}::uuid, ${otherTenantId}::uuid)
    `;
    await app.close();
    await migrationPrisma.$disconnect();
  });

  it('allows an owner to delete an empty property only in their own tenant and records the audit row', async () => {
    await request(app.getHttpServer())
      .delete(`/tenants/${tenantId}/properties/${platformPropertyId}`)
      .set('Cookie', ownerCookie)
      .send({ confirmationName: 'Platform empty property' })
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/tenants/${tenantId}/properties/${ownerPropertyId}`)
      .set('Cookie', ownerCookie)
      .send({ confirmationName: 'Owner empty property' })
      .expect(200)
      .expect({ deleted: true });

    const audit = await migrationPrisma.$queryRaw<Array<{ action: string; actorType: string }>>`
      SELECT "action", "actor_type"::text AS "actorType" FROM "audit_logs"
      WHERE "target_id" = ${ownerPropertyId}
    `;
    expect(audit).toContainEqual({ action: 'properties.remove', actorType: 'TENANT_USER' });
  });

  it('allows a platform admin to delete an empty property in another tenant and records the audit row', async () => {
    await request(app.getHttpServer())
      .delete(`/platform/tenants/${otherTenantId}/properties/${platformPropertyId}`)
      .set('Cookie', platformCookie)
      .send({ confirmationName: 'Platform empty property' })
      .expect(200)
      .expect({ deleted: true });

    const audit = await migrationPrisma.$queryRaw<Array<{ action: string; actorType: string }>>`
      SELECT "action", "actor_type"::text AS "actorType" FROM "audit_logs"
      WHERE "target_id" = ${platformPropertyId}
    `;
    expect(audit).toContainEqual({ action: 'properties.remove', actorType: 'PLATFORM_ADMIN' });
  });

  it('rejects deletion when dependent rows exist and reports the blockers without deleting anything', async () => {
    const response = await request(app.getHttpServer())
      .delete(`/tenants/${tenantId}/properties/${blockedPropertyId}`)
      .set('Cookie', ownerCookie)
      .send({ confirmationName: 'Blocked property' })
      .expect(409);

    expect(response.body.message).toBe(
      'This property cannot be deleted because dependent records still exist.',
    );
    expect(response.body.blockers).toContainEqual({ resource: 'room types', count: 1 });
    const remaining = await migrationPrisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "properties" WHERE "id" = ${blockedPropertyId}::uuid
    `;
    expect(remaining).toHaveLength(1);
  });
});
