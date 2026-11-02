import { randomUUID } from 'node:crypto';

import { Controller, Get, Post, Req } from '@nestjs/common';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AllowOnReadOnlyPlan, TenantScoped } from '../src/tenancy/tenant-context.decorator';

let handlerCalls = 0;

@Controller('tenant-context-test')
class TenantContextTestController {
  @Get(':tenantId/properties/:propertyId')
  @TenantScoped({ propertyParam: 'propertyId' })
  getContext(@Req() request: { tenantContext: unknown }): unknown {
    handlerCalls += 1;
    return request.tenantContext;
  }

  @Post(':tenantId/properties/:propertyId/write')
  @TenantScoped({ propertyParam: 'propertyId' })
  write(): unknown {
    handlerCalls += 1;
    return { ok: true };
  }

  @Post(':tenantId/properties/:propertyId/personal-write')
  @AllowOnReadOnlyPlan()
  @TenantScoped({ propertyParam: 'propertyId' })
  personalWrite(): unknown {
    handlerCalls += 1;
    return { ok: true };
  }
}

const migrationPrisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('tenant request context', () => {
  let app: INestApplication;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const propertyA = randomUUID();
  const propertyB = randomUUID();
  const userId = randomUUID();
  const readOnlyPlan = randomUUID();
  const email = `tenant-context-${randomUUID()}@example.test`;
  let cookie: string;

  beforeAll(async () => {
    await migrationPrisma.$executeRaw`
      INSERT INTO "organizations" ("id", "name") VALUES (${tenantA}::uuid, 'Context A'), (${tenantB}::uuid, 'Context B')
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "properties" ("id", "tenant_id", "name", "slug") VALUES
        (${propertyA}::uuid, ${tenantA}::uuid, 'Property A', 'context-a'),
        (${propertyB}::uuid, ${tenantB}::uuid, 'Property B', 'context-b')
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "users" ("id", "email", "password_hash") VALUES
        (${userId}::uuid, ${email}, ${await bcrypt.hash('correct-horse-battery-staple', 12)})
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "tenant_memberships" ("tenant_id", "user_id", "role") VALUES (${tenantA}::uuid, ${userId}::uuid, 'OWNER')
    `;

    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL =
      'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.WEB_APP_URL = 'http://localhost:3001';
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [TenantContextTestController],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'correct-horse-battery-staple' })
      .expect(201);
    cookie = login.headers['set-cookie'][0] as string;
  });

  afterAll(async () => {
    await migrationPrisma.$executeRaw`DELETE FROM "tenant_memberships" WHERE "user_id" = ${userId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "properties" WHERE "id" IN (${propertyA}::uuid, ${propertyB}::uuid)`;
    await migrationPrisma.$executeRaw`DELETE FROM "users" WHERE "id" = ${userId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "organizations" WHERE "id" IN (${tenantA}::uuid, ${tenantB}::uuid)`;
    await migrationPrisma.$executeRaw`DELETE FROM "plans" WHERE "id" = ${readOnlyPlan}::uuid`;
    await app.close();
    await migrationPrisma.$disconnect();
  });

  it('rejects requests without a session before reaching the handler', async () => {
    handlerCalls = 0;
    await request(app.getHttpServer())
      .get(`/tenant-context-test/${tenantA}/properties/${propertyA}`)
      .expect(401);
    expect(handlerCalls).toBe(0);
  });

  it('rejects tenant and property paths outside the session scope before reaching the handler', async () => {
    handlerCalls = 0;
    await request(app.getHttpServer())
      .get(`/tenant-context-test/${tenantB}/properties/${propertyB}`)
      .set('Cookie', cookie)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/tenant-context-test/${tenantA}/properties/${propertyB}`)
      .set('Cookie', cookie)
      .expect(403);
    expect(handlerCalls).toBe(0);
  });

  it('resolves the tenant and property context before the handler', async () => {
    handlerCalls = 0;
    const response = await request(app.getHttpServer())
      .get(`/tenant-context-test/${tenantA}/properties/${propertyA}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(response.body).toEqual({ userId, tenantId: tenantA, propertyId: propertyA });
    expect(handlerCalls).toBe(1);
  });

  it('lets a read-only plan read but refuses dashboard writes, except allow-listed ones', async () => {
    await migrationPrisma.$executeRaw`
      INSERT INTO "plans" ("id", "name", "max_properties", "max_staff_seats", "pms_enabled", "max_pms_connections_per_property", "read_only")
      VALUES (${readOnlyPlan}::uuid, ${`Read-only ${readOnlyPlan}`}, 1, 1, false, 0, true)
    `;
    await migrationPrisma.$executeRaw`UPDATE "organizations" SET "plan_id" = ${readOnlyPlan}::uuid WHERE "id" = ${tenantA}::uuid`;
    const base = `/tenant-context-test/${tenantA}/properties/${propertyA}`;
    handlerCalls = 0;
    await request(app.getHttpServer()).get(base).set('Cookie', cookie).expect(200);
    const refused = await request(app.getHttpServer())
      .post(`${base}/write`)
      .set('Cookie', cookie)
      .expect(403);
    expect(refused.body.code).toBe('PLAN_READ_ONLY');
    await request(app.getHttpServer())
      .post(`${base}/personal-write`)
      .set('Cookie', cookie)
      .expect(201);
    expect(handlerCalls).toBe(2);
  });
});
