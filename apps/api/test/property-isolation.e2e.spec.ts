import { randomUUID } from 'node:crypto';

import { Controller, Get, INestApplication, Req } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RequiresCapability } from '../src/tenancy/capabilities.decorator';
import { Role, Roles } from '../src/tenancy/roles.decorator';
import { TenantScoped } from '../src/tenancy/tenant-context.decorator';

let handlerCalls = 0;

@Controller('property-isolation-test')
class PropertyIsolationTestController {
  @Get(':tenantId/properties/:propertyId/settings')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.PropertyStaff)
  @RequiresCapability('settings.manage')
  settings(@Req() request: { tenantContext: unknown }): unknown {
    handlerCalls += 1;
    return request.tenantContext;
  }
}

const migrationPrisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('property access isolation', () => {
  let app: INestApplication;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const propertyA = randomUUID();
  const propertyA2 = randomUUID();
  const propertyB = randomUUID();
  const userId = randomUUID();
  const capabilityId = randomUUID();
  const templateId = randomUUID();
  const email = `property-isolation-${randomUUID()}@example.test`;
  const password = 'correct-horse-battery-staple';
  let cookie: string;

  beforeAll(async () => {
    await migrationPrisma.$executeRaw`
      INSERT INTO "organizations" ("id", "name") VALUES
        (${tenantA}::uuid, 'Property isolation A'), (${tenantB}::uuid, 'Property isolation B')
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "properties" ("id", "tenant_id", "name", "slug") VALUES
        (${propertyA}::uuid, ${tenantA}::uuid, 'Assigned property', 'assigned-${propertyA}'),
        (${propertyA2}::uuid, ${tenantA}::uuid, 'Unassigned property', 'unassigned-${propertyA2}'),
        (${propertyB}::uuid, ${tenantB}::uuid, 'Other tenant property', 'other-${propertyB}')
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "users" ("id", "email", "password_hash")
      VALUES (${userId}::uuid, ${email}, ${await bcrypt.hash(password, 12)})
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "tenant_memberships" ("tenant_id", "user_id", "role")
      VALUES (${tenantA}::uuid, ${userId}::uuid, 'STAFF')
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "capabilities" ("id", "tenant_id", "key")
      VALUES (${capabilityId}::uuid, ${tenantA}::uuid, 'settings.manage')
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "property_role_templates" ("id", "tenant_id", "property_id", "name", "kind")
      VALUES (${templateId}::uuid, ${tenantA}::uuid, ${propertyA}::uuid, 'Settings staff', 'CUSTOM')
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "property_role_template_capabilities" ("tenant_id", "property_id", "role_template_id", "capability_id")
      VALUES (${tenantA}::uuid, ${propertyA}::uuid, ${templateId}::uuid, ${capabilityId}::uuid)
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "property_staff_assignments" ("tenant_id", "property_id", "user_id", "role_template_id")
      VALUES (${tenantA}::uuid, ${propertyA}::uuid, ${userId}::uuid, ${templateId}::uuid)
    `;

    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL =
      'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [PropertyIsolationTestController],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    cookie = (
      await request(app.getHttpServer()).post('/auth/login').send({ email, password }).expect(201)
    ).headers['set-cookie'][0] as string;
  });

  afterAll(async () => {
    await migrationPrisma.$executeRaw`DELETE FROM "property_staff_assignments" WHERE "user_id" = ${userId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "property_role_template_capabilities" WHERE "role_template_id" = ${templateId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "property_role_templates" WHERE "id" = ${templateId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "capabilities" WHERE "id" = ${capabilityId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "tenant_memberships" WHERE "user_id" = ${userId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "properties" WHERE "id" IN (${propertyA}::uuid, ${propertyA2}::uuid, ${propertyB}::uuid)`;
    await migrationPrisma.$executeRaw`DELETE FROM "users" WHERE "id" = ${userId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "organizations" WHERE "id" IN (${tenantA}::uuid, ${tenantB}::uuid)`;
    await app.close();
    await migrationPrisma.$disconnect();
  });

  it('permits access only to the staff member’s assigned property', async () => {
    handlerCalls = 0;
    const allowed = await request(app.getHttpServer())
      .get(`/property-isolation-test/${tenantA}/properties/${propertyA}/settings`)
      .set('Cookie', cookie)
      .expect(200);
    expect(allowed.body).toEqual({ userId, tenantId: tenantA, propertyId: propertyA });
    expect(handlerCalls).toBe(1);

    handlerCalls = 0;
    await request(app.getHttpServer())
      .get(`/property-isolation-test/${tenantA}/properties/${propertyA2}/settings`)
      .set('Cookie', cookie)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/property-isolation-test/${tenantB}/properties/${propertyB}/settings`)
      .set('Cookie', cookie)
      .expect(403);
    expect(handlerCalls).toBe(0);
  });
});
