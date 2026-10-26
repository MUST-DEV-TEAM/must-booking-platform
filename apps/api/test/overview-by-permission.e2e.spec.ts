import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PropertyRoleTemplatesService } from '../src/tenancy/property-role-templates.service';
import { cleanupTenant } from './helpers/cleanup-tenant';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';
import { withoutExternalWorkers } from './helpers/without-external-workers';

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('Overview by permission', () => {
  const ownerEmail = `overview-owner-${randomUUID()}@example.test`;
  const password = 'correct-horse-battery-staple';
  const staffUsers: string[] = [];
  let app: INestApplication;
  let tenantId = '';
  let propertyId = '';
  let ownerId = '';
  let ownerCookie = '';
  const http = () => request(app.getHttpServer());
  const roles = () => `/tenants/${tenantId}/properties/${propertyId}/role-templates`;
  const overview = (cookie: string) =>
    http().get(`/tenants/${tenantId}/properties/${propertyId}/overview`).set('Cookie', cookie);

  async function staffWithRole(roleName: string): Promise<string> {
    const email = `overview-staff-${randomUUID()}@example.test`;
    const id = randomUUID();
    staffUsers.push(id);
    const hash = await bcrypt.hash(password, 4);
    await admin.$executeRaw`INSERT INTO users(id,email,password_hash,email_verified_at) VALUES(${id}::uuid,${email},${hash},now())`;
    await admin.$executeRaw`INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES(${tenantId}::uuid,${id}::uuid,'STAFF')`;
    await admin.$executeRaw`INSERT INTO property_staff_assignments(tenant_id,property_id,user_id,role_template_id)
      SELECT ${tenantId}::uuid,${propertyId}::uuid,${id}::uuid,id FROM property_role_templates
      WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND name=${roleName}`;
    const login = await http().post('/auth/login').send({ email, password }).expect(201);
    return login.headers['set-cookie'][0];
  }

  beforeAll(async () => {
    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL =
      'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.WEB_APP_URL = 'http://localhost:3001';
    await clearSignupRateLimits();
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await withoutExternalWorkers(
      Test.createTestingModule({ imports: [AppModule] }),
    ).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const signup = await http()
      .post('/auth/signup')
      .send({
        organizationName: 'Overview Fixture Group',
        propertyName: 'Overview Fixture Hotel',
        propertyAddress: '1 Overview Way',
        propertyTimezone: 'Europe/Tirane',
        email: ownerEmail,
        password,
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    propertyId = signup.body.property.id;
    ownerId = signup.body.user.id;
    ownerCookie = signup.headers['set-cookie'][0];
    await admin.$executeRaw`UPDATE users SET email_verified_at=now() WHERE id=${ownerId}::uuid`;
    await moduleRef.get(PropertyRoleTemplatesService).ensureBuiltInTemplates(tenantId, propertyId);
  });

  afterAll(async () => {
    if (app) await app.close();
    if (tenantId) await cleanupTenant(admin, tenantId);
    for (const id of [ownerId, ...staffUsers])
      if (id) await admin.$executeRaw`DELETE FROM users WHERE id=${id}::uuid`;
    await admin.$disconnect();
  });

  it('gives owners the manager view and lets a custom role choose its Overview type', async () => {
    const owner = (await overview(ownerCookie).expect(200)).body;
    expect(owner.view.type).toBe('owner_manager');
    expect(owner.view.widgets).toContain('tile.collectedToday');

    await http()
      .post(roles())
      .set('Cookie', ownerCookie)
      .send({ name: 'Bad', capabilities: ['payments.view'], overviewType: 'nonsense' })
      .expect(400);
    const created = await http()
      .post(roles())
      .set('Cookie', ownerCookie)
      .send({ name: 'Cashier', capabilities: ['payments.view'], overviewType: 'finance' })
      .expect(201);
    expect(created.body.overviewType).toBe('finance');
    const updated = await http()
      .put(`${roles()}/${created.body.id}`)
      .set('Cookie', ownerCookie)
      .send({ overviewType: 'minimal' })
      .expect(200);
    expect(updated.body.overviewType).toBe('minimal');
    await http()
      .put(`${roles()}/${created.body.id}`)
      .set('Cookie', ownerCookie)
      .send({ overviewType: 'finance' })
      .expect(200);
    const list = (await http().get(roles()).set('Cookie', ownerCookie).expect(200)).body;
    expect(list.find((r: { name: string }) => r.name === 'Front Desk').overviewType).toBe('auto');
  });

  it('shows a finance role only money widgets and sends no booking data at all', async () => {
    const cookie = await staffWithRole('Cashier');
    const body = (await overview(cookie).expect(200)).body;
    expect(body.view).toEqual({
      type: 'finance',
      widgets: ['tile.collectedToday', 'panel.myTasks'],
    });
    expect(body.todaysArrivals).toEqual([]);
    expect(body.needsAttention).toEqual([]);
    expect(body.upcomingArrivals).toEqual([]);
    expect(body.recentCancellations).toEqual([]);
    expect(body.kpis.arrivals).toBe(0);
  });

  it('gives Front Desk its own view without money widgets', async () => {
    const cookie = await staffWithRole('Front Desk');
    const body = (await overview(cookie).expect(200)).body;
    expect(body.view.type).toBe('front_desk');
    expect(body.view.widgets).toContain('list.arrivals');
    expect(body.view.widgets).not.toContain('tile.collectedToday');
    expect(body.view.widgets).not.toContain('tile.dueAtDesk');
    expect(body.revenue.byCurrency).toEqual([]);
  });
});
