import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PropertyRoleTemplatesService } from '../src/tenancy/property-role-templates.service';
import { MailDeliveryService } from '../src/mail/mail-delivery.service';

const migrationPrisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('staff access: create staff, custom roles, suspension and the rules around them', () => {
  let app: INestApplication;
  let frontDeskId: string;
  let managerId: string;
  const tenantId = randomUUID();
  const propertyId = randomUUID();
  const otherPropertyId = randomUUID();
  const adminId = randomUUID();
  const ownerId = randomUUID();
  const leadId = randomUUID();
  const noCreateId = randomUUID();
  const adminEmail = `access-admin-${randomUUID()}@example.test`;
  const ownerEmail = `access-owner-${randomUUID()}@example.test`;
  const leadEmail = `access-lead-${randomUUID()}@example.test`;
  const noCreateEmail = `access-no-create-${randomUUID()}@example.test`;
  const newEmail = `access-new-${randomUUID()}@example.test`;
  const password = 'correct-horse-battery-staple';
  const chosenPassword = 'My-Own-Password-2026';
  let adminCookie: string;
  let ownerCookie: string;
  let leadCookie: string;
  let noCreateCookie: string;
  let createdUserId: string;
  let inviteableRoleId: string;
  let foreignRoleId: string;
  const base = `/tenants/${tenantId}/properties/${propertyId}`;

  const login = async (email: string, pass: string) =>
    (await request(app.getHttpServer()).post('/auth/login').send({ email, password: pass }).expect(201))
      .headers['set-cookie'][0] as string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(password, 12);
    await migrationPrisma.$executeRaw`INSERT INTO "organizations" ("id", "name") VALUES (${tenantId}::uuid, 'Staff access tenant')`;
    await migrationPrisma.$executeRaw`
      UPDATE "organizations" SET "plan_id" = '00000000-0000-0000-0000-000000000099'::uuid
      WHERE "id" = ${tenantId}::uuid
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "properties" ("id", "tenant_id", "name", "slug")
      VALUES (${propertyId}::uuid, ${tenantId}::uuid, 'Access property', ${`access-${propertyId}`})
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "properties" ("id", "tenant_id", "name", "slug")
      VALUES (${otherPropertyId}::uuid, ${tenantId}::uuid, 'Other access property', ${`access-${otherPropertyId}`})
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "users" ("id", "email", "password_hash", "email_verified_at") VALUES
        (${adminId}::uuid, ${adminEmail}, ${passwordHash}, CURRENT_TIMESTAMP),
        (${leadId}::uuid, ${leadEmail}, ${passwordHash}, CURRENT_TIMESTAMP)
    `;
    const additionalPasswordHash = await bcrypt.hash(chosenPassword, 4);
    await migrationPrisma.$executeRaw`
      INSERT INTO "users" ("id", "email", "password_hash", "email_verified_at") VALUES
        (${ownerId}::uuid, ${ownerEmail}, ${additionalPasswordHash}, CURRENT_TIMESTAMP),
        (${noCreateId}::uuid, ${noCreateEmail}, ${additionalPasswordHash}, CURRENT_TIMESTAMP)
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "tenant_memberships" ("tenant_id", "user_id", "role") VALUES
        (${tenantId}::uuid, ${adminId}::uuid, 'ADMIN'),
        (${tenantId}::uuid, ${ownerId}::uuid, 'OWNER'),
        (${tenantId}::uuid, ${noCreateId}::uuid, 'STAFF'),
        (${tenantId}::uuid, ${leadId}::uuid, 'STAFF')
    `;
    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL = 'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.WEB_APP_URL = 'http://localhost:3001';
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailDeliveryService)
      .useValue({ async dispatch() {} })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await moduleRef.get(PropertyRoleTemplatesService).ensureBuiltInTemplates(tenantId, propertyId);
    await moduleRef.get(PropertyRoleTemplatesService).ensureBuiltInTemplates(tenantId, otherPropertyId);
    const roles = await migrationPrisma.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT "id", "name" FROM "property_role_templates" WHERE "tenant_id" = ${tenantId}::uuid AND "property_id" = ${propertyId}::uuid
    `;
    frontDeskId = roles.find((role) => role.name === 'Front Desk')!.id;
    managerId = roles.find((role) => role.name === 'Property Manager')!.id;
    const foreignRoles = await migrationPrisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "property_role_templates"
      WHERE "tenant_id" = ${tenantId}::uuid AND "property_id" = ${otherPropertyId}::uuid AND "name" = 'Front Desk'
    `;
    foreignRoleId = foreignRoles[0]!.id;
    ownerCookie = await login(ownerEmail, chosenPassword);
    noCreateCookie = await login(noCreateEmail, chosenPassword);
    adminCookie = await login(adminEmail, password);
    // A lead who may see staff, add staff and manage roles, and nothing else.
    const leadRole = await request(app.getHttpServer())
      .post(`${base}/role-templates`)
      .set('Cookie', adminCookie)
      .send({ name: 'Team lead', capabilities: ['staff.view', 'staff.create', 'staff.manage_roles', 'bookings.view'] })
      .expect(201);
    await migrationPrisma.$executeRaw`
      INSERT INTO "property_staff_assignments" ("tenant_id", "property_id", "user_id", "role_template_id")
      VALUES (${tenantId}::uuid, ${propertyId}::uuid, ${leadId}::uuid, ${leadRole.body.id as string}::uuid)
    `;
    const inviteableRole = await request(app.getHttpServer())
      .post(`${base}/role-templates`)
      .set('Cookie', adminCookie)
      .send({ name: 'Inviteable', capabilities: ['bookings.view'] })
      .expect(201);
    inviteableRoleId = inviteableRole.body.id as string;
    const noCreateRole = await request(app.getHttpServer())
      .post(`${base}/role-templates`)
      .set('Cookie', adminCookie)
      .send({ name: 'Staff viewer', capabilities: ['staff.view'] })
      .expect(201);
    await migrationPrisma.$executeRaw`
      INSERT INTO "property_staff_assignments" ("tenant_id", "property_id", "user_id", "role_template_id")
      VALUES (${tenantId}::uuid, ${propertyId}::uuid, ${noCreateId}::uuid, ${noCreateRole.body.id as string}::uuid)
    `;
    leadCookie = await login(leadEmail, password);
  });

  afterAll(async () => {
    await migrationPrisma.$executeRaw`DELETE FROM "audit_logs" WHERE "tenant_id" = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "property_staff_capability_overrides" WHERE "tenant_id" = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "property_staff_assignments" WHERE "tenant_id" = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "property_role_template_capabilities" WHERE "tenant_id" = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "property_role_templates" WHERE "tenant_id" = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "capabilities" WHERE "tenant_id" = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "tenant_memberships" WHERE "tenant_id" = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "notifications" WHERE "tenant_id" = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "properties" WHERE "id" = ${propertyId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "properties" WHERE "id" = ${otherPropertyId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "users" WHERE "email" IN (${adminEmail}, ${ownerEmail}, ${leadEmail}, ${noCreateEmail}, ${newEmail})`;
    await migrationPrisma.$executeRaw`DELETE FROM "organizations" WHERE "id" = ${tenantId}::uuid`;
    await app.close();
    await migrationPrisma.$disconnect();
  });

  it('lists the permission catalog grouped by area', async () => {
    const response = await request(app.getHttpServer()).get(`${base}/capabilities/catalog`).set('Cookie', adminCookie).expect(200);
    const keys = (response.body as Array<{ key: string; group: string }>).map((entry) => entry.key);
    expect(keys).toContain('bookings.cancel');
    expect(keys).toContain('staff.suspend');
    expect(response.body[0]).toMatchObject({ group: 'Bookings', key: 'bookings.view' });
  });

  it('lets a team lead invite only roles and extra permissions they hold', async () => {
    await request(app.getHttpServer())
      .post(`${base}/staff-invitations`)
      .set('Cookie', leadCookie)
      .send({ email: `lead-invite-${randomUUID()}@example.test`, roleTemplateId: inviteableRoleId })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${base}/staff-invitations`)
      .set('Cookie', leadCookie)
      .send({ email: `lead-forbidden-role-${randomUUID()}@example.test`, roleTemplateId: frontDeskId })
      .expect(403);
    await request(app.getHttpServer())
      .post(`${base}/staff-invitations`)
      .set('Cookie', leadCookie)
      .send({
        email: `lead-forbidden-extra-${randomUUID()}@example.test`,
        roleTemplateId: inviteableRoleId,
        capabilityKeys: ['payments.refund'],
      })
      .expect(403);
    await request(app.getHttpServer())
      .post(`${base}/staff-invitations`)
      .set('Cookie', leadCookie)
      .send({
        email: `lead-unknown-${randomUUID()}@example.test`,
        roleTemplateId: inviteableRoleId,
        capabilityKeys: ['not.a.permission'],
      })
      .expect(400);
    await request(app.getHttpServer())
      .post(`${base}/staff-invitations`)
      .set('Cookie', leadCookie)
      .send({ email: `lead-foreign-role-${randomUUID()}@example.test`, roleTemplateId: foreignRoleId })
      .expect(404);
    await request(app.getHttpServer())
      .post(`${base}/staff-invitations`)
      .set('Cookie', noCreateCookie)
      .send({ email: `no-create-${randomUUID()}@example.test`, roleTemplateId: inviteableRoleId })
      .expect(403);
  });

  it('allows Owners and Admins to use the hotel-scoped invitation route', async () => {
    for (const [cookie, email] of [
      [adminCookie, `admin-invite-${randomUUID()}@example.test`],
      [ownerCookie, `owner-invite-${randomUUID()}@example.test`],
    ]) {
      await request(app.getHttpServer())
        .post(`${base}/staff-invitations`)
        .set('Cookie', cookie)
        .send({ email, roleTemplateId: inviteableRoleId })
        .expect(201);
    }
  });

  it('creates a staff account with the password the hotel chose, who can then sign in', async () => {
    await request(app.getHttpServer())
      .post(`${base}/staff`)
      .set('Cookie', adminCookie)
      .send({ firstName: 'Mira', email: newEmail, password: 'short', roleTemplateId: frontDeskId })
      .expect(400);
    const created = await request(app.getHttpServer())
      .post(`${base}/staff`)
      .set('Cookie', adminCookie)
      .send({
        firstName: 'Mira',
        lastName: 'Kola',
        email: newEmail.toUpperCase(),
        password: chosenPassword,
        roleTemplateId: frontDeskId,
        extraCapabilities: ['calendar.block'],
        deniedCapabilities: ['bookings.cancel'],
      })
      .expect(201);
    createdUserId = created.body.userId as string;
    expect(JSON.stringify(created.body)).not.toContain(chosenPassword);
    await request(app.getHttpServer())
      .post(`${base}/staff`)
      .set('Cookie', adminCookie)
      .send({ firstName: 'Again', email: newEmail, password: chosenPassword, roleTemplateId: frontDeskId })
      .expect(409);

    const stored = await migrationPrisma.$queryRaw<Array<{ passwordHash: string; verified: boolean; firstName: string }>>`
      SELECT "password_hash" AS "passwordHash", "email_verified_at" IS NOT NULL AS "verified", "first_name" AS "firstName"
      FROM "users" WHERE "id" = ${createdUserId}::uuid
    `;
    expect(stored[0]).toMatchObject({ verified: true, firstName: 'Mira' });
    expect(stored[0]!.passwordHash).not.toContain(chosenPassword);
    await login(newEmail, chosenPassword);

    const list = await request(app.getHttpServer()).get(`${base}/staff`).set('Cookie', adminCookie).expect(200);
    const row = (list.body as Array<Record<string, unknown>>).find((entry) => entry.userId === createdUserId)!;
    expect(row).toMatchObject({
      firstName: 'Mira',
      lastName: 'Kola',
      email: newEmail,
      roleTemplateName: 'Front Desk',
      status: 'ACTIVE',
      createdByEmail: adminEmail,
    });
    const audit = await migrationPrisma.$queryRaw<Array<{ details: unknown }>>`
      SELECT "details" FROM "audit_logs" WHERE "tenant_id" = ${tenantId}::uuid AND "action" = 'staff.created'
    `;
    expect(JSON.stringify(audit)).not.toContain(chosenPassword);
  });

  it('shows where each permission of a person comes from', async () => {
    const response = await request(app.getHttpServer())
      .get(`${base}/staff/${createdUserId}/effective-capabilities`)
      .set('Cookie', adminCookie)
      .expect(200);
    const byKey = new Map((response.body as Array<{ key: string; granted: boolean; source: string }>).map((entry) => [entry.key, entry]));
    expect(byKey.get('bookings.create')).toMatchObject({ granted: true, source: 'role' });
    expect(byKey.get('calendar.block')).toMatchObject({ granted: true, source: 'extra' });
    expect(byKey.get('bookings.cancel')).toMatchObject({ granted: false, source: 'denied' });
    expect(byKey.get('rates.manage')).toMatchObject({ granted: false, source: 'none' });
  });

  it('creates, edits and deletes custom roles, and protects built-in roles and roles in use', async () => {
    const created = await request(app.getHttpServer())
      .post(`${base}/role-templates`)
      .set('Cookie', adminCookie)
      .send({ name: 'Night auditor', description: 'Works nights', copyFromId: frontDeskId })
      .expect(201);
    expect(created.body).toMatchObject({ name: 'Night auditor', kind: 'CUSTOM', memberCount: 0 });
    expect(created.body.capabilities).toContain('bookings.view');
    await request(app.getHttpServer()).post(`${base}/role-templates`).set('Cookie', adminCookie).send({ name: 'night AUDITOR', capabilities: [] }).expect(409);
    await request(app.getHttpServer()).post(`${base}/role-templates`).set('Cookie', adminCookie).send({ name: 'Bad', capabilities: ['nope.nope'] }).expect(400);

    const updated = await request(app.getHttpServer())
      .put(`${base}/role-templates/${created.body.id}`)
      .set('Cookie', adminCookie)
      .send({ capabilities: ['bookings.view'] })
      .expect(200);
    expect(updated.body.capabilities).toEqual(['bookings.view']);

    await request(app.getHttpServer()).put(`${base}/role-templates/${frontDeskId}`).set('Cookie', adminCookie).send({ name: 'X' }).expect(409);
    await request(app.getHttpServer()).delete(`${base}/role-templates/${frontDeskId}`).set('Cookie', adminCookie).expect(409);

    await request(app.getHttpServer()).put(`${base}/staff/${createdUserId}`).set('Cookie', adminCookie).send({ roleTemplateId: created.body.id }).expect(204);
    const inUse = await request(app.getHttpServer()).delete(`${base}/role-templates/${created.body.id}`).set('Cookie', adminCookie).expect(409);
    expect(inUse.body.message).toContain('1 staff member');
    await request(app.getHttpServer()).put(`${base}/staff/${createdUserId}`).set('Cookie', adminCookie).send({ roleTemplateId: frontDeskId }).expect(204);
    await request(app.getHttpServer()).delete(`${base}/role-templates/${created.body.id}`).set('Cookie', adminCookie).expect(204);
  });

  it('never lets someone hand out a permission they do not hold', async () => {
    // The team lead holds staff.view, staff.create, staff.manage_roles and bookings.view only.
    await request(app.getHttpServer())
      .post(`${base}/role-templates`)
      .set('Cookie', leadCookie)
      .send({ name: 'Too much', capabilities: ['bookings.view', 'payments.refund'] })
      .expect(403);
    await request(app.getHttpServer())
      .post(`${base}/role-templates`)
      .set('Cookie', leadCookie)
      .send({ name: 'Within reach', capabilities: ['bookings.view'] })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${base}/staff`)
      .set('Cookie', leadCookie)
      .send({ firstName: 'No', email: `access-no-${randomUUID()}@example.test`, password: chosenPassword, roleTemplateId: managerId })
      .expect(403);
    await request(app.getHttpServer())
      .post(`${base}/staff`)
      .set('Cookie', leadCookie)
      .send({ firstName: 'Extra', email: `access-extra-${randomUUID()}@example.test`, password: chosenPassword, roleTemplateId: frontDeskId })
      .expect(403);
    // Someone without the permission cannot reach the endpoint at all.
    await request(app.getHttpServer()).post(`${base}/staff/${createdUserId}/status`).set('Cookie', leadCookie).expect(404);
    await request(app.getHttpServer()).patch(`${base}/staff/${createdUserId}/status`).set('Cookie', leadCookie).send({ status: 'SUSPENDED' }).expect(403);
  });

  it('suspends and reactivates a person at this hotel without touching their account', async () => {
    const newCookie = await login(newEmail, chosenPassword);
    await request(app.getHttpServer()).get(`${base}/capabilities/mine`).set('Cookie', newCookie).expect(200);
    await request(app.getHttpServer()).patch(`${base}/staff/${createdUserId}/status`).set('Cookie', adminCookie).send({ status: 'SUSPENDED' }).expect(204);
    await request(app.getHttpServer()).get(`${base}/capabilities/mine`).set('Cookie', newCookie).expect(403);
    const suspended = await request(app.getHttpServer()).get(`${base}/staff`).set('Cookie', adminCookie).expect(200);
    expect((suspended.body as Array<{ userId: string; status: string }>).find((entry) => entry.userId === createdUserId)!.status).toBe('SUSPENDED');
    await request(app.getHttpServer()).patch(`${base}/staff/${createdUserId}/status`).set('Cookie', adminCookie).send({ status: 'BANANA' }).expect(400);
    await request(app.getHttpServer()).patch(`${base}/staff/${createdUserId}/status`).set('Cookie', adminCookie).send({ status: 'ACTIVE' }).expect(204);
    await request(app.getHttpServer()).get(`${base}/capabilities/mine`).set('Cookie', newCookie).expect(200);
    await request(app.getHttpServer()).patch(`${base}/staff/${adminId}/status`).set('Cookie', adminCookie).send({ status: 'SUSPENDED' }).expect(403);
  });
});
