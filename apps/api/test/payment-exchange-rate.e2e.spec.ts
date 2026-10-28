import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ClockBackgroundSyncService } from '../src/integrations/clock/clock-background-sync.service';
import { ClockPermissionsMonitorService } from '../src/integrations/clock/clock-permissions-monitor.service';
import { MailDeliveryService } from '../src/mail/mail-delivery.service';
import { AlertEmailService } from '../src/mail/alert-email.service';
import { ScheduledEmailService } from '../src/mail/scheduled-email.service';
import { PropertyExchangeRatesService } from '../src/tenancy/property-exchange-rates.service';
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

describe('the exchange rate kept on a payment in another currency', () => {
  const booking = randomUUID();
  const roomType = randomUUID();
  const ratePlan = randomUUID();
  let app: INestApplication;
  let tenantId = '';
  let propertyId = '';
  let userId = '';
  let savedRates: Array<{
    quote_currency: string;
    rate: string;
    rate_date: Date;
    source: string;
    fetched_at: Date;
  }> = [];

  beforeAll(async () => {
    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL =
      'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.WEB_APP_URL = 'http://localhost:3001';
    await clearSignupRateLimits();
    const { AppModule } = await import('../src/app.module');
    let builder = withoutExternalWorkers(Test.createTestingModule({ imports: [AppModule] }));
    for (const provider of [
      ClockBackgroundSyncService,
      ClockPermissionsMonitorService,
      AlertEmailService,
      ScheduledEmailService,
    ])
      builder = builder.overrideProvider(provider).useValue({});
    builder = builder
      .overrideProvider(MailDeliveryService)
      .useValue({ dispatch: vi.fn().mockResolvedValue(undefined) });
    app = (await builder.compile()).createNestApplication();
    await app.init();
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Fx Fixture Group',
        propertyName: 'Fx Fixture Hotel',
        propertyAddress: '1 Fx Way',
        propertyTimezone: 'Europe/Tirane',
        email: `fx-${randomUUID()}@example.test`,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    propertyId = signup.body.property.id;
    userId = signup.body.user.id;
    await admin.$executeRaw`INSERT INTO room_types(id,tenant_id,property_id,name,max_occupancy) VALUES(${roomType}::uuid,${tenantId}::uuid,${propertyId}::uuid,'Fx room',2)`;
    await admin.$executeRaw`INSERT INTO rate_plans(id,tenant_id,property_id,name,currency) VALUES(${ratePlan}::uuid,${tenantId}::uuid,${propertyId}::uuid,'Fx rate','EUR')`;
    await admin.$executeRaw`INSERT INTO bookings(id,tenant_id,property_id,room_type_id,rate_plan_id,external_reference,status,starts_on,ends_on,total_amount) VALUES(${booking}::uuid,${tenantId}::uuid,${propertyId}::uuid,${roomType}::uuid,${ratePlan}::uuid,'FX-1','CONFIRMED'::"BookingStatus",'2027-03-01','2027-03-03',100)`;
    // The rates table is shared platform data: remember what is there and put it back afterwards.
    savedRates =
      await admin.$queryRaw`SELECT quote_currency, rate::text, rate_date, source, fetched_at FROM exchange_rates WHERE base_currency='EUR' AND quote_currency IN ('ALL','USD')`;
    await admin.$executeRaw`INSERT INTO exchange_rates(base_currency,quote_currency,rate,rate_date,source) VALUES('EUR','ALL',100,'2026-10-27','test'),('EUR','USD',1.25,'2026-10-26','test') ON CONFLICT (base_currency,quote_currency) DO UPDATE SET rate=EXCLUDED.rate, rate_date=EXCLUDED.rate_date, source=EXCLUDED.source`;
  });

  afterAll(async () => {
    await admin.$executeRaw`DELETE FROM exchange_rates WHERE base_currency='EUR' AND quote_currency IN ('ALL','USD')`;
    for (const row of savedRates)
      await admin.$executeRaw`INSERT INTO exchange_rates(base_currency,quote_currency,rate,rate_date,source,fetched_at) VALUES('EUR',${row.quote_currency},${row.rate}::numeric,${row.rate_date},${row.source},${row.fetched_at})`;
    if (app) await app.close();
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id=${userId}::uuid`;
    await admin.$disconnect();
  });

  const pay = (reference: string, currency: string, amount: number) =>
    admin.$executeRaw`INSERT INTO payments(tenant_id,property_id,booking_id,kind,provider,external_payment_id,status,amount,currency) VALUES(${tenantId}::uuid,${propertyId}::uuid,${booking}::uuid,'CHARGE','manual',${reference},'PAID',${amount},${currency})`;

  it('is stored for a payment in another currency, not for one in the booking currency', async () => {
    await pay('fx-same', 'EUR', 50);
    await pay('fx-lek', 'ALL', 5000);
    await pay('fx-usd', 'USD', 25);
    const rows = await admin.$queryRaw<
      Array<{ external_payment_id: string; fx: string | null; fx_date: string | null }>
    >`SELECT external_payment_id, fx_rate_to_booking::text AS fx, fx_rate_date::text AS fx_date FROM payments WHERE booking_id=${booking}::uuid`;
    const by = Object.fromEntries(rows.map((row) => [row.external_payment_id, row]));
    expect(by['fx-same']!.fx).toBeNull();
    // 1 lek is worth 1/100 of a euro; 5,000 lek is about 50 euro.
    expect(Number(by['fx-lek']!.fx)).toBeCloseTo(0.01, 8);
    expect(by['fx-lek']!.fx_date).toBe('2026-10-27');
    // 1 dollar is worth 1/1.25 euro, from the older of the two rate days.
    expect(Number(by['fx-usd']!.fx)).toBeCloseTo(0.8, 8);
    expect(by['fx-usd']!.fx_date).toBe('2026-10-26');
  });

  it('leaves the rate empty when no rate is known, and shows it on the staff payment list', async () => {
    await admin.$executeRaw`DELETE FROM exchange_rates WHERE base_currency='EUR' AND quote_currency='ALL'`;
    await pay('fx-unknown', 'ALL', 100);
    const { PaymentLedgerService } = await import('../src/payments/payment-ledger.service');
    const ledger = await app.get(PaymentLedgerService).ledger({ tenantId, propertyId }, booking);
    expect(ledger?.bookingCurrency).toBe('EUR');
    const by = Object.fromEntries((ledger?.entries ?? []).map((e) => [e.externalPaymentId, e]));
    expect(by['fx-unknown']).toMatchObject({ currency: 'ALL', fxRate: null, fxRateDate: null });
    expect(by['fx-usd']).toMatchObject({ currency: 'USD', fxRateDate: '2026-10-26' });
    expect(Number(by['fx-usd']!.fxRate)).toBeCloseTo(0.8, 8);
    expect(by['fx-same']).toMatchObject({ currency: 'EUR', fxRate: null });
  });

  it('prefers hotel rates for new payment snapshots, falls back after deletion, and never rewrites old rows', async () => {
    await admin.$executeRaw`UPDATE properties SET default_currency='ALL' WHERE tenant_id=${tenantId}::uuid AND id=${propertyId}::uuid`;
    const rates = app.get(PropertyExchangeRatesService);
    await rates.set(tenantId, propertyId, userId, 'EUR', '100');
    await rates.set(tenantId, propertyId, userId, 'USD', '90');
    await pay('hotel-usd', 'USD', 10);
    await rates.set(tenantId, propertyId, userId, 'USD', '95');
    await pay('hotel-usd-new', 'USD', 10);
    await rates.set(tenantId, propertyId, userId, 'USD', null);
    await pay('hotel-usd-feed', 'USD', 10);
    const rows = await admin.$queryRaw<
      Array<{ external_payment_id: string; fx: string | null; amount: string; currency: string }>
    >`SELECT external_payment_id,fx_rate_to_booking::text AS fx,amount::text,currency FROM payments WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND booking_id=${booking}::uuid`;
    const by = Object.fromEntries(rows.map((r) => [r.external_payment_id, r]));
    expect(Number(by['hotel-usd'].fx)).toBeCloseTo(0.9, 8);
    expect(Number(by['hotel-usd-new'].fx)).toBeCloseTo(0.95, 8);
    // Restore a known feed leg: the preceding test deliberately removed ALL.
    // Without that base feed rate the deleted USD override cannot be converted through ALL.
    expect(by['hotel-usd-feed'].fx).toBeNull();
    await admin.$executeRaw`INSERT INTO exchange_rates(base_currency,quote_currency,rate,rate_date,source) VALUES('EUR','ALL',100,'2026-10-27','test') ON CONFLICT(base_currency,quote_currency) DO UPDATE SET rate=EXCLUDED.rate`;
    await pay('hotel-usd-feed-known', 'USD', 10);
    const fallback = await admin.$queryRaw<
      Array<{ fx: string }>
    >`SELECT fx_rate_to_booking::text AS fx FROM payments WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND external_payment_id='hotel-usd-feed-known'`;
    expect(Number(fallback[0].fx)).toBeCloseTo(0.8, 8);
    expect(by['hotel-usd']).toMatchObject({ amount: '10.00', currency: 'USD' });
    expect(Number(by['fx-usd'].fx)).toBeCloseTo(0.8, 8);
    expect(by['fx-unknown'].fx).toBeNull();
  });
});
