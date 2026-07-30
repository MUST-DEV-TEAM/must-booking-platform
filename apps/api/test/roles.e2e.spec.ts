import { randomUUID } from 'node:crypto';

import { Controller, Get } from '@nestjs/common';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Role, Roles } from '../src/tenancy/roles.decorator';
import { TenantScoped } from '../src/tenancy/tenant-context.decorator';

@Controller('roles-test')
class RolesTestController {
  @Get(':tenantId/owner-only')
  @TenantScoped()
  @Roles(Role.TenantOwner)
  ownerOnly(): { allowed: true } {
    return { allowed: true };
  }
}

const migrationPrisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('role guard', () => {
  let app: INestApplication;
  const tenantId = randomUUID();
  const ownerId = randomUUID();
  const adminId = randomUUID();
  const ownerEmail = `owner-${randomUUID()}@example.test`;
  const adminEmail = `admin-${randomUUID()}@example.test`;
  const password = 'correct-horse-battery-staple';
  let ownerCookie: string;
  let adminCookie: string;

  beforeAll(async () => {
    const hash = await bcrypt.hash(password, 12);
    await migrationPrisma.$executeRaw`INSERT INTO "organizations" ("id", "name") VALUES (${tenantId}::uuid, 'Roles tenant')`;
    await migrationPrisma.$executeRaw`
      INSERT INTO "users" ("id", "email", "password_hash") VALUES
        (${ownerId}::uuid, ${ownerEmail}, ${hash}), (${adminId}::uuid, ${adminEmail}, ${hash})
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "tenant_memberships" ("tenant_id", "user_id", "role") VALUES
        (${tenantId}::uuid, ${ownerId}::uuid, 'OWNER'), (${tenantId}::uuid, ${adminId}::uuid, 'ADMIN')
    `;
    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL =
      'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.WEB_APP_URL = 'http://localhost:3001';
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [RolesTestController],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    ownerCookie = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: ownerEmail, password })
        .expect(201)
    ).headers['set-cookie'][0] as string;
    adminCookie = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: adminEmail, password })
        .expect(201)
    ).headers['set-cookie'][0] as string;
  });

  afterAll(async () => {
    await migrationPrisma.$executeRaw`DELETE FROM "tenant_memberships" WHERE "tenant_id" = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "users" WHERE "id" IN (${ownerId}::uuid, ${adminId}::uuid)`;
    await migrationPrisma.$executeRaw`DELETE FROM "organizations" WHERE "id" = ${tenantId}::uuid`;
    await app.close();
    await migrationPrisma.$disconnect();
  });

  it('denies a Tenant Admin and permits the Tenant Owner on an owner-only endpoint', async () => {
    await request(app.getHttpServer())
      .get(`/roles-test/${tenantId}/owner-only`)
      .set('Cookie', adminCookie)
      .expect(403);
    const response = await request(app.getHttpServer())
      .get(`/roles-test/${tenantId}/owner-only`)
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(response.body).toEqual({ allowed: true });
  });
});
