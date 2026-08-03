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

describe('page-visibility capabilities', () => {
  let app: INestApplication;
  const tenantId = randomUUID();
  const propertyId = randomUUID();
  const roomTypeId = randomUUID();
  const financeUserId = randomUUID();
  const frontDeskUserId = randomUUID();
  const financeEmail = `finance-${randomUUID()}@example.test`;
  const frontDeskEmail = `front-desk-${randomUUID()}@example.test`;
  const password = 'correct-horse-battery-staple';
  let financeCookie = '';
  let frontDeskCookie = '';

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(password, 12);
    await migrationPrisma.$executeRaw`
      INSERT INTO organizations (id, name) VALUES (${tenantId}::uuid, 'Page visibility tenant')
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO properties (id, tenant_id, name, slug, timezone)
      VALUES (${propertyId}::uuid, ${tenantId}::uuid, 'Page visibility hotel', 'page-visibility', 'UTC')
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO room_types (id, tenant_id, property_id, name, max_occupancy)
      VALUES (${roomTypeId}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, 'Standard room', 2)
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO inventory_units (tenant_id, property_id, room_type_id, stays_on, available_units)
      VALUES (${tenantId}::uuid, ${propertyId}::uuid, ${roomTypeId}::uuid, '2040-01-01'::date, 1)
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO users (id, email, password_hash, email_verified_at)
      VALUES
        (${financeUserId}::uuid, ${financeEmail}, ${passwordHash}, CURRENT_TIMESTAMP),
        (${frontDeskUserId}::uuid, ${frontDeskEmail}, ${passwordHash}, CURRENT_TIMESTAMP)
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO tenant_memberships (tenant_id, user_id, role)
      VALUES
        (${tenantId}::uuid, ${financeUserId}::uuid, 'STAFF'),
        (${tenantId}::uuid, ${frontDeskUserId}::uuid, 'STAFF')
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
      SELECT id, name FROM property_role_templates
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
    `;
    const financeTemplateId = templateRows.find((template) => template.name === 'Finance')?.id;
    const frontDeskTemplateId = templateRows.find((template) => template.name === 'Front Desk')?.id;
    if (!financeTemplateId || !frontDeskTemplateId)
      throw new Error('Expected seeded role templates.');
    await migrationPrisma.$executeRaw`
      INSERT INTO property_staff_assignments (tenant_id, property_id, user_id, role_template_id)
      VALUES
        (${tenantId}::uuid, ${propertyId}::uuid, ${financeUserId}::uuid, ${financeTemplateId}::uuid),
        (${tenantId}::uuid, ${propertyId}::uuid, ${frontDeskUserId}::uuid, ${frontDeskTemplateId}::uuid)
    `;
    financeCookie = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: financeEmail, password })
        .expect(201)
    ).headers['set-cookie'][0] as string;
    frontDeskCookie = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: frontDeskEmail, password })
        .expect(201)
    ).headers['set-cookie'][0] as string;
  });

  afterAll(async () => {
    await migrationPrisma.$executeRaw`DELETE FROM property_staff_assignments WHERE tenant_id = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM property_role_template_capabilities WHERE tenant_id = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM property_role_templates WHERE tenant_id = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM capabilities WHERE tenant_id = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM inventory_units WHERE tenant_id = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM room_types WHERE tenant_id = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM tenant_memberships WHERE tenant_id = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM properties WHERE id = ${propertyId}::uuid`;
    await migrationPrisma.$executeRaw`
      DELETE FROM users WHERE id IN (${financeUserId}::uuid, ${frontDeskUserId}::uuid)
    `;
    await migrationPrisma.$executeRaw`DELETE FROM organizations WHERE id = ${tenantId}::uuid`;
    await app.close();
    await migrationPrisma.$disconnect();
  });

  it('enforces page capabilities while preserving Front Desk booking and calendar access', async () => {
    const propertyUrl = `/tenants/${tenantId}/properties/${propertyId}`;
    await request(app.getHttpServer())
      .get(`${propertyUrl}/capabilities/mine`)
      .set('Cookie', financeCookie)
      .expect(200)
      .expect((response) => {
        expect(response.body.sort()).toEqual(['payments.refund', 'reports.view']);
      });
    await request(app.getHttpServer())
      .get(`${propertyUrl}/reports?from=2040-01-01&to=2040-01-01`)
      .set('Cookie', financeCookie)
      .expect(200);
    for (const path of [
      `${propertyUrl}/bookings`,
      `${propertyUrl}/availability?roomTypeId=${roomTypeId}&startsOn=2040-01-01&endsOn=2040-01-02`,
      `${propertyUrl}/guests`,
    ]) {
      await request(app.getHttpServer()).get(path).set('Cookie', financeCookie).expect(403);
    }

    await request(app.getHttpServer())
      .get(`${propertyUrl}/capabilities/mine`)
      .set('Cookie', frontDeskCookie)
      .expect(200)
      .expect((response) => {
        expect(response.body.sort()).toEqual(['bookings.manage', 'calendar.view', 'guests.manage']);
      });
    await request(app.getHttpServer())
      .get(`${propertyUrl}/bookings`)
      .set('Cookie', frontDeskCookie)
      .expect(200)
      .expect([]);
    await request(app.getHttpServer())
      .get(
        `${propertyUrl}/availability?roomTypeId=${roomTypeId}&startsOn=2040-01-01&endsOn=2040-01-02`,
      )
      .set('Cookie', frontDeskCookie)
      .expect(200)
      .expect({
        roomTypeId,
        startsOn: '2040-01-01',
        endsOn: '2040-01-02',
        availableUnits: 1,
        isAvailable: true,
      });
  });
});
