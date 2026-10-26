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

describe('Global search', () => {
  const ownerEmail = `search-owner-${randomUUID()}@example.test`;
  const password = 'correct-horse-battery-staple';
  const staffUsers: string[] = [];
  let app: INestApplication;
  let tenantId = '';
  let propertyId = '';
  let ownerId = '';
  let ownerCookie = '';
  const http = () => request(app.getHttpServer());
  const find = (cookie: string, q: string) =>
    http()
      .get(`/tenants/${tenantId}/properties/${propertyId}/search`)
      .query({ q })
      .set('Cookie', cookie);

  async function staffWithRole(roleName: string): Promise<string> {
    const email = `search-staff-${randomUUID()}@example.test`;
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
        organizationName: 'Search Fixture Group',
        propertyName: 'Search Fixture Hotel',
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

  it('finds bookings, guests and rooms for an owner, by name, reference or email', async () => {
    const roomType = randomUUID();
    const ratePlan = randomUUID();
    const guest = randomUUID();
    const booking = randomUUID();
    await admin.$executeRaw`INSERT INTO room_types(id,tenant_id,property_id,name,max_occupancy) VALUES(${roomType}::uuid,${tenantId}::uuid,${propertyId}::uuid,'Sea View Suite',2)`;
    await admin.$executeRaw`INSERT INTO rooms(id,tenant_id,property_id,room_type_id,name) VALUES(${randomUUID()}::uuid,${tenantId}::uuid,${propertyId}::uuid,${roomType}::uuid,'Room 204')`;
    await admin.$executeRaw`INSERT INTO rate_plans(id,tenant_id,property_id,name,currency) VALUES(${ratePlan}::uuid,${tenantId}::uuid,${propertyId}::uuid,'Flex','EUR')`;
    await admin.$executeRaw`INSERT INTO guests(id,tenant_id,first_name,last_name,email) VALUES(${guest}::uuid,${tenantId}::uuid,'Zelda','Searchable','zelda@example.test')`;
    await admin.$executeRaw`INSERT INTO bookings(id,tenant_id,property_id,room_type_id,rate_plan_id,guest_id,external_reference,status,starts_on,ends_on,total_amount) VALUES(${booking}::uuid,${tenantId}::uuid,${propertyId}::uuid,${roomType}::uuid,${ratePlan}::uuid,${guest}::uuid,'SRCH-1001','CONFIRMED','2027-05-01','2027-05-03',150)`;

    const byName = (await find(ownerCookie, 'zelda').expect(200)).body;
    expect(byName.groups.map((g: { key: string }) => g.key)).toEqual(['bookings', 'guests']);
    expect(byName.groups[0].items[0]).toMatchObject({ type: 'booking', id: booking });
    expect(byName.groups[1].items[0]).toMatchObject({ type: 'guest', id: guest });

    const byRef = (await find(ownerCookie, 'srch-10').expect(200)).body;
    expect(byRef.groups[0].items[0].title).toContain('SRCH-1001');

    const rooms = (await find(ownerCookie, 'sea view').expect(200)).body;
    expect(rooms.groups).toHaveLength(1);
    expect(rooms.groups[0]).toMatchObject({ key: 'accommodations' });
    expect(rooms.groups[0].items[0]).toMatchObject({ type: 'room_type', title: 'Sea View Suite' });
    const roomHit = (await find(ownerCookie, 'room 204').expect(200)).body.groups[0].items[0];
    expect(roomHit.type).toBe('room');
    // A room opens its room type.
    expect(roomHit.target).toBe(roomType);

    // A phone typed with different spacing still finds the guest.
    await admin.$executeRaw`UPDATE guests SET phone='+355 69 123 4567' WHERE id=${guest}::uuid`;
    for (const typed of ['691234', '+355 69 12', '(691) 234'])
      expect(
        (await find(ownerCookie, typed).expect(200)).body.groups.map((g: { key: string }) => g.key),
      ).toContain('guests');

    // Payments are found by their reference and open the booking; rate plans by name.
    await admin.$executeRaw`INSERT INTO payments(tenant_id,property_id,booking_id,kind,provider,external_payment_id,status,amount,currency) VALUES(${tenantId}::uuid,${propertyId}::uuid,${booking}::uuid,'CHARGE','POKPAY','pay_zz_9001','succeeded',150,'EUR')`;
    await admin.$executeRaw`UPDATE rate_plans SET name='Early bird flex' WHERE id=${ratePlan}::uuid`;
    const pay = (await find(ownerCookie, 'pay_zz_9001').expect(200)).body;
    expect(pay.groups.find((g: { key: string }) => g.key === 'payments').items[0]).toMatchObject({
      type: 'payment',
      target: booking,
    });
    const plan = (await find(ownerCookie, 'early bird').expect(200)).body;
    expect(plan.groups.find((g: { key: string }) => g.key === 'ratePlans').items[0].title).toBe(
      'Early bird flex',
    );

    // Staff and sent emails.
    const staff = (await find(ownerCookie, 'search-owner').expect(200)).body;
    expect(
      staff.groups.find((g: { key: string }) => g.key === 'staff').items[0].subtitle,
    ).toContain('search-owner');
    await admin.$executeRaw`INSERT INTO email_messages(tenant_id,property_id,event_type,recipient_email,subject,idempotency_key) VALUES(${tenantId}::uuid,${propertyId}::uuid,'BOOKING_CONFIRMATION','zelda@example.test','Your booking SRCH-1001 is confirmed',${randomUUID()})`;
    const mail = (await find(ownerCookie, 'is confirmed').expect(200)).body;
    expect(mail.groups.find((g: { key: string }) => g.key === 'emails').items[0].title).toContain(
      'SRCH-1001',
    );
  });

  it('treats wildcards as plain text and ignores one-letter searches', async () => {
    expect((await find(ownerCookie, 'z%').expect(200)).body.groups).toEqual([]);
    expect((await find(ownerCookie, 'z_lda').expect(200)).body.groups).toEqual([]);
    expect((await find(ownerCookie, 'z').expect(200)).body.groups).toEqual([]);
    await find(ownerCookie, 'x'.repeat(81)).expect(400);
    await http()
      .get(`/tenants/${tenantId}/properties/${propertyId}/search`)
      .query({ q: 'zelda' })
      .expect(401);
  });

  it('shows a person only the groups they may see and never a different hotel record', async () => {
    const created = await http()
      .post(`/tenants/${tenantId}/properties/${propertyId}/role-templates`)
      .set('Cookie', ownerCookie)
      .send({ name: 'Cashier', capabilities: ['payments.view'] })
      .expect(201);
    expect(created.body.id).toBeTruthy();
    const cashier = await staffWithRole('Cashier');
    // Payments alone is not enough: the Payments page needs bookings.view as well.
    expect((await find(cashier, 'zelda').expect(200)).body.groups).toEqual([]);
    expect((await find(cashier, 'pay_zz_9001').expect(200)).body.groups).toEqual([]);
    const desk = await staffWithRole('Front Desk');
    const seen = (await find(desk, 'zelda').expect(200)).body.groups.map(
      (g: { key: string }) => g.key,
    );
    expect(seen).toContain('bookings');
    expect(seen).not.toContain('staff');
    expect(seen).not.toContain('emails');
    expect(
      (await find(desk, 'early bird').expect(200)).body.groups.map((g: { key: string }) => g.key),
    ).not.toContain('ratePlans');
    // A guest with the same name in another hotel of the same tenant must not appear.
    const otherProperty = randomUUID();
    await admin.$executeRaw`INSERT INTO properties(id,tenant_id,name,slug,timezone) VALUES(${otherProperty}::uuid,${tenantId}::uuid,'Other hotel',${'other-' + otherProperty},'Europe/Tirane')`;
    const otherGuest = randomUUID();
    await admin.$executeRaw`INSERT INTO guests(id,tenant_id,first_name,last_name,email) VALUES(${otherGuest}::uuid,${tenantId}::uuid,'Yolanda','Elsewhere','yolanda@example.test')`;
    expect((await find(ownerCookie, 'yolanda').expect(200)).body.groups).toEqual([]);
  });

  it('every single permission shows exactly the groups whose page that permission opens', async () => {
    const expected: Record<string, string[]> = {
      'bookings.view': ['bookings'],
      'guests.view': ['guests'],
      'accommodations.manage': ['accommodations'],
      'photos.manage': ['accommodations'],
      'rates.manage': ['ratePlans'],
      'staff.view': ['staff'],
      'settings.manage': ['emails'],
    };
    const none = [
      'bookings.create',
      'bookings.edit',
      'bookings.cancel',
      'calendar.view',
      'calendar.block',
      'guests.merge',
      'payments.view',
      'payments.record',
      'payments.refund',
      'reports.view',
      'staff.create',
      'staff.manage_roles',
      'staff.manage_permissions',
      'staff.suspend',
    ];
    const queries = [
      'zelda',
      'srch',
      'room 204',
      'sea view',
      'pay_zz',
      'early bird',
      'search-',
      'confirmed',
    ];
    const seenBy = async (capabilities: string[]) => {
      const name = `Only ${capabilities.join('+')}`;
      await http()
        .post(`/tenants/${tenantId}/properties/${propertyId}/role-templates`)
        .set('Cookie', ownerCookie)
        .send({ name, capabilities })
        .expect(201);
      const cookie = await staffWithRole(name);
      const keys = new Set<string>();
      for (const q of queries)
        for (const g of (await find(cookie, q).expect(200)).body.groups) keys.add(g.key);
      return [...keys].sort();
    };
    for (const [capability, groups] of Object.entries(expected))
      expect(await seenBy([capability]), capability).toEqual(groups);
    for (const capability of none) expect(await seenBy([capability]), capability).toEqual([]);
    expect(await seenBy(['payments.view', 'bookings.view'])).toEqual(['bookings', 'payments']);
  });
});
