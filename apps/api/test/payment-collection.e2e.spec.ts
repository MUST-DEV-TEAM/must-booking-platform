import { randomUUID } from 'node:crypto';
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
      const reads = financial.refresh.mock.calls.length;
      const reused = await request(app.getHttpServer())
        .post(`${base()}/${id}/collect-pokpay`)
        .set('Cookie', cookie)
        .set('Idempotency-Key', randomUUID())
        .expect(200);
      expect(reused.body.checkoutUrl).toBe(result.body.checkoutUrl);
      expect(financial.refresh.mock.calls.length).toBe(reads);
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
