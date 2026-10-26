import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PropertyRoleTemplatesService } from '../src/tenancy/property-role-templates.service';
import { ReportDefinitionsService } from '../src/tenancy/report-definitions.service';
import { cleanupTenant } from './helpers/cleanup-tenant';

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('Reports R1 Definitions API using real scoped database and HTTP guards', () => {
  let app: INestApplication;
  let templates: PropertyRoleTemplatesService;
  const tenantId = randomUUID(),
    otherTenant = randomUUID();
  const propertyId = randomUUID(),
    otherProperty = randomUUID(),
    foreignProperty = randomUUID();
  const userId = randomUUID(),
    connectionId = randomUUID();
  const email = `reports-${randomUUID()}@example.test`,
    password = randomUUID() + randomUUID();
  let cookie = '';
  const path = (tenant = tenantId, property = propertyId) =>
    `/tenants/${tenant}/properties/${property}/reports/definitions`;

  beforeAll(async () => {
    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL =
      'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.WEB_APP_URL = 'http://localhost:3001';
    const { AppModule } = await import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    await app.init();
    templates = module.get(PropertyRoleTemplatesService);
    const hash = await bcrypt.hash(password, 12);
    await admin.$executeRaw`INSERT INTO organizations(id,name) VALUES(${tenantId}::uuid,'Reports'),(${otherTenant}::uuid,'Other reports')`;
    await admin.$executeRaw`INSERT INTO properties(id,tenant_id,name,slug,timezone) VALUES
      (${propertyId}::uuid,${tenantId}::uuid,'Local','r1-local','Europe/Tirane'),
      (${otherProperty}::uuid,${tenantId}::uuid,'Unassigned','r1-other','Pacific/Auckland'),
      (${foreignProperty}::uuid,${otherTenant}::uuid,'Foreign','r1-foreign','UTC')`;
    await admin.$executeRaw`INSERT INTO users(id,email,password_hash,email_verified_at) VALUES(${userId}::uuid,${email},${hash},now())`;
    await admin.$executeRaw`INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES(${tenantId}::uuid,${userId}::uuid,'STAFF')`;
    await templates.ensureBuiltInTemplates(tenantId, propertyId);
    const roles = await admin.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM property_role_templates WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND name='Front Desk'`;
    await admin.$executeRaw`INSERT INTO property_staff_assignments(tenant_id,property_id,user_id,role_template_id) VALUES(${tenantId}::uuid,${propertyId}::uuid,${userId}::uuid,${roles[0]!.id}::uuid)`;
    cookie = (
      await request(app.getHttpServer()).post('/auth/login').send({ email, password }).expect(201)
    ).headers['set-cookie'][0] as string;
  });

  afterAll(async () => {
    await cleanupTenant(admin, tenantId);
    await cleanupTenant(admin, otherTenant);
    await admin.$executeRaw`DELETE FROM users WHERE id=${userId}::uuid`;
    await app?.close();
    await admin.$disconnect();
  });

  it('fails closed without session or reports.view', async () => {
    await request(app.getHttpServer()).get(path()).expect(401);
    await request(app.getHttpServer()).get(path()).set('Cookie', cookie).expect(403);
  });

  it('returns property-local non-money definitions with reports-only access', async () => {
    await templates.setCapabilityOverride(tenantId, propertyId, userId, 'reports.view', true);
    const result = await request(app.getHttpServer()).get(path()).set('Cookie', cookie).expect(200);
    expect(result.body).toMatchObject({
      timezone: 'Europe/Tirane',
      source: 'LOCAL',
      basis: 'MUST locally stored records',
    });
    expect(result.body.definitions.some((d: { key: string }) => d.key === 'occupancy')).toBe(true);
    expect(result.body.definitions.every((d: { money: boolean }) => !d.money)).toBe(true);
  });

  it('rechecks money permission after grant and revocation', async () => {
    await templates.setCapabilityOverride(tenantId, propertyId, userId, 'payments.view', true);
    const allowed = await request(app.getHttpServer())
      .get(path())
      .set('Cookie', cookie)
      .expect(200);
    expect(allowed.body.definitions.some((d: { key: string }) => d.key === 'adr')).toBe(true);
    await templates.setCapabilityOverride(tenantId, propertyId, userId, 'payments.view', false);
    const denied = await request(app.getHttpServer()).get(path()).set('Cookie', cookie).expect(200);
    expect(denied.body.definitions.some((d: { money: boolean }) => d.money)).toBe(false);
  });

  it('rejects cross-tenant and unassigned-property access including swapped IDs', async () => {
    for (const route of [
      path(tenantId, otherProperty),
      path(otherTenant, foreignProperty),
      path(tenantId, foreignProperty),
    ])
      await request(app.getHttpServer()).get(route).set('Cookie', cookie).expect(403);
    await expect(
      app.get(ReportDefinitionsService).get(tenantId, foreignProperty, true),
    ).rejects.toThrow('Property not found');
  });

  it('uses enabled Clock assignment even when connection failed, without provider requests', async () => {
    await admin.$executeRaw`INSERT INTO integration_connections(id,tenant_id,kind,provider,name,encrypted_credentials,status)
      VALUES(${connectionId}::uuid,${tenantId}::uuid,'PMS','CLOCK_PMS','Local fixture','unused-test-no-provider-credentials','FAILED')`;
    await admin.$executeRaw`INSERT INTO property_integration_connections(tenant_id,property_id,connection_id,kind,enabled)
      VALUES(${tenantId}::uuid,${propertyId}::uuid,${connectionId}::uuid,'PMS',true)`;
    const result = await request(app.getHttpServer()).get(path()).set('Cookie', cookie).expect(200);
    expect(result.body.source).toBe('CLOCK');
    expect(result.body.basis).toContain('inventory Unknown');
    expect(JSON.stringify(result.body)).not.toContain('unused-test');
    await admin.$executeRaw`UPDATE property_integration_connections SET enabled=false WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND connection_id=${connectionId}::uuid`;
    const local = await request(app.getHttpServer()).get(path()).set('Cookie', cookie).expect(200);
    expect(local.body.source).toBe('LOCAL');
  });

  it('immediately blocks a suspended assignment', async () => {
    await admin.$executeRaw`UPDATE property_staff_assignments SET suspended_at=now() WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND user_id=${userId}::uuid`;
    await request(app.getHttpServer()).get(path()).set('Cookie', cookie).expect(403);
  });
});
