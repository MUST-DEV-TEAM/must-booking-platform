import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TenantDatabaseService } from '../src/tenancy/tenant-database.service';
import { CapabilitiesService } from '../src/tenancy/capabilities.service';
import { NotificationsService } from '../src/tenancy/notifications.service';
import { AuditLogService } from '../src/tenancy/audit-log.service';
import { ManualReviewService } from '../src/integrations/manual-review.service';
import { PaymentRefundService } from '../src/payments/payment-refund.service';
import { LocalPmsProvider } from '../src/booking/local-pms.provider';
import { BookingStateMachine } from '../src/booking/booking-state-machine';
import {
  BookingRequestsService,
  refundPreview,
  withinFreeWindow,
} from '../src/booking/booking-requests.service';

// Isolated local schema, dropped afterward. No migration of the development schema,
// no workers, no API app, no provider transport. Cancellation and refund code are real.
const schema = 'b1_test_' + randomUUID().replaceAll('-', '');
const adminUrl = 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking';
const appUrl = 'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
const admin = new PrismaClient({ datasources: { db: { url: adminUrl + '?schema=' + schema } } });
const db = new TenantDatabaseService({
  datasources: { db: { url: appUrl + '?schema=' + schema } },
});
const originalTransaction = db.withTenantTransaction.bind(db);
db.withTenantTransaction = (c, operation, options) =>
  originalTransaction(
    c,
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}",public`);
      return operation(tx);
    },
    options,
  );
const tenantId = randomUUID(),
  propertyId = randomUUID(),
  roomType = randomUUID(),
  ratePlan = randomUUID(),
  guest = randomUUID();
const requester = randomUUID(),
  reviewer = randomUUID(),
  secondReviewer = randomUUID();
const context = { tenantId, propertyId, userId: requester };
let clockMode = false;
const clock = {
  cancelRealReservation: vi.fn(async () => ({
    ok: false,
    error: { code: 'CLOCK_TIMEOUT', message: 'Clock result unknown', retryable: true },
  })),
  postRefund: vi.fn(async () => ({ ok: true, value: null })),
};
const email = { sendRefundConfirmationEmailSafely: vi.fn(async () => {}) };
const cancellationEmail = { sendAfterCancellation: vi.fn(async () => {}) };
let service: BookingRequestsService, refunds: PaymentRefundService, audit: AuditLogService;
const tables = [
  'users',
  'properties',
  'bookings',
  'room_types',
  'rooms',
  'rate_plans',
  'cancellation_policies',
  'guests',
  'payments',
  'notifications',
  'notification_resolutions',
  'audit_logs',
  'capabilities',
  'tenant_memberships',
  'property_staff_assignments',
  'property_role_template_capabilities',
  'property_staff_capability_overrides',
  'integration_operations',
  'manual_review_items',
];
// Preserve dollar-quoted function bodies while executing each prepared SQL statement.
function statements(sql: string) {
  sql = sql.replace(/--[^\n]*/g, '');
  let dollar = false,
    start = 0;
  const result: string[] = [];
  for (let i = 0; i < sql.length; i++) {
    if (sql.slice(i, i + 2) === '$$') {
      dollar = !dollar;
      i++;
    } else if (sql[i] === ';' && !dollar) {
      result.push(sql.slice(start, i));
      start = i + 1;
    }
  }
  return result.filter((s) => s.replace(/--[^\n]*/g, '').trim());
}
async function fixture(paid = true) {
  const id = randomUUID();
  await admin.$executeRaw`INSERT INTO bookings(id,tenant_id,property_id,room_type_id,rate_plan_id,guest_id,external_reference,status,starts_on,ends_on,total_amount,payment_method) VALUES(${id}::uuid,${tenantId}::uuid,${propertyId}::uuid,${roomType}::uuid,${ratePlan}::uuid,${guest}::uuid,${'B1-' + id},'CONFIRMED','2030-07-10','2030-07-12',100,'PAY_AT_HOTEL')`;
  if (paid)
    await admin.$executeRaw`INSERT INTO payments(tenant_id,property_id,booking_id,kind,provider,external_payment_id,status,amount,currency) VALUES(${tenantId}::uuid,${propertyId}::uuid,${id}::uuid,'CHARGE','manual',${'charge-' + id},'PAID',100,'EUR')`;
  return id;
}
async function request(id: string, choice: 'eligible' | 'custom' = 'eligible', c = context) {
  const preview = await service.preview(c, id);
  const result = await service.submit(c, id, {
    expectedVersion: preview.version,
    previewHash: preview.previewHash,
    reasonCategory: 'guest_request',
    priority: 'high',
    details: 'Guest requests cancellation',
    refund: choice,
    customAmount: choice === 'custom' ? '30.00' : undefined,
    notifyGuest: false,
  });
  if (!('request' in result) || !result.request) throw new Error('Expected pending request');
  return result.request.id;
}
const approve = (id: string, userId = reviewer, note = 'Reviewed policy and refund') =>
  service.decide({ ...context, userId }, id, { decision: 'Approved', note, version: 1 });
beforeAll(async () => {
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  await admin.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}",public`);
      for (const t of tables)
        await tx.$executeRawUnsafe(
          `CREATE TABLE "${schema}"."${t}" (LIKE public."${t}" INCLUDING ALL)`,
        );
      // Real migration, including rerun safety, exact RLS and immutable decisions.
      const sql = readFileSync(
        'prisma/migrations/20261020100000_booking_requests/migration.sql',
        'utf8',
      );
      for (let run = 0; run < 2; run++)
        for (const statement of statements(sql)) await tx.$executeRawUnsafe(statement);
      const correction = readFileSync(
        'prisma/migrations/20261020120000_request_self_approval/migration.sql',
        'utf8',
      );
      for (let run = 0; run < 2; run++)
        for (const statement of statements(correction)) await tx.$executeRawUnsafe(statement);
      await tx.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "${schema}" TO must_booking_app`);
      await tx.$executeRawUnsafe(
        `GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA "${schema}" TO must_booking_app`,
      );
      // Resolve the existing tenancy functions and enum types from public for raw queries.
      await tx.$executeRawUnsafe(
        `CREATE FUNCTION "${schema}".app_current_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT public.app_current_tenant_id()'`,
      );
      await tx.$executeRawUnsafe(
        `CREATE FUNCTION "${schema}".app_current_property_id() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT public.app_current_property_id()'`,
      );
    },
    { timeout: 30000 },
  );
  // Prisma schema-only search_path cannot resolve public enum types; alias the types
  // used by existing raw SQL by adding public to both test connection search paths.
  // PostgreSQL options is applied per pooled connection.
  await admin.$executeRaw`INSERT INTO properties(id,tenant_id,name,slug,timezone) VALUES(${propertyId}::uuid,${tenantId}::uuid,'B1 fixture',${schema},'Europe/Tirane')`;
  for (const id of [requester, reviewer, secondReviewer]) {
    await admin.$executeRaw`INSERT INTO users(id,email,first_name) VALUES(${id}::uuid,${id + '@example.test'},${id === requester ? 'Requester' : 'Reviewer'})`;
    await admin.$executeRaw`INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES(${tenantId}::uuid,${id}::uuid,${id === requester ? 'STAFF' : 'ADMIN'}::public."TenantMembershipRole")`;
  }
  await admin.$executeRaw`INSERT INTO room_types(id,tenant_id,property_id,name,max_occupancy) VALUES(${roomType}::uuid,${tenantId}::uuid,${propertyId}::uuid,'B1 room',2)`;
  await admin.$executeRaw`INSERT INTO rate_plans(id,tenant_id,property_id,name,currency,code,free_cancellation_until_hours) VALUES(${ratePlan}::uuid,${tenantId}::uuid,${propertyId}::uuid,'B1 flexible','EUR','B1-FLEX',24)`;
  await admin.$executeRaw`INSERT INTO guests(id,tenant_id,email) VALUES(${guest}::uuid,${tenantId}::uuid,${guest + '@example.test'})`;
  // Requester can view and ask, but cannot directly cancel; no review capability.
  for (const key of ['bookings.view', 'bookings.cancel', 'payments.refund', 'requests.review'])
    await admin.$executeRaw`INSERT INTO capabilities(tenant_id,key,description) VALUES(${tenantId}::uuid,${key},${key})`;
  await admin.$executeRaw`INSERT INTO property_staff_assignments(tenant_id,property_id,user_id,role_template_id) VALUES(${tenantId}::uuid,${propertyId}::uuid,${requester}::uuid,${randomUUID()}::uuid)`;
  for (const key of ['bookings.view', 'payments.refund'])
    await admin.$executeRaw`INSERT INTO property_staff_capability_overrides(tenant_id,property_id,user_id,capability_id,granted) SELECT ${tenantId}::uuid,${propertyId}::uuid,${requester}::uuid,id,true FROM capabilities WHERE tenant_id=${tenantId}::uuid AND key=${key}`;
  audit = new AuditLogService(db);
  const notifications = new NotificationsService(db),
    manual = new ManualReviewService(db);
  const mock = <T>(value: unknown) => value as T;
  refunds = new PaymentRefundService(
    db,
    audit,
    mock({}),
    mock(email),
    notifications,
    mock(clock),
    manual,
  );
  const local = new LocalPmsProvider(
    db,
    mock({ releaseBookedUnits: vi.fn(async () => {}) }),
    audit,
    new BookingStateMachine(),
    mock({}),
    mock({}),
    refunds,
    mock(email),
    mock({}),
    mock(cancellationEmail),
    notifications,
    mock({
      activePmsConnectionCredentials: async () => (clockMode ? { provider: 'CLOCK_PMS' } : null),
    }),
    manual,
    mock(clock),
    mock({}),
  );
  service = new BookingRequestsService(
    db,
    new CapabilitiesService(db),
    local,
    refunds,
    notifications,
    manual,
    audit,
  );
});
afterAll(async () => {
  await db.$disconnect();
  // Only the generated, validated test schema can be removed.
  if (!/^b1_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe test schema');
  await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.$disconnect();
});
describe('B1 risky cancellation paths', () => {
  it('refund preview uses integer cents with no percentage rounding', () => {
    expect(refundPreview('100.01', '20.00', '100.01', true)).toEqual({
      penalty: '0.00',
      eligible: '80.01',
    });
    expect(refundPreview('100.01', '0', '100.01', false).eligible).toBe('0.00');
  });
  it('fails closed without cancellation/review capability; allows only a pending request', async () => {
    const id = await fixture();
    const q = await request(id);
    expect(
      (await service.list({ ...context, userId: reviewer })).items.find((r) => r.id === q)?.status,
    ).toBe('Pending');
    await expect(approve(q, requester)).rejects.toThrow('requests.review');
    const rows = await admin.$queryRaw<
      { status: string }[]
    >`SELECT status::text FROM bookings WHERE id=${id}::uuid`;
    expect(rows[0]?.status).toBe('CONFIRMED');
  });
  it('two simultaneous reviewers yield one winner and a single refund; retry cannot refund again', async () => {
    const id = await fixture(),
      q = await request(id, 'custom');
    const outcomes = await Promise.allSettled([approve(q), approve(q, secondReviewer)]);
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((r) => r.status === 'rejected')).toHaveLength(1);
    await expect(approve(q)).rejects.toThrow('already changed');
    const rows = await admin.$queryRaw<
      { count: bigint; amount: string }[]
    >`SELECT count(*) AS count,sum(amount)::text AS amount FROM payments WHERE booking_id=${id}::uuid AND kind='REFUND'`;
    expect(Number(rows[0]?.count)).toBe(1);
    expect(rows[0]?.amount).toBe('30.00');
    const resolutions = await db.withTenantTransaction(
      context,
      (tx) =>
        tx.$queryRaw<
          { name: string; note: string }[]
        >`SELECT u.first_name AS name,r.note FROM notification_resolutions r JOIN notifications n ON n.id=r.notification_id AND n.tenant_id=r.tenant_id AND n.property_id=r.property_id JOIN users u ON u.id=r.resolved_by_user_id WHERE r.tenant_id=${tenantId}::uuid AND r.property_id=${propertyId}::uuid AND n.payload->>'requestId'=${q}`,
    );
    expect(resolutions).toEqual([{ name: 'Reviewer', note: 'Reviewed policy and refund' }]);
    await expect(
      db.withTenantTransaction(
        context,
        (tx) =>
          tx.$executeRaw`UPDATE booking_requests SET decision_note='changed' WHERE id=${q}::uuid`,
      ),
    ).rejects.toThrow('decision changed');
  });
  it('requires finance permission for custom amounts and forbids self-approval', async () => {
    const id = await fixture(),
      e = await service.preview(context, id);
    await admin.$executeRaw`UPDATE property_staff_capability_overrides SET granted=false WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND user_id=${requester}::uuid AND capability_id IN (SELECT id FROM capabilities WHERE tenant_id=${tenantId}::uuid AND key='payments.refund')`;
    await expect(
      service.submit(context, id, {
        expectedVersion: e.version,
        previewHash: e.previewHash,
        reasonCategory: 'other',
        details: 'Custom refund',
        refund: 'custom',
        customAmount: '10.00',
      }),
    ).rejects.toThrow('payments.refund');
    await admin.$executeRaw`UPDATE property_staff_capability_overrides SET granted=true WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND user_id=${requester}::uuid AND capability_id IN (SELECT id FROM capabilities WHERE tenant_id=${tenantId}::uuid AND key='payments.refund')`;
    const c = { ...context, userId: reviewer };
    const created = await service.submit(c, id, {
      expectedVersion: e.version,
      previewHash: e.previewHash,
      reasonCategory: 'other',
      details: 'Custom refund',
      refund: 'custom',
      customAmount: '10.00',
    });
    if (!('request' in created) || !created.request) throw new Error('Expected request');
    await expect(approve(created.request.id)).rejects.toThrow('Another reviewer');
  });
  it('direct cancellation double click and refund retries issue at most once', async () => {
    const c = { ...context, userId: reviewer },
      id = await fixture(),
      e = await service.preview(c, id);
    const input = {
      expectedVersion: e.version,
      previewHash: e.previewHash,
      reasonCategory: 'other',
      details: 'Direct cancellation',
      notifyGuest: false,
    };
    const results = await Promise.allSettled([
      service.submit(c, id, input),
      service.submit(c, id, input),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const command = {
      bookingId: id,
      idempotencyKey: `b1-direct:${id}:${e.version}:refund`,
      amount: { amount: e.eligible, currency: e.currency },
      actorUserId: reviewer,
      note: 'Cancellation: Direct cancellation',
    };
    await Promise.all([refunds.manualRefund(c, command), refunds.manualRefund(c, command)]);
    const rows = await admin.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) AS count FROM payments WHERE booking_id=${id}::uuid AND kind='REFUND'`;
    expect(Number(rows[0]?.count)).toBe(1);
    expect(cancellationEmail.sendAfterCancellation).toHaveBeenCalledWith(expect.anything(), id, {
      notifyGuest: false,
    });
  });
  it('recovers a decision-commit failure with the same intent and no second refund', async () => {
    const id = await fixture(),
      q = await request(id, 'custom');
    const record = audit.recordInTransaction.bind(audit);
    const spy = vi.spyOn(audit, 'recordInTransaction').mockImplementation(async (tx, entry) => {
      if (entry.action === 'request.decided') throw new Error('Simulated decision commit failure');
      return record(tx, entry);
    });
    await expect(approve(q)).rejects.toThrow('Simulated decision commit failure');
    spy.mockRestore();
    await expect(
      service.decide({ ...context, userId: reviewer }, q, {
        decision: 'Rejected',
        note: 'Changed mind',
        version: 1,
      }),
    ).rejects.toThrow('execution has started');
    expect((await approve(q)).ok).toBe(true);
    const rows = await admin.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) AS count FROM payments WHERE booking_id=${id}::uuid AND kind='REFUND'`;
    expect(Number(rows[0]?.count)).toBe(1);
  });
  it('tenant and hotel isolation are enforced by forced RLS and scoped APIs', async () => {
    const id = await fixture(),
      q = await request(id);
    for (const c of [
      { ...context, propertyId: randomUUID(), userId: reviewer },
      { ...context, tenantId: randomUUID(), userId: reviewer },
    ]) {
      const rows = await db.withTenantTransaction(
        c,
        (tx) => tx.$queryRaw`SELECT * FROM booking_requests WHERE id=${q}::uuid`,
      );
      expect(rows).toEqual([]);
      await expect(
        service.decide(c, q, { decision: 'Approved', note: 'Wrong scope', version: 1 }),
      ).rejects.toThrow();
    }
    const rows = await db.$queryRaw`SELECT * FROM booking_requests`;
    expect(rows).toEqual([]);
  });
  it('deadline is inclusive and evaluated from property-local midnight across DST', async () => {
    const cutoff = '2030-07-08T22:00:00.000Z',
      at = new Date(cutoff).getTime();
    expect(withinFreeWindow(cutoff, new Date(at - 1))).toBe(true);
    expect(withinFreeWindow(cutoff, new Date(at))).toBe(true);
    expect(withinFreeWindow(cutoff, new Date(at + 1))).toBe(false);
    expect(withinFreeWindow(null, new Date(at))).toBe(false);
    const id = await fixture(false),
      e = await service.preview(context, id);
    expect(e.cutoffAt).toBe('2030-07-08T22:00:00.000Z');
    await admin.$executeRaw`UPDATE properties SET timezone='Pacific/Kiritimati' WHERE id=${propertyId}::uuid`;
    expect((await service.preview(context, id)).cutoffAt).toBe('2030-07-08T10:00:00.000Z');
    await admin.$executeRaw`UPDATE properties SET timezone='Europe/Tirane' WHERE id=${propertyId}::uuid`;
  });
  it.each(['OWNER', 'ADMIN'])(
    'allows self-approval only for the sole active %s reviewer',
    async (role) => {
      await admin.$executeRaw`UPDATE tenant_memberships SET role=${role}::public."TenantMembershipRole" WHERE tenant_id=${tenantId}::uuid AND user_id=${reviewer}::uuid`;
      await admin.$executeRaw`UPDATE tenant_memberships SET role='STAFF' WHERE tenant_id=${tenantId}::uuid AND user_id=${secondReviewer}::uuid`;
      await admin.$executeRaw`INSERT INTO property_staff_assignments(tenant_id,property_id,user_id,role_template_id,suspended_at) VALUES(${tenantId}::uuid,${propertyId}::uuid,${secondReviewer}::uuid,${randomUUID()}::uuid,now())`;
      await admin.$executeRaw`INSERT INTO property_staff_capability_overrides(tenant_id,property_id,user_id,capability_id,granted) SELECT ${tenantId}::uuid,${propertyId}::uuid,${secondReviewer}::uuid,id,true FROM capabilities WHERE tenant_id=${tenantId}::uuid AND key='requests.review'`;
      try {
        const id = await fixture(),
          q = await request(id, 'custom', { ...context, userId: reviewer });
        const result = await approve(q);
        expect(result).toMatchObject({ ok: true, selfApproved: true, status: 'Approved' });
        const decision = (await service.list({ ...context, userId: reviewer })).decisions.find(
          (d) => d.id === q,
        );
        expect(decision).toMatchObject({
          selfApproved: true,
          decisionNote: 'Reviewed policy and refund',
        });
        await expect(
          db.withTenantTransaction(
            context,
            (tx) =>
              tx.$executeRaw`UPDATE booking_requests SET self_approved=false WHERE id=${q}::uuid`,
          ),
        ).rejects.toThrow('decision changed');
      } finally {
        await admin.$executeRaw`DELETE FROM property_staff_capability_overrides WHERE tenant_id=${tenantId}::uuid AND user_id=${secondReviewer}::uuid`;
        await admin.$executeRaw`DELETE FROM property_staff_assignments WHERE tenant_id=${tenantId}::uuid AND user_id=${secondReviewer}::uuid`;
        await admin.$executeRaw`UPDATE tenant_memberships SET role='ADMIN' WHERE tenant_id=${tenantId}::uuid AND user_id IN (${reviewer}::uuid,${secondReviewer}::uuid)`;
      }
    },
  );
  it('refuses self-approval when another staff reviewer is granted access after the request', async () => {
    await admin.$executeRaw`UPDATE tenant_memberships SET role='STAFF' WHERE tenant_id=${tenantId}::uuid AND user_id=${secondReviewer}::uuid`;
    try {
      const id = await fixture(),
        q = await request(id, 'custom', { ...context, userId: reviewer });
      await admin.$executeRaw`INSERT INTO property_staff_assignments(tenant_id,property_id,user_id,role_template_id) VALUES(${tenantId}::uuid,${propertyId}::uuid,${secondReviewer}::uuid,${randomUUID()}::uuid)`;
      await admin.$executeRaw`INSERT INTO property_staff_capability_overrides(tenant_id,property_id,user_id,capability_id,granted) SELECT ${tenantId}::uuid,${propertyId}::uuid,${secondReviewer}::uuid,id,true FROM capabilities WHERE tenant_id=${tenantId}::uuid AND key='requests.review'`;
      await expect(approve(q)).rejects.toThrow('Another reviewer');
    } finally {
      await admin.$executeRaw`DELETE FROM property_staff_capability_overrides WHERE tenant_id=${tenantId}::uuid AND user_id=${secondReviewer}::uuid`;
      await admin.$executeRaw`DELETE FROM property_staff_assignments WHERE tenant_id=${tenantId}::uuid AND user_id=${secondReviewer}::uuid`;
      await admin.$executeRaw`UPDATE tenant_memberships SET role='ADMIN' WHERE tenant_id=${tenantId}::uuid AND user_id=${secondReviewer}::uuid`;
    }
  });
  it('refuses a sole STAFF reviewer self-approval', async () => {
    await admin.$executeRaw`UPDATE tenant_memberships SET role='STAFF' WHERE tenant_id=${tenantId}::uuid AND user_id IN (${reviewer}::uuid,${secondReviewer}::uuid)`;
    await admin.$executeRaw`INSERT INTO property_staff_capability_overrides(tenant_id,property_id,user_id,capability_id,granted) SELECT ${tenantId}::uuid,${propertyId}::uuid,${requester}::uuid,id,true FROM capabilities WHERE tenant_id=${tenantId}::uuid AND key='requests.review'`;
    try {
      const id = await fixture(),
        q = await request(id, 'custom');
      await expect(approve(q, requester)).rejects.toThrow('sole active Owner or Admin');
    } finally {
      await admin.$executeRaw`DELETE FROM property_staff_capability_overrides WHERE tenant_id=${tenantId}::uuid AND user_id=${requester}::uuid AND capability_id IN (SELECT id FROM capabilities WHERE tenant_id=${tenantId}::uuid AND key='requests.review')`;
      await admin.$executeRaw`UPDATE tenant_memberships SET role='ADMIN' WHERE tenant_id=${tenantId}::uuid AND user_id IN (${reviewer}::uuid,${secondReviewer}::uuid)`;
    }
  });
  it('previews, requests and cancels one booking in a two-booking order with only its remaining share refunded', async () => {
    const first = await fixture(),
      second = await fixture(),
      reference = 'ORDER-' + randomUUID();
    await admin.$executeRaw`UPDATE bookings SET order_reference=${reference} WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id IN (${first}::uuid,${second}::uuid)`;
    await admin.$executeRaw`INSERT INTO payments(tenant_id,property_id,booking_id,kind,provider,external_payment_id,status,amount,currency) VALUES(${tenantId}::uuid,${propertyId}::uuid,${second}::uuid,'REFUND','manual',${randomUUID()},'REFUNDED',20,'EUR')`;
    expect(await service.preview(context, second)).toMatchObject({
      eligible: '80.00',
      paid: '100.00',
      alreadyRefunded: '20.00',
    });
    const q = await request(second);
    expect((await approve(q)).ok).toBe(true);
    const states = await admin.$queryRaw<
      { id: string; status: string }[]
    >`SELECT id,status::text FROM bookings WHERE id IN (${first}::uuid,${second}::uuid)`;
    expect(states).toEqual(
      expect.arrayContaining([
        { id: first, status: 'CONFIRMED' },
        { id: second, status: 'CANCELLED' },
      ]),
    );
    const rows = await admin.$queryRaw<
      { amount: string }[]
    >`SELECT sum(amount)::text AS amount FROM payments WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND booking_id=${second}::uuid AND kind='REFUND'`;
    expect(rows[0]?.amount).toBe('100.00');
    // The other booking's direct cancellation has its own key and share.
    const c = { ...context, userId: reviewer },
      e = await service.preview(c, first);
    expect(e.eligible).toBe('100.00');
    expect(
      (
        await service.submit(c, first, {
          expectedVersion: e.version,
          previewHash: e.previewHash,
          reasonCategory: 'other',
          details: 'Cancel remaining reservation',
          notifyGuest: false,
        })
      ).ok,
    ).toBe(true);
  });
  it('fails closed for an order charge without an unambiguous booking split', async () => {
    const first = await fixture(),
      second = await fixture(false),
      reference = 'AMBIGUOUS-' + randomUUID();
    await admin.$executeRaw`UPDATE bookings SET order_reference=${reference} WHERE id IN (${first}::uuid,${second}::uuid)`;
    await admin.$executeRaw`UPDATE payments SET amount=200 WHERE booking_id=${first}::uuid AND kind='CHARGE'`;
    for (const id of [first, second])
      await expect(service.preview(context, id)).rejects.toThrow(
        'cannot tell how the order payment is split',
      );
    const rows = await admin.$queryRaw<
      { status: string }[]
    >`SELECT status::text FROM bookings WHERE id IN (${first}::uuid,${second}::uuid)`;
    expect(rows.every((b) => b.status === 'CONFIRMED')).toBe(true);
  });
  it('Clock failure keeps booking confirmed, request pending, and creates sync review without refund', async () => {
    const id = await fixture(),
      q = await request(id);
    await admin.$executeRaw`UPDATE bookings SET external_booking_id='clock-fixture' WHERE id=${id}::uuid`;
    clockMode = true;
    try {
      const result = await approve(q);
      expect(result.ok).toBe(false);
      const rows = await db.withTenantTransaction(
        context,
        (tx) =>
          tx.$queryRaw<
            { status: string; booking: string; refunds: bigint; reviews: bigint }[]
          >`SELECT q.status,b.status::text AS booking,(SELECT count(*) FROM payments WHERE booking_id=b.id AND kind='REFUND') AS refunds,(SELECT count(*) FROM manual_review_items WHERE reference_id=b.id::text) AS reviews FROM booking_requests q JOIN bookings b ON b.id=q.booking_id WHERE q.id=${q}::uuid`,
      );
      expect(rows[0]?.status).toBe('Pending');
      expect(rows[0]?.booking).toBe('CONFIRMED');
      expect(Number(rows[0]?.refunds)).toBe(0);
      expect(Number(rows[0]?.reviews)).toBe(1);
    } finally {
      clockMode = false;
    }
  });
});

it('Clock unknown policy: privileged staff must acknowledge terms and choose an explicit refund; concurrent retry refunds once', async () => {
  const id = await fixture();
  await admin.$executeRaw`UPDATE bookings SET external_booking_id='clock-policy-test' WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${id}::uuid`;
  const c = { ...context, userId: reviewer };
  const e = await service.preview(c, id);
  expect(e).toMatchObject({
    policySource: 'CLOCK_PMS',
    cutoffAt: null,
    isFree: false,
    eligible: '0.00',
    legacyPolicy: false,
  });
  const body = {
    expectedVersion: e.version,
    previewHash: e.previewHash,
    reasonCategory: 'guest_request',
    details: 'Reviewed Clock terms',
    refund: 'custom' as const,
    customAmount: '30.00',
    notifyGuest: false,
  };
  await expect(service.submit(c, id, body)).rejects.toThrow('Confirm Clock-managed');
  await expect(
    service.submit(c, id, { ...body, refund: 'eligible', clockTermsConfirmed: true }),
  ).rejects.toThrow('explicitly choose');
  const outcomes = await Promise.allSettled([
    service.submit(c, id, { ...body, clockTermsConfirmed: true }),
    service.submit(c, id, { ...body, clockTermsConfirmed: true }),
  ]);
  expect(outcomes.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  const rows = await admin.$queryRaw<
    { status: string; refunds: string; requests: bigint }[]
  >`SELECT b.status::text,(SELECT sum(amount)::text FROM payments WHERE tenant_id=b.tenant_id AND property_id=b.property_id AND booking_id=b.id AND kind='REFUND') AS refunds,(SELECT count(*) FROM booking_requests WHERE tenant_id=b.tenant_id AND property_id=b.property_id AND booking_id=b.id) AS requests FROM bookings b WHERE b.tenant_id=${tenantId}::uuid AND b.property_id=${propertyId}::uuid AND b.id=${id}::uuid`;
  expect(rows[0]).toMatchObject({ status: 'CANCELLED', refunds: '30.00', requests: 0n });
});
it('commits a refund and idempotent replay when Clock posting exceeds the default five seconds', async () => {
  const id = await fixture();
  clock.postRefund.mockImplementationOnce(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5500));
    return { ok: true, value: null };
  });
  const command = {
    bookingId: id,
    idempotencyKey: 'slow-clock-' + id,
    amount: { amount: '30.00', currency: 'EUR' },
    actorUserId: reviewer,
    note: 'Slow successful Clock refund regression',
  };
  const first = await refunds.manualRefund({ tenantId, propertyId }, command);
  expect(first.ok).toBe(true);
  const replay = await refunds.manualRefund({ tenantId, propertyId }, command);
  expect(replay).toEqual(first);
  const rows = await admin.$queryRaw<
    { count: bigint; amount: string }[]
  >`SELECT count(*),sum(amount)::text AS amount FROM payments WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND booking_id=${id}::uuid AND kind='REFUND'`;
  expect(rows[0]).toEqual({ count: 1n, amount: '30.00' });
}, 15000);

it('Clock no-refund choice never automatically refunds; staff without refund capability request review', async () => {
  for (const userId of [reviewer, requester]) {
    if (userId === requester) {
      await admin.$executeRaw`INSERT INTO property_staff_capability_overrides(tenant_id,property_id,user_id,capability_id,granted) SELECT ${tenantId}::uuid,${propertyId}::uuid,${requester}::uuid,id,true FROM capabilities WHERE tenant_id=${tenantId}::uuid AND key='bookings.cancel' ON CONFLICT DO NOTHING`;
      await admin.$executeRaw`UPDATE property_staff_capability_overrides SET granted=false WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND user_id=${requester}::uuid AND capability_id IN (SELECT id FROM capabilities WHERE tenant_id=${tenantId}::uuid AND key='payments.refund')`;
    }
    const id = await fixture();
    await admin.$executeRaw`UPDATE bookings SET external_booking_id=${'clock-policy-none-' + id} WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${id}::uuid`;
    const c = { ...context, userId };
    const e = await service.preview(c, id);
    const result = await service.submit(c, id, {
      expectedVersion: e.version,
      previewHash: e.previewHash,
      reasonCategory: 'guest_request',
      details: 'Explicitly no refund',
      refund: 'none',
      clockTermsConfirmed: true,
      notifyGuest: false,
    });
    expect('request' in result).toBe(userId === requester);
    const refunds = await admin.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) FROM payments WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND booking_id=${id}::uuid AND kind='REFUND'`;
    expect(refunds[0].count).toBe(0n);
  }
});
