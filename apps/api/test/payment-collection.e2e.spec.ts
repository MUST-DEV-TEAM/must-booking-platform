import { PaymentRefundService } from '../src/payments/payment-refund.service';
import { ClockStayAmendmentService } from '../src/integrations/clock/clock-stay-amendment.service';
import { ClockBackgroundSyncService } from '../src/integrations/clock/clock-background-sync.service';
import { TenantDatabaseService } from '../src/tenancy/tenant-database.service';
import { AuditLogService } from '../src/tenancy/audit-log.service';
import { ManualReviewService } from '../src/integrations/manual-review.service';
import { createHash, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanupTenant } from './helpers/cleanup-tenant';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';
import { withoutExternalWorkers } from './helpers/without-external-workers';
import { STAY_STARTS_ON, STAY_ENDS_ON } from './helpers/future-stay';
import { MAIL_PROVIDER } from '../src/mail/mail.provider';
import { PokPayPaymentProvider } from '../src/payments/pokpay-payment.provider';
import { PokPayPaymentService } from '../src/payments/pokpay-payment.service';
import { ClockBookingService } from '../src/integrations/clock/clock-booking.service';
import { ClockFinancialService } from '../src/integrations/clock/clock-financial.service';
import { IntegrationConnectionsService } from '../src/integrations/integration-connections.service';
const admin = new PrismaClient({
  datasources: {
    db: { url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking' },
  },
});
describe('collecting a confirmed booking balance', () => {
  let app: INestApplication,
    tenantId = '',
    propertyId = '',
    userId = '',
    cookie = '',
    clock = false;
  const type = randomUUID(),
    plan = randomUUID(),
    guest = randomUUID();
  const orders = new Map<
    string,
    { amount: { amount: string; currency: string }; status: string }
  >();
  const create = vi.fn(
    async (_scope: unknown, command: { amount: { amount: string; currency: string } }) => {
      const id = randomUUID();
      orders.set(id, { amount: command.amount, status: 'PENDING' });
      return { ok: true, value: { id, url: 'https://pay.pokpay.test/' + id } };
    },
  );
  const refund = vi.fn();
  const financial = { refresh: vi.fn().mockResolvedValue(null) };
  const postDeposit = vi.fn().mockResolvedValue({ ok: true, value: undefined });
  const base = () => `/tenants/${tenantId}/properties/${propertyId}/bookings`;
  async function booking(status = 'CONFIRMED', paid = '0.00') {
    const id = randomUUID();
    await admin.$executeRaw`INSERT INTO bookings(id,tenant_id,property_id,room_type_id,rate_plan_id,guest_id,external_reference,status,payment_method,starts_on,ends_on,total_amount) VALUES(${id}::uuid,${tenantId}::uuid,${propertyId}::uuid,${type}::uuid,${plan}::uuid,${guest}::uuid,${'COL-' + id},${status}::"BookingStatus",'PAY_AT_HOTEL',${STAY_STARTS_ON}::date,${STAY_ENDS_ON}::date,100)`;
    if (paid !== '0.00')
      await admin.$executeRaw`INSERT INTO payments(tenant_id,property_id,booking_id,kind,provider,external_payment_id,status,amount,currency) VALUES(${tenantId}::uuid,${propertyId}::uuid,${id}::uuid,'CHARGE','manual',${'fixture-' + id},'succeeded',${paid}::numeric,'EUR')`;
    return id;
  }
  beforeAll(async () => {
    process.env.DATABASE_URL =
      'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.WEB_APP_URL = 'http://localhost:3001';
    await clearSignupRateLimits();
    const { AppModule } = await import('../src/app.module');
    const mail = Object.fromEntries(
      [
        'sendVerificationEmail',
        'sendWelcomeEmail',
        'sendPasswordResetEmail',
        'sendStaffInvitationEmail',
        'sendPaymentConfirmationEmail',
        'sendNewBookingStaffNotification',
        'sendRefundConfirmationEmail',
        'sendBookingCancelledEmail',
        'sendBookingCancelledStaffNotification',
        'sendRenderedEmail',
      ].map((k) => [k, vi.fn().mockResolvedValue(undefined)]),
    );
    app = (
      await withoutExternalWorkers(Test.createTestingModule({ imports: [AppModule] }))
        .overrideProvider(MAIL_PROVIDER)
        .useValue(mail)
        .overrideProvider(PokPayPaymentProvider)
        .useValue({
          createCheckoutSession: create,
          refund,
          getPayment: async (_s: unknown, id: string) => {
            const o = orders.get(id);
            return o ? { id, bookingId: 'unused', ...o } : null;
          },
        })
        .overrideProvider(ClockFinancialService)
        .useValue(financial)
        .overrideProvider(ClockBookingService)
        .useValue({ postDeposit })
        .compile()
    ).createNestApplication({ logger: false });
    await app.init();
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Collection regression',
        propertyName: 'Collection Hotel',
        propertyAddress: '1 Test Road',
        propertyTimezone: 'Europe/Tirane',
        email: `collection-${randomUUID()}@example.test`,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    propertyId = signup.body.property.id;
    userId = signup.body.user.id;
    cookie = signup.headers['set-cookie'][0];
    await admin.$executeRaw`UPDATE users SET email_verified_at=now() WHERE id=${userId}::uuid`;
    await admin.$executeRaw`UPDATE properties SET pokpay_enabled=true WHERE tenant_id=${tenantId}::uuid AND id=${propertyId}::uuid`;
    await admin.$executeRaw`INSERT INTO room_types(id,tenant_id,property_id,name,max_occupancy) VALUES(${type}::uuid,${tenantId}::uuid,${propertyId}::uuid,'Double',2)`;
    await admin.$executeRaw`INSERT INTO rate_plans(id,tenant_id,property_id,name,currency) VALUES(${plan}::uuid,${tenantId}::uuid,${propertyId}::uuid,'Standard','EUR')`;
    await admin.$executeRaw`INSERT INTO guests(id,tenant_id,email,first_name) VALUES(${guest}::uuid,${tenantId}::uuid,'collection-guest@example.test','Collection guest')`;
    const connection = randomUUID();
    await admin.$executeRaw`INSERT INTO integration_connections(id,tenant_id,kind,provider,name,encrypted_credentials,status) VALUES(${connection}::uuid,${tenantId}::uuid,'PAYMENT','POKPAY','Mock-only staging','fixture-never-decrypted','CONNECTED')`;
    await admin.$executeRaw`INSERT INTO property_integration_connections(tenant_id,property_id,connection_id,kind) VALUES(${tenantId}::uuid,${propertyId}::uuid,${connection}::uuid,'PAYMENT')`;
    vi.spyOn(
      app.get(IntegrationConnectionsService),
      'activePmsConnectionCredentials',
    ).mockImplementation(async () =>
      clock ? { provider: 'CLOCK_PMS', connectionId: 'mock', credentials: {} } : null,
    );
  }, 60000);
  afterAll(async () => {
    if (app) await app.close();
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id=${userId}::uuid`;
    await admin.$disconnect();
  });
  it('exposes only the scoped public hotel name and logo for payment branding', async () => {
    await admin.$executeRaw`UPDATE properties SET logo_url='https://hotel.example.test/logo.png' WHERE tenant_id=${tenantId}::uuid AND id=${propertyId}::uuid`;
    const response = await request(app.getHttpServer())
      .get(`/tenants/${tenantId}/properties/${propertyId}/public/branding`)
      .expect(200);
    expect(response.body).toEqual({
      name: 'Collection Hotel',
      logoUrl: 'https://hotel.example.test/logo.png',
    });
    const other = await request(app.getHttpServer()).get(
      `/tenants/${randomUUID()}/properties/${propertyId}/public/branding`,
    );
    expect(other.status).not.toBe(200);
    expect(other.text).not.toContain('hotel.example.test');
  });
  it('shares an existing pending checkout without creating another gateway order', async () => {
    const id = await booking('PAYMENT_PENDING');
    await admin.$executeRaw`UPDATE bookings SET payment_method='POKPAY' WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${id}::uuid`;
    const result = { ok: true, value: { checkoutUrl: 'https://pay.pokpay.test/pending-fixture' } };
    await admin.$executeRaw`INSERT INTO integration_operations(tenant_id,property_id,idempotency_key,request_hash,status,external_entity_id,result) VALUES(${tenantId}::uuid,${propertyId}::uuid,${'create-' + id},${'f'.repeat(64)},'SUCCEEDED',${id}::uuid,${JSON.stringify(result)}::jsonb)`;
    const before = create.mock.calls.length;
    await request(app.getHttpServer())
      .post(`${base()}/${id}/send-pokpay-link`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .expect(200);
    expect(create.mock.calls.length).toBe(before);
  });
  it('moves a local room once, preserves money and rejects conflicts and stale versions', async () => {
    clock = false;
    const first = randomUUID(),
      second = randomUUID(),
      id = await booking(),
      other = await booking();
    await admin.$executeRaw`UPDATE properties SET booking_mode='MIXED' WHERE tenant_id=${tenantId}::uuid AND id=${propertyId}::uuid`;
    await admin.$executeRaw`INSERT INTO rooms(id,tenant_id,property_id,room_type_id,name) VALUES(${first}::uuid,${tenantId}::uuid,${propertyId}::uuid,${type}::uuid,'Room move first'),(${second}::uuid,${tenantId}::uuid,${propertyId}::uuid,${type}::uuid,'Room move second')`;
    await admin.$executeRaw`UPDATE bookings SET room_id=${first}::uuid WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${id}::uuid`;
    const options = await request(app.getHttpServer())
      .get(`${base()}/${id}/room-move`)
      .set('Cookie', cookie)
      .expect(200);
    expect(options.body.rooms.map((room: { id: string }) => room.id)).toContain(second);
    expect(options.body.rooms.map((room: { id: string }) => room.id)).not.toContain(first);
    const key = randomUUID(),
      body = {
        roomId: second,
        expectedVersion: options.body.version,
        reason: 'Guest requested a quieter room',
      };
    const move = () =>
      request(app.getHttpServer())
        .patch(`${base()}/${id}/room-move`)
        .set('Cookie', cookie)
        .set('Idempotency-Key', key)
        .send(body);
    const results = await Promise.all([move(), move()]);
    expect(
      results.map((r) => r.body.ok),
      results.map((r) => r.text).join(' '),
    ).toEqual([true, true]);
    const rows = await admin.$queryRaw<
      Array<{ room: string; total: string; count: number }>
    >`SELECT b.room_id AS room,b.total_amount::text AS total,(SELECT count(*)::int FROM audit_logs a WHERE a.tenant_id=b.tenant_id AND a.property_id=b.property_id AND a.target_id=b.id::text AND a.action='booking.room_moved') AS count FROM bookings b WHERE b.tenant_id=${tenantId}::uuid AND b.property_id=${propertyId}::uuid AND b.id=${id}::uuid`;
    expect(rows[0]).toEqual({ room: second, total: '100.00', count: 1 });
    const blocked = await request(app.getHttpServer())
      .patch(`${base()}/${other}/room-move`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ ...body, expectedVersion: 1 });
    expect(blocked.body.error.code).toBe('ROOM_UNAVAILABLE');
    const afterMoveOptions = await request(app.getHttpServer())
      .get(`${base()}/${other}/room-move`)
      .set('Cookie', cookie)
      .expect(200);
    expect(afterMoveOptions.body.rooms.map((room: { id: string }) => room.id)).not.toContain(
      second,
    );
    const stale = await request(app.getHttpServer())
      .patch(`${base()}/${id}/room-move`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ ...body, roomId: first });
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    await request(app.getHttpServer())
      .get(`${base()}/${randomUUID()}/room-move`)
      .set('Cookie', cookie)
      .expect(404);
  });
  it('reads back an uncertain Clock move without a second provider write', async () => {
    const connection = randomUUID(),
      room = randomUUID(),
      id = await booking();
    await admin.$executeRaw`INSERT INTO integration_connections(id,tenant_id,kind,provider,name,encrypted_credentials,status) VALUES(${connection}::uuid,${tenantId}::uuid,'PMS','CLOCK_PMS','Room move fixture','never-decrypted','CONNECTED')`;
    await admin.$executeRaw`INSERT INTO property_integration_connections(tenant_id,property_id,connection_id,kind) VALUES(${tenantId}::uuid,${propertyId}::uuid,${connection}::uuid,'PMS')`;
    await admin.$executeRaw`INSERT INTO rooms(id,tenant_id,property_id,room_type_id,name) VALUES(${room}::uuid,${tenantId}::uuid,${propertyId}::uuid,${type}::uuid,'Clock move fixture')`;
    for (const [entity, local, external] of [
      ['ROOM_TYPE', type, '21'],
      ['ROOM', room, '22'],
    ])
      await admin.$executeRaw`INSERT INTO clock_catalog_mappings(tenant_id,property_id,connection_id,entity_type,local_entity_id,external_entity_id,external_name,sync_status) VALUES(${tenantId}::uuid,${propertyId}::uuid,${connection}::uuid,${entity}::"ClockCatalogEntityType",${local}::uuid,${external},'Room move fixture','CONFIRMED')`;
    // The picker uses the real scoped PostgreSQL projection. These credentials
    // cannot be decrypted, so any accidental live read would also fail this test.
    const { ClockPmsProvider } = await import('../src/integrations/clock/clock-pms.provider');
    const savedProvider = app.get(ClockPmsProvider),
      other = await booking();
    const roomQuery = {
      roomIds: [room],
      startsOn: STAY_STARTS_ON,
      endsOn: STAY_ENDS_ON,
      excludeBookingId: id,
    };
    expect(
      await savedProvider.unavailableRoomsForMove({ tenantId, propertyId }, roomQuery),
    ).toMatchObject({ ok: true, value: { unavailableRoomIds: [], complete: false, stale: true } });
    await admin.$executeRaw`UPDATE bookings SET room_id=${room}::uuid WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${other}::uuid`;
    await admin.$executeRaw`UPDATE clock_sync_jobs SET snapshot='{"initialComplete":true,"schemaVersion":2}'::jsonb,last_success_at=now(),status='SYNCED' WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND connection_id=${connection}::uuid AND resource='bookings'`;
    expect(
      await savedProvider.unavailableRoomsForMove({ tenantId, propertyId }, roomQuery),
    ).toMatchObject({
      ok: true,
      value: { unavailableRoomIds: [room], complete: true, stale: false },
    });
    await admin.$executeRaw`UPDATE bookings SET room_id=NULL WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${other}::uuid`;
    await admin.$executeRaw`UPDATE bookings SET external_booking_id='12345' WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${id}::uuid`;
    let applied = false;
    const client = {
      request: vi.fn(async (_credentials: unknown, options: { method: string; body?: unknown }) => {
        if (options.method === 'PUT') {
          applied = true;
          return { status: 503, body: { message: 'Response lost after apply' } };
        }
        return {
          status: 200,
          body: {
            id: 12345,
            status: 'expected',
            lock_version: applied ? 2 : 1,
            arrival: STAY_STARTS_ON,
            departure: STAY_ENDS_ON,
            total_booking_value: { cents: 10000, currency: 'EUR' },
            arrival_room_type_id: 21,
            arrival_room_id: applied ? 22 : null,
          },
        };
      }),
    };
    const connections = {
      activePmsConnectionCredentials: async () => ({
        provider: 'CLOCK_PMS',
        connectionId: connection,
        credentials: {
          host: 'sky-eu1.clock-software.com',
          accountId: '123',
          subscriptionId: '456',
          apiUser: 'fixture',
          apiKey: 'fixture',
        },
      }),
    };
    const provider = new ClockBookingService(
      app.get(TenantDatabaseService),
      connections as never,
      app.get(AuditLogService),
      {} as never,
      app.get(ManualReviewService),
      {} as never,
      client as never,
      { consume: async () => ({ allowed: true }) } as never,
      { assertClosed() {}, recordSuccess() {}, recordFailure() {} } as never,
      { unavailableRoomsForBooking: async () => ({ ok: true, value: [] }) } as never,
    );
    const command = {
      bookingId: id,
      roomId: room,
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
      staffActorId: userId,
      reason: 'Verified room assignment',
    };
    try {
      const first = await provider.moveBookingRoom({ tenantId, propertyId }, command);
      expect(first.ok).toBe(false);
      const checked = await provider.moveBookingRoom({ tenantId, propertyId }, command);
      expect(checked.ok, JSON.stringify(checked)).toBe(true);
      expect(client.request.mock.calls.filter(([, o]) => o.method === 'PUT')).toHaveLength(1);
      expect((await provider.moveBookingRoom({ tenantId, propertyId }, command)).ok).toBe(true);
      expect(client.request.mock.calls.filter(([, o]) => o.method === 'PUT')).toHaveLength(1);
    } finally {
      await admin.$executeRaw`DELETE FROM property_integration_connections WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND connection_id=${connection}::uuid`;
    }
  });
  it('reuses one link, captures the remaining amount once and keeps the original confirmed booking', async () => {
    clock = false;
    const id = await booking('CONFIRMED', '25.00');
    const before = create.mock.calls.length;
    const start = () =>
      request(app.getHttpServer())
        .post(`${base()}/${id}/collect-pokpay`)
        .set('Cookie', cookie)
        .set('Idempotency-Key', randomUUID());
    const first = await start().expect(200);
    const second = await start().expect(200);
    expect(second.body.checkoutUrl).toBe(first.body.checkoutUrl);
    expect(first.body.amount.amount).toBe('75.00');
    expect(create.mock.calls.length - before).toBe(1);
    const orderId = first.body.checkoutUrl.split('/').at(-1)!;
    orders.get(orderId)!.status = 'PAID';
    await Promise.all([
      app.get(PokPayPaymentService).processAuthoritativeOrder(orderId),
      app.get(PokPayPaymentService).processAuthoritativeOrder(orderId),
    ]);
    const rows = await admin.$queryRaw<
      Array<{ status: string; method: string; amount: string; count: number }>
    >`SELECT b.status::text AS status,b.payment_method::text AS method,(SELECT SUM(amount)::text FROM payments p WHERE p.tenant_id=b.tenant_id AND p.property_id=b.property_id AND p.booking_id=b.id) AS amount,(SELECT COUNT(*)::int FROM payments p WHERE p.tenant_id=b.tenant_id AND p.property_id=b.property_id AND p.booking_id=b.id AND p.provider='pokpay') AS count FROM bookings b WHERE b.tenant_id=${tenantId}::uuid AND b.property_id=${propertyId}::uuid AND b.id=${id}::uuid`;
    expect(rows[0]).toMatchObject({ status: 'CONFIRMED', method: 'PAY_AT_HOTEL', count: 1 });
    expect(Number(rows[0].amount)).toBe(100);
    expect(postDeposit).not.toHaveBeenCalled();
    const candidates = await admin.$queryRaw<
      Array<{ bookingId: string }>
    >`SELECT * FROM payment_pending_pokpay_candidates(100)`;
    expect(candidates.some((r) => r.bookingId === id)).toBe(false);
  });
  it('restores a refund after a local rollback without calling the gateway again and blocks uncertain new attempts', async () => {
    const db = app.get(TenantDatabaseService),
      service = app.get(PaymentRefundService),
      scope = { tenantId, propertyId };
    const id = await booking(),
      paymentId = 'original-' + id,
      key = randomUUID();
    const charge = {
      provider: 'pokpay',
      externalPaymentId: paymentId,
      amount: '100.00',
      currency: 'EUR',
    };
    const command = { amount: { amount: '25.00', currency: 'EUR' }, idempotencyKey: key };
    refund.mockResolvedValueOnce({
      ok: true,
      value: { id: 'refund-' + key, status: 'REFUNDED', amount: command.amount },
    });
    const before = refund.mock.calls.length;
    await expect(
      db.withTenantTransaction(scope, async (tx) => {
        await service.refundCharge(tx, scope, id, charge, command);
        throw Error('simulated local rollback after provider success');
      }),
    ).rejects.toThrow('simulated local rollback');
    expect(refund.mock.calls.length - before).toBe(1);
    const restored = await db.withTenantTransaction(scope, (tx) =>
      service.refundCharge(tx, scope, id, charge, command),
    );
    expect(restored.result.ok).toBe(true);
    expect(refund.mock.calls.length - before).toBe(1);
    const rows = await admin.$queryRaw<
      Array<{ count: number }>
    >`SELECT count(*)::int AS count FROM payments WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND booking_id=${id}::uuid AND kind='REFUND'`;
    expect(rows[0].count).toBe(1);
    const uncertainId = await booking();
    refund.mockRejectedValueOnce(Error('lost provider response'));
    const fail = await db.withTenantTransaction(scope, (tx) =>
      service.refundCharge(tx, scope, uncertainId, charge, {
        ...command,
        idempotencyKey: randomUUID(),
      }),
    );
    expect(fail.result).toMatchObject({ ok: false, error: { code: 'REFUND_REQUIRES_REVIEW' } });
    const after = refund.mock.calls.length;
    const blocked = await db.withTenantTransaction(scope, (tx) =>
      service.refundCharge(tx, scope, uncertainId, charge, {
        ...command,
        idempotencyKey: randomUUID(),
      }),
    );
    expect(blocked.result).toMatchObject({ ok: false, error: { code: 'REFUND_REQUIRES_REVIEW' } });
    expect(refund.mock.calls.length).toBe(after);
  });
  it('checks only the requested collection, never an older paid order, and scopes it to its booking', async () => {
    clock = false;
    const id = await booking();
    const start = () =>
      request(app.getHttpServer())
        .post(`${base()}/${id}/collect-pokpay`)
        .set('Cookie', cookie)
        .set('Idempotency-Key', randomUUID())
        .expect(200);
    const old = await start();
    expect(old.body.orderId).toBeTruthy();
    orders.get(old.body.orderId)!.status = 'PAID';
    await app.get(PokPayPaymentService).processAuthoritativeOrder(old.body.orderId);
    await admin.$executeRaw`UPDATE bookings SET total_amount=125,version=version+1 WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${id}::uuid`;
    const next = await start();
    expect(next.body.amount.amount).toBe('25.00');
    expect(next.body.orderId).not.toBe(old.body.orderId);
    const check = (body: object) =>
      request(app.getHttpServer())
        .post(`${base()}/${id}/check-collection`)
        .set('Cookie', cookie)
        .send(body);
    expect((await check({ orderId: next.body.orderId }).expect(200)).body).toMatchObject({
      paid: false,
      orderId: next.body.orderId,
    });
    expect((await check({}).expect(200)).body).toMatchObject({
      paid: false,
      orderId: next.body.orderId,
    });
    const gateway = vi.spyOn(app.get(PokPayPaymentProvider), 'getPayment');
    const reads = gateway.mock.calls.length;
    expect((await check({ orderId: old.body.orderId }).expect(200)).body).toMatchObject({
      paid: true,
      orderId: old.body.orderId,
    });
    expect(gateway.mock.calls.length).toBe(reads);
    const other = await booking();
    await request(app.getHttpServer())
      .post(`${base()}/${other}/check-collection`)
      .set('Cookie', cookie)
      .send({ orderId: old.body.orderId })
      .expect(404);
    expect(gateway.mock.calls.length).toBe(reads);
    await check({ orderId: 123 }).expect(400);
    orders.get(next.body.orderId)!.status = 'PAID';
    expect((await check({ orderId: next.body.orderId }).expect(200)).body).toMatchObject({
      paid: true,
      orderId: next.body.orderId,
    });
    gateway.mockRestore();
  });
  it('mirrors a Clock collection once, without creating another Clock booking', async () => {
    clock = true;
    const id = await booking();
    const first = await request(app.getHttpServer())
      .post(`${base()}/${id}/collect-pokpay`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .expect(200);
    const orderId = first.body.checkoutUrl.split('/').at(-1)!;
    orders.get(orderId)!.status = 'PAID';
    const before = postDeposit.mock.calls.length;
    await app.get(PokPayPaymentService).processAuthoritativeOrder(orderId);
    await app.get(PokPayPaymentService).processAuthoritativeOrder(orderId);
    expect(postDeposit.mock.calls.length - before).toBe(1);
    clock = false;
  });
  it('keeps uncertain checkout attempts durable and never creates a second gateway order', async () => {
    const id = await booking();
    create.mockRejectedValueOnce(new Error('simulated timeout'));
    const before = create.mock.calls.length;
    for (let n = 0; n < 2; n++)
      await request(app.getHttpServer())
        .post(`${base()}/${id}/collect-pokpay`)
        .set('Cookie', cookie)
        .set('Idempotency-Key', randomUUID())
        .expect(409);
    expect(create.mock.calls.length - before).toBe(1);
  });
  it('records a late capture and flags an overpayment instead of losing received money', async () => {
    const id = await booking();
    const first = await request(app.getHttpServer())
      .post(`${base()}/${id}/collect-pokpay`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .expect(200);
    const orderId = first.body.checkoutUrl.split('/').at(-1)!;
    await request(app.getHttpServer())
      .post(`${base()}/${id}/manual-payment`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ method: 'cash', note: 'Cash received before the old card link was used' })
      .expect(200);
    orders.get(orderId)!.status = 'PAID';
    await app.get(PokPayPaymentService).processAuthoritativeOrder(orderId);
    const rows = await admin.$queryRaw<
      Array<{ count: number }>
    >`SELECT COUNT(*)::int AS count FROM manual_review_items WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND reference_id=${id}`;
    expect(rows[0].count).toBe(1);
  });
  it('refuses failed/unknown bookings for online and manual collection', async () => {
    for (const status of ['AVAILABILITY_FAILED', 'PMS_UNKNOWN_RESULT']) {
      const id = await booking(status);
      await request(app.getHttpServer())
        .post(`${base()}/${id}/collect-pokpay`)
        .set('Cookie', cookie)
        .set('Idempotency-Key', randomUUID())
        .expect(409);
      const manual = await request(app.getHttpServer())
        .post(`${base()}/${id}/manual-payment`)
        .set('Cookie', cookie)
        .set('Idempotency-Key', randomUUID())
        .send({ method: 'cash' })
        .expect(200);
      expect(manual.body).toMatchObject({ ok: false, error: { code: 'INVALID_BOOKING_STATE' } });
    }
  });
  it('keeps bank and POS evidence in the audit and makes retries idempotent', async () => {
    clock = false;
    for (const method of ['bank_transfer', 'card_in_person']) {
      const id = await booking();
      const key = randomUUID();
      const evidence = {
        receivedOn: new Date().toISOString().slice(0, 10),
        reference: method === 'bank_transfer' ? 'BANK-TEST-123' : 'POS-TEST-456',
        payerName: 'Test payer',
      };
      const send = (data: object, attempt = key) =>
        request(app.getHttpServer())
          .post(`${base()}/${id}/manual-payment`)
          .set('Cookie', cookie)
          .set('Idempotency-Key', attempt)
          .send(data)
          .expect(200);
      expect(
        (await send({ method, evidence: { ...evidence, reference: '' } }, randomUUID())).body.ok,
      ).toBe(false);
      const first = await send({ method, evidence });
      expect(first.body.ok).toBe(true);
      expect((await send({ method, evidence })).body).toEqual(first.body);
      const audit = await admin.$queryRaw<
        Array<{ details: { evidence: unknown } }>
      >`SELECT details FROM audit_logs WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND target_id=${id} AND action='payment.manual_recorded'`;
      expect(audit).toHaveLength(1);
      expect(audit[0].details.evidence).toMatchObject(evidence);
      const ledger = await request(app.getHttpServer())
        .get(`/tenants/${tenantId}/properties/${propertyId}/payments/bookings/${id}`)
        .set('Cookie', cookie)
        .expect(200);
      expect(
        ledger.body.events.find((e: { action: string }) => e.action === 'payment.manual_recorded')
          .details.evidence,
      ).toMatchObject(evidence);
      expect(ledger.body.entries[0].actorEmail).toBeTruthy();
    }
  });
  it('does not collect an imported Clock total as if earlier external payments were missing', async () => {
    clock = false;
    const id = await booking();
    await admin.$executeRaw`UPDATE bookings SET external_reference='CLOCK-imported-fixture',external_booking_id='999999999' WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${id}::uuid`;
    const calls = create.mock.calls.length;
    await request(app.getHttpServer())
      .post(`${base()}/${id}/collect-pokpay`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .expect(409);
    const manual = await request(app.getHttpServer())
      .post(`${base()}/${id}/manual-payment`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ method: 'cash' })
      .expect(200);
    expect(manual.body.error.code).toBe('CLOCK_BALANCE_UNVERIFIED');
    expect(create.mock.calls.length).toBe(calls);
    const rows = await admin.$queryRaw<
      Array<{ count: number }>
    >`SELECT COUNT(*)::int AS count FROM payments WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND booking_id=${id}::uuid`;
    expect(rows[0].count).toBe(0);
  });
  it.each([false, true])(
    'previews Clock stay prices and recovers without a repeat write or money movement; room type change=%s',
    async (crossType) => {
      const id = await booking(),
        connection = randomUUID(),
        targetType = crossType ? randomUUID() : type,
        targetPlan = randomUUID();
      try {
        await admin.$executeRaw`INSERT INTO integration_connections(id,tenant_id,kind,provider,name,encrypted_credentials,status) VALUES(${connection}::uuid,${tenantId}::uuid,'PMS','CLOCK_PMS','Stay amendment fixture','never-decrypted','CONNECTED')`;
        await admin.$executeRaw`INSERT INTO property_integration_connections(tenant_id,property_id,connection_id,kind) VALUES(${tenantId}::uuid,${propertyId}::uuid,${connection}::uuid,'PMS')`;
        await admin.$executeRaw`INSERT INTO clock_catalog_mappings(tenant_id,property_id,connection_id,entity_type,local_entity_id,external_entity_id,external_name,sync_status) VALUES(${tenantId}::uuid,${propertyId}::uuid,${connection}::uuid,'ROOM_TYPE',${type}::uuid,'21','Stay type','CONFIRMED')`;
        if (crossType) {
          await admin.$executeRaw`INSERT INTO room_types(id,tenant_id,property_id,name,max_occupancy) VALUES(${targetType}::uuid,${tenantId}::uuid,${propertyId}::uuid,'Upgrade',3)`;
          await admin.$executeRaw`INSERT INTO rate_plans(id,tenant_id,property_id,name,currency,clock_shadow_room_type_id) VALUES(${targetPlan}::uuid,${tenantId}::uuid,${propertyId}::uuid,'Clock upgrade','EUR',${targetType}::uuid)`;
          await admin.$executeRaw`INSERT INTO clock_catalog_mappings(tenant_id,property_id,connection_id,entity_type,local_entity_id,external_entity_id,external_name,sync_status) VALUES(${tenantId}::uuid,${propertyId}::uuid,${connection}::uuid,'ROOM_TYPE',${targetType}::uuid,'22','Upgrade','CONFIRMED')`;
        }
        const terms = (
          await admin.$queryRaw<
            Array<{ terms: unknown }>
          >`SELECT cancellation_terms AS terms FROM bookings WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${id}::uuid`
        )[0].terms;
        await admin.$executeRaw`UPDATE bookings SET external_booking_id=${crossType ? '554434' : '554433'} WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${id}::uuid`;
        let raw = {
          id: crossType ? 554434 : 554433,
          status: 'expected',
          arrival: STAY_STARTS_ON,
          departure: STAY_ENDS_ON,
          arrival_room_id: null,
          arrival_room_type_id: 21,
          rate_id: 77,
          lock_version: 1,
          total_booking_value: { cents: 10000, currency: 'EUR' },
          balance: { cents: 10000, currency: 'EUR' },
        };
        const outbound = {
          amendmentRead: vi.fn(async () => ({ ok: true, value: structuredClone(raw) })),
          amendmentWrite: vi.fn(
            async (
              _c: unknown,
              _id: string,
              body: {
                arrival?: string;
                departure?: string;
                arrival_room_type_id?: number;
                rate_id?: number;
              },
            ) => {
              raw = {
                ...raw,
                arrival_room_type_id: body.arrival_room_type_id ?? raw.arrival_room_type_id,
                rate_id: body.rate_id ?? raw.rate_id,
                arrival: body.arrival ?? raw.arrival,
                departure: body.departure ?? raw.departure,
                lock_version: 2,
                total_booking_value: { cents: 15000, currency: 'EUR' },
                balance: { cents: 15000, currency: 'EUR' },
              };
              return {
                ok: false,
                error: {
                  code: 'clock_timeout',
                  message: 'Simulated response loss',
                  retryable: false,
                },
              };
            },
          ),
        };
        const source = {
          activePmsConnectionCredentials: async () => ({
            provider: 'CLOCK_PMS',
            connectionId: connection,
            credentials: {
              host: 'sky-eu1.clock-software.com',
              accountId: '123',
              subscriptionId: '456',
              apiUser: 'fixture',
              apiKey: 'fixture',
            },
          }),
        };
        const quote = {
          selectRateForStay: vi.fn().mockResolvedValue({
            ok: true,
            value: {
              rateId: crossType ? '88' : '77',
              total: { amount: '150.00', currency: 'EUR' },
            },
          }),
        };
        const finance = {
          refresh: async () => ({
            bookingVersion: 1,
            connectionId: connection,
            localPaid: '0.00',
            localRefunded: '0.00',
            balance: { amount: '100.00', currency: 'EUR' },
            paid: { amount: '0.00', currency: 'EUR' },
            refunded: { amount: '0.00', currency: 'EUR' },
          }),
        };
        const service = new ClockStayAmendmentService(
          app.get(TenantDatabaseService),
          source as never,
          outbound as never,
          quote as never,
          finance as never,
          app.get(AuditLogService),
          app.get(ManualReviewService),
        );
        const endsOn = new Date(Date.parse(STAY_ENDS_ON + 'T00:00:00Z') + 86400000)
            .toISOString()
            .slice(0, 10),
          c = { tenantId, propertyId };
        let preview = await service.preview(c, {
          bookingId: id,
          startsOn: STAY_STARTS_ON,
          endsOn,
          ...(crossType ? { roomTypeId: targetType } : {}),
        });
        expect(preview.ok, JSON.stringify(preview)).toBe(true);
        if (!preview.ok) throw Error('Preview failed');
        expect(preview.value).toMatchObject({
          newTotal: '150.00',
          difference: '50.00',
          balance: '150.00',
          refundToIssue: '0.00',
          outcome: 'charge',
        });
        if (!crossType)
          expect(quote.selectRateForStay.mock.calls[0][1]).toMatchObject({ requiredRateId: '77' });
        else expect(quote.selectRateForStay.mock.calls[0][1]).not.toHaveProperty('requiredRateId');
        let command = {
          ...(crossType ? { roomTypeId: targetType } : {}),
          bookingId: id,
          startsOn: STAY_STARTS_ON,
          endsOn,
          expectedVersion: 1,
          previewHash: preview.value.previewHash,
          reason: 'Reviewed extended stay',
          staffActorId: userId,
          idempotencyKey: randomUUID(),
          outcome: 'charge',
          outcomeReason: '',
        };
        if (crossType) {
          expect(preview.value.confirmationAvailable).toBe(false);
          const guarded = await service.amend(c, command);
          expect(guarded).toMatchObject({
            ok: false,
            error: { code: 'ROOM_TYPE_REVIEW_REQUIRED' },
          });
          expect(outbound.amendmentWrite).not.toHaveBeenCalled();
          vi.stubEnv('CLOCK_ROOM_TYPE_AMEND_ALLOWED_PROPERTY_IDS', propertyId);
          preview = await service.preview(c, {
            bookingId: id,
            startsOn: STAY_STARTS_ON,
            endsOn,
            roomTypeId: targetType,
          });
          if (!preview.ok) throw Error('Preview failed');
          expect(preview.value.confirmationAvailable).toBe(true);
          command = { ...command, previewHash: preview.value.previewHash };
        }
        const stale = await service.amend(c, {
          ...command,
          previewHash: 'outdated',
          idempotencyKey: randomUUID(),
        });
        expect(stale.ok).toBe(false);
        expect(outbound.amendmentWrite).not.toHaveBeenCalled();
        const first = await service.amend(c, command);
        expect(first.ok).toBe(false);
        // Exercise JSONB reordering and recovery of the legacy insertion-order hash.
        const operation = (
          await admin.$queryRaw<
            Array<{ command: typeof command }>
          >`SELECT result->'command' AS command FROM integration_operations WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND aggregate_id=${id}::uuid AND status='PENDING'`
        )[0];
        const legacyHash = createHash('sha256').update(JSON.stringify(command)).digest('hex');
        await admin.$executeRaw`UPDATE integration_operations SET request_hash=${legacyHash} WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND aggregate_id=${id}::uuid AND status='PENDING'`;
        expect(
          await service.amend(c, { ...operation.command, reason: 'Different request' }),
        ).toMatchObject({ ok: false, error: { code: 'IDEMPOTENCY_KEY_CONFLICT' } });
        // Background hydration may have observed the provider write before recovery.
        if (!crossType)
          await admin.$executeRaw`UPDATE bookings SET starts_on=${command.startsOn}::date,ends_on=${command.endsOn}::date,total_amount=150,version=version+1 WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${id}::uuid`;
        const recovered = await service.amend(c, operation.command);
        expect(recovered.ok, JSON.stringify(recovered)).toBe(true);
        expect((await service.amend(c, command)).ok).toBe(true);
        expect(outbound.amendmentWrite).toHaveBeenCalledTimes(1);
        if (crossType)
          expect(outbound.amendmentWrite.mock.calls[0][2]).toMatchObject({
            arrival_room_type_id: 22,
            rate_id: 88,
            arrival_room_id: null,
          });
        const rows = await admin.$queryRaw<
          Array<{ endsOn: string; total: string; terms: unknown; payments: number }>
        >`SELECT ends_on::text AS "endsOn",total_amount::text AS total,cancellation_terms AS terms,(SELECT count(*)::int FROM payments p WHERE p.tenant_id=b.tenant_id AND p.property_id=b.property_id AND p.booking_id=b.id) AS payments FROM bookings b WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${id}::uuid`;
        expect(rows[0]).toEqual({ endsOn, total: '150.00', terms, payments: 0 });
      } finally {
        vi.unstubAllEnvs();
        await admin.$executeRaw`DELETE FROM property_integration_connections WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND connection_id=${connection}::uuid`;
      }
    },
  );
  it('prioritizes the selected stale balance without another foreground provider request', async () => {
    const id = await booking(),
      connection = randomUUID();
    await admin.$executeRaw`UPDATE bookings SET external_booking_id='998877' WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${id}::uuid`;
    await admin.$executeRaw`INSERT INTO integration_connections(id,tenant_id,kind,provider,name,encrypted_credentials,status) VALUES(${connection}::uuid,${tenantId}::uuid,'PMS','CLOCK_PMS','Priority fixture','never-decrypted','CONNECTED')`;
    const c = { tenantId, propertyId, connectionId: connection };
    const stale = { fetchedAt: new Date(Date.now() - 600000).toISOString(), bookingVersion: 1 };
    await admin.$executeRaw`INSERT INTO clock_sync_jobs(tenant_id,property_id,connection_id,resource,next_run_at,status,snapshot) VALUES(${tenantId}::uuid,${propertyId}::uuid,${connection}::uuid,'rooms',now()-interval '1 hour','SYNCED','{}'),(${tenantId}::uuid,${propertyId}::uuid,${connection}::uuid,${'financial:' + id},now()-interval '10 minutes','SYNCED',${JSON.stringify(stale)}::jsonb)`;
    const source = {
        activePmsConnectionCredentials: vi
          .fn()
          .mockResolvedValue({ provider: 'CLOCK_PMS', connectionId: connection }),
      },
      reader = { financialData: vi.fn() };
    const db = app.get(TenantDatabaseService),
      service = new ClockFinancialService(db, source as never, reader as never);
    await service.read({ tenantId, propertyId }, id);
    await service.read({ tenantId, propertyId }, id);
    expect(reader.financialData).not.toHaveBeenCalled();
    const worker = new ClockBackgroundSyncService(
      db,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const claim = worker as unknown as {
      claim: (scope: typeof c) => Promise<{ resource: string; id: string }>;
    };
    const first = await claim.claim(c);
    expect(first.resource).toBe('financial:' + id);
    const consumed = await admin.$queryRaw<
      Array<{ requested: boolean }>
    >`SELECT requested_at IS NOT NULL AS requested FROM clock_sync_jobs WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${first.id}::uuid`;
    expect(consumed[0].requested).toBe(false);
    const next = await claim.claim(c);
    expect(next.resource).toBe('rooms');
  });
  it('collects only a verified Clock balance and refuses a credit or changed local ledger', async () => {
    clock = false;
    const connection = randomUUID();
    await admin.$executeRaw`INSERT INTO integration_connections(id,tenant_id,kind,provider,name,encrypted_credentials,status) VALUES(${connection}::uuid,${tenantId}::uuid,'PMS','CLOCK_PMS','Financial guard fixture','never-decrypted','CONNECTED')`;
    await admin.$executeRaw`INSERT INTO property_integration_connections(tenant_id,property_id,connection_id,kind) VALUES(${tenantId}::uuid,${propertyId}::uuid,${connection}::uuid,'PMS')`;
    const id = await booking();
    await admin.$executeRaw`UPDATE bookings SET external_reference='CLOCK-verified-fixture',external_booking_id='999999998' WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${id}::uuid`;
    const version = (
      await admin.$queryRaw<
        Array<{ version: number }>
      >`SELECT version FROM bookings WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${id}::uuid`
    )[0].version;
    const snapshot = {
      bookingId: id,
      bookingVersion: version,
      connectionId: connection,
      localPaid: '0.00',
      localRefunded: '0.00',
      balance: { amount: '30.00', currency: 'EUR' },
    };
    financial.refresh.mockResolvedValue(snapshot as never);
    try {
      const result = await request(app.getHttpServer())
        .post(`${base()}/${id}/collect-pokpay`)
        .set('Cookie', cookie)
        .set('Idempotency-Key', randomUUID())
        .expect(200);
      expect(result.body.amount).toEqual({ amount: '30.00', currency: 'EUR' });
      const stored = { ...snapshot, fetchedAt: new Date().toISOString() };
      await admin.$executeRaw`INSERT INTO clock_sync_jobs(tenant_id,property_id,connection_id,resource,snapshot,status,last_success_at) VALUES(${tenantId}::uuid,${propertyId}::uuid,${connection}::uuid,${'financial:' + id},${JSON.stringify(stored)}::jsonb,'SYNCED',now())`;
      const options = await request(app.getHttpServer())
        .get(`${base()}/${id}/collection-options`)
        .set('Cookie', cookie)
        .expect(200);
      expect(options.body.pokpay).toBe(true);
      const reads = financial.refresh.mock.calls.length;
      const reused = await request(app.getHttpServer())
        .post(`${base()}/${id}/collect-pokpay`)
        .set('Cookie', cookie)
        .set('Idempotency-Key', randomUUID())
        .expect(200);
      expect(reused.body.checkoutUrl).toBe(result.body.checkoutUrl);
      expect(financial.refresh.mock.calls.length).toBe(reads);
      await admin.$executeRaw`INSERT INTO payments(tenant_id,property_id,booking_id,kind,provider,external_payment_id,status,amount,currency) VALUES(${tenantId}::uuid,${propertyId}::uuid,${id}::uuid,'CHARGE','manual',${'freshness-' + id},'PAID',1,'EUR')`;
      const staleOptions = await request(app.getHttpServer())
        .get(`${base()}/${id}/collection-options`)
        .set('Cookie', cookie)
        .expect(200);
      expect(staleOptions.body.pokpay).toBe(false);
      const savedReader = new ClockFinancialService(
        app.get(TenantDatabaseService),
        {
          activePmsConnectionCredentials: async () => ({
            provider: 'CLOCK_PMS',
            connectionId: connection,
          }),
        } as never,
        { financialData: vi.fn() } as never,
      );
      expect(await savedReader.read({ tenantId, propertyId }, id)).toMatchObject({
        isCurrent: false,
        status: 'UPDATING',
      });
      await admin.$executeRaw`DELETE FROM payments WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND booking_id=${id}::uuid AND external_payment_id=${'freshness-' + id}`;
      await admin.$executeRaw`UPDATE clock_sync_jobs SET status='RETRY' WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND connection_id=${connection}::uuid AND resource=${'financial:' + id}`;

      const count = create.mock.calls.length;
      financial.refresh.mockResolvedValue({
        ...snapshot,
        balance: { amount: '-10.00', currency: 'EUR' },
      } as never);
      await request(app.getHttpServer())
        .post(`${base()}/${id}/collect-pokpay`)
        .set('Cookie', cookie)
        .set('Idempotency-Key', randomUUID())
        .expect(409);
      financial.refresh.mockResolvedValue({ ...snapshot, localPaid: '1.00' } as never);
      await request(app.getHttpServer())
        .post(`${base()}/${id}/collect-pokpay`)
        .set('Cookie', cookie)
        .set('Idempotency-Key', randomUUID())
        .expect(409);
      expect(create.mock.calls.length).toBe(count);
      financial.refresh.mockResolvedValue({ ...snapshot, localRefunded: '1.00' } as never);
      const manual = await request(app.getHttpServer())
        .post(`${base()}/${id}/manual-payment`)
        .set('Cookie', cookie)
        .set('Idempotency-Key', randomUUID())
        .send({ method: 'cash' })
        .expect(200);
      expect(manual.body.error.code).toBe('PAYMENT_BALANCE_CHANGED');
    } finally {
      financial.refresh.mockResolvedValue(null);
    }
  });
});
