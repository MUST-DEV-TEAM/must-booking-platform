import { vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTenant } from './helpers/cleanup-tenant';
import { STAY_STARTS_ON, STAY_ENDS_ON } from './helpers/future-stay';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';
import { withoutExternalWorkers } from './helpers/without-external-workers';

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('staff view of a booking that needs review', () => {
  const email = `review-${randomUUID()}@example.test`;
  const roomType = randomUUID();
  const ratePlan = randomUUID();
  const needsReview = randomUUID();
  const fine = randomUUID();
  let app: INestApplication;
  let tenantId = '';
  let propertyId = '';
  let userId = '';
  let cookie = '';
  const base = () => `/tenants/${tenantId}/properties/${propertyId}/bookings`;

  beforeAll(async () => {
    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL =
      'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.WEB_APP_URL = 'http://localhost:3001';
    await clearSignupRateLimits();
    const { AppModule } = await import('../src/app.module');
    app = (
      await withoutExternalWorkers(Test.createTestingModule({ imports: [AppModule] })).compile()
    ).createNestApplication();
    await app.init();
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Review Fixture Group',
        propertyName: 'Review Fixture Hotel',
        propertyAddress: '1 Review Way',
        propertyTimezone: 'Europe/Tirane',
        email,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    propertyId = signup.body.property.id;
    userId = signup.body.user.id;
    cookie = signup.headers['set-cookie'][0];
    await admin.$executeRaw`INSERT INTO room_types(id,tenant_id,property_id,name,max_occupancy) VALUES(${roomType}::uuid,${tenantId}::uuid,${propertyId}::uuid,'Review room',2)`;
    await admin.$executeRaw`INSERT INTO rate_plans(id,tenant_id,property_id,name,currency) VALUES(${ratePlan}::uuid,${tenantId}::uuid,${propertyId}::uuid,'Review rate','EUR')`;
    for (const [id, status, ref] of [
      [needsReview, 'MANUAL_REVIEW', 'REV-1'],
      [fine, 'CONFIRMED', 'REV-2'],
    ])
      await admin.$executeRaw`INSERT INTO bookings(id,tenant_id,property_id,room_type_id,rate_plan_id,external_reference,status,starts_on,ends_on,total_amount) VALUES(${id}::uuid,${tenantId}::uuid,${propertyId}::uuid,${roomType}::uuid,${ratePlan}::uuid,${ref},${status}::"BookingStatus",'2027-03-01','2027-03-03',100)`;
    await admin.$executeRaw`INSERT INTO manual_review_items(tenant_id,property_id,category,reference_type,reference_id,message) VALUES(${tenantId}::uuid,${propertyId}::uuid,'UNKNOWN_RESULT'::"ManualReviewCategory",'booking',${needsReview},'technical detail that staff must not see')`;
  });

  afterAll(async () => {
    if (app) await app.close();
    // Remove only this file's generated guest-review fixture. Production requests remain immutable.
    if (tenantId)
      await admin.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
        await tx.$executeRaw`DELETE FROM booking_requests WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND requester_id IS NULL AND details='Guest needs staff review'`;
      });
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id=${userId}::uuid`;
    await admin.$disconnect();
  });

  it('explains a booking that needs review in plain words, without technical detail', async () => {
    const res = await request(app.getHttpServer())
      .get(`${base()}/${needsReview}/review`)
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.needsReview).toBe(true);
    expect(res.body.reasons).toHaveLength(1);
    expect(res.body.reasons[0].text).toContain('did not confirm this booking');
    expect(JSON.stringify(res.body)).not.toContain('technical detail');
    const ok = await request(app.getHttpServer())
      .get(`${base()}/${fine}/review`)
      .set('Cookie', cookie)
      .expect(200);
    expect(ok.body).toMatchObject({ needsReview: false, reasons: [] });
  });

  it('identifies a pending stay amendment instead of offering unknown-booking resolution', async () => {
    const key = 'clock-stay-amend:' + propertyId + ':' + randomUUID();
    await admin.$executeRaw`INSERT INTO integration_operations(tenant_id,property_id,idempotency_key,aggregate_id,request_hash,status,result) VALUES(${tenantId}::uuid,${propertyId}::uuid,${key},${fine}::uuid,'fixture','PENDING','{}'::jsonb)`;
    await admin.$executeRaw`INSERT INTO manual_review_items(tenant_id,property_id,category,reference_type,reference_id,message,context) VALUES(${tenantId}::uuid,${propertyId}::uuid,'SIMULTANEOUS_CHANGE','booking',${fine},'Pending amendment',${JSON.stringify({ operationKey: key })}::jsonb)`;
    try {
      const res = await request(app.getHttpServer())
        .get(`${base()}/${fine}/review`)
        .set('Cookie', cookie)
        .expect(200);
      expect(res.body).toMatchObject({
        needsReview: true,
        pendingChange: 'stay',
        canResolve: false,
      });
      expect(
        res.body.reasons.some((r: { text: string }) =>
          r.text.includes('awaiting confirmation from Clock'),
        ),
      ).toBe(true);
      expect(
        res.body.reasons.some((r: { text: string }) => r.text.includes('changed in two places')),
      ).toBe(false);
    } finally {
      await admin.$executeRaw`DELETE FROM integration_operations WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND idempotency_key=${key}`;
      await admin.$executeRaw`DELETE FROM manual_review_items WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND reference_id=${fine} AND context->>'operationKey'=${key}`;
    }
  });
  it('explains a posted Clock refund document follow-up without calling it a mismatch', async () => {
    const message =
      'Clock refund payment was posted. In Clock, issue the Deposit Adjustment to create the required correction document.';
    await admin.$executeRaw`INSERT INTO manual_review_items(tenant_id,property_id,category,reference_type,reference_id,message,context) VALUES(${tenantId}::uuid,${propertyId}::uuid,'PAYMENT_BOOKING_MISMATCH'::"ManualReviewCategory",'booking',${fine},${message},${JSON.stringify({ message })}::jsonb)`;
    try {
      const res = await request(app.getHttpServer())
        .get(`${base()}/${fine}/review`)
        .set('Cookie', cookie)
        .expect(200);
      expect(res.body.reasons[0].text).toBe(
        'Refund posted to Clock. Complete the Deposit Adjustment document in Clock.',
      );
      expect(res.body.reasons[0].text).not.toContain('do not agree');
    } finally {
      await admin.$executeRaw`DELETE FROM manual_review_items WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND reference_id=${fine}`;
    }
  });

  it('cannot run a provider check at a hotel without an external system, and is scoped', async () => {
    await request(app.getHttpServer())
      .post(`${base()}/${needsReview}/review/check`)
      .set('Cookie', cookie)
      .expect(403);
    await admin.$executeRaw`UPDATE users SET email_verified_at=now() WHERE id=${userId}::uuid`;
    const check = await request(app.getHttpServer())
      .post(`${base()}/${needsReview}/review/check`)
      .set('Cookie', cookie)
      .expect(200);
    expect(check.body.result).toBe('unavailable');
    await request(app.getHttpServer())
      .get(`${base()}/${randomUUID()}/review`)
      .set('Cookie', cookie)
      .expect(404);
    await request(app.getHttpServer()).get(`${base()}/${needsReview}/review`).expect(401);
  });
  it('closes only failed unpaid attempts, keeps history, and resurfaces changed bookings', async () => {
    await admin.$executeRaw`UPDATE users SET email_verified_at=now() WHERE id=${userId}::uuid`;
    await request(app.getHttpServer())
      .post(`${base()}/${needsReview}/review/dismiss`)
      .set('Cookie', cookie)
      .send({ note: 'Reviewed uncertain result' })
      .expect(409);
    await admin.$executeRaw`UPDATE bookings SET status='AVAILABILITY_FAILED',version=version+1 WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${fine}::uuid`;
    const search = () =>
      request(app.getHttpServer())
        .get(`${base()}/search?view=needs_attention`)
        .set('Cookie', cookie)
        .expect(200);
    expect((await search()).body.items.some((b: { id: string }) => b.id === fine)).toBe(true);
    await request(app.getHttpServer())
      .post(`${base()}/${fine}/review/dismiss`)
      .set('Cookie', cookie)
      .send({ note: 'No reservation created; test attempt reviewed' })
      .expect(200);
    expect((await search()).body.items.some((b: { id: string }) => b.id === fine)).toBe(false);
    const row = await admin.$queryRaw<
      Array<{ status: string; count: number }>
    >`SELECT b.status::text AS status,(SELECT COUNT(*)::int FROM audit_logs a WHERE a.tenant_id=b.tenant_id AND a.property_id=b.property_id AND a.target_id=b.id::text AND a.action='booking.attention_dismissed') AS count FROM bookings b WHERE b.tenant_id=${tenantId}::uuid AND b.property_id=${propertyId}::uuid AND b.id=${fine}::uuid`;
    expect(row[0]).toEqual({ status: 'AVAILABILITY_FAILED', count: 1 });
    await admin.$executeRaw`UPDATE bookings SET version=version+1 WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${fine}::uuid`;
    expect((await search()).body.items.some((b: { id: string }) => b.id === fine)).toBe(true);
    await admin.$executeRaw`INSERT INTO payments(tenant_id,property_id,booking_id,kind,provider,external_payment_id,status,amount,currency) VALUES(${tenantId}::uuid,${propertyId}::uuid,${fine}::uuid,'CHARGE','manual',${'review-money-' + fine},'succeeded',10,'EUR')`;
    await request(app.getHttpServer())
      .post(`${base()}/${fine}/review/dismiss`)
      .set('Cookie', cookie)
      .send({ note: 'Money held must remain visible' })
      .expect(409);
  });
  it('resolves an old absent Clock attempt once, rejects money held and stale checks', async () => {
    const { ClockBookingService } = await import('../src/integrations/clock/clock-booking.service');
    const { IntegrationConnectionsService } =
      await import('../src/integrations/integration-connections.service');
    const id = randomUUID();
    await admin.$executeRaw`UPDATE users SET email_verified_at=now() WHERE id=${userId}::uuid`;
    await admin.$executeRaw`INSERT INTO bookings(id,tenant_id,property_id,room_type_id,rate_plan_id,external_reference,status,starts_on,ends_on,total_amount,created_at) VALUES(${id}::uuid,${tenantId}::uuid,${propertyId}::uuid,${roomType}::uuid,${ratePlan}::uuid,'ABSENCE-VERIFY','PMS_UNKNOWN_RESULT','2027-03-01','2027-03-03',100,now()-interval '1 hour')`;
    const reviewConnection = randomUUID();
    await admin.$executeRaw`INSERT INTO integration_connections(id,tenant_id,kind,provider,name,encrypted_credentials,status) VALUES(${reviewConnection}::uuid,${tenantId}::uuid,'PMS','CLOCK_PMS','Review fixture','never-decrypted-test','CONNECTED')`;
    await admin.$executeRaw`INSERT INTO property_integration_connections(tenant_id,property_id,connection_id,kind) VALUES(${tenantId}::uuid,${propertyId}::uuid,${reviewConnection}::uuid,'PMS')`;
    const remote = vi
      .spyOn(app.get(ClockBookingService), 'checkRemoteBooking')
      .mockResolvedValue({ result: 'not_found' });
    vi.spyOn(
      app.get(IntegrationConnectionsService),
      'activePmsConnectionCredentials',
    ).mockResolvedValue({ provider: 'CLOCK_PMS', connectionId: reviewConnection } as never);
    const resolve = () =>
      request(app.getHttpServer())
        .post(`${base()}/${id}/review/resolve`)
        .set('Cookie', cookie)
        .send({
          action: 'not_created',
          note: 'Verified exact reference absent; no money or checkout.',
        });
    try {
      remote.mockResolvedValueOnce({ result: 'unavailable', message: 'Clock busy' });
      expect((await resolve()).status).toBe(409);
      remote.mockImplementationOnce(async () => {
        await admin.$executeRaw`UPDATE bookings SET version=version+1 WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${id}::uuid`;
        return { result: 'not_found' };
      });
      expect((await resolve()).status).toBe(409);
      await admin.$executeRaw`INSERT INTO payments(tenant_id,property_id,booking_id,kind,provider,external_payment_id,status,amount,currency) VALUES(${tenantId}::uuid,${propertyId}::uuid,${id}::uuid,'CHARGE','manual',${'held-' + id},'succeeded',10,'EUR')`;
      expect((await resolve()).status).toBe(409);
      // Remove only this isolated test fixture to exercise the no-money resolution branch.
      await admin.$executeRaw`DELETE FROM payments WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND booking_id=${id}::uuid`;
      expect((await resolve()).status).toBe(200);
      expect((await resolve()).status).toBe(409);
      const booking = await admin.$queryRaw<
        Array<{ status: string }>
      >`SELECT status::text AS status FROM bookings WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${id}::uuid`;
      expect(booking[0].status).toBe('PMS_REJECTED');
      const queue = await request(app.getHttpServer())
        .get(`${base()}/search?view=needs_attention`)
        .set('Cookie', cookie)
        .expect(200);
      expect(queue.body.items.some((b: { id: string }) => b.id === id)).toBe(false);
      const detail = await request(app.getHttpServer())
        .get(`${base()}/${id}/review`)
        .set('Cookie', cookie)
        .expect(200);
      expect(detail.body.needsReview).toBe(false);
    } finally {
      await admin.$executeRaw`DELETE FROM property_integration_connections WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND connection_id=${reviewConnection}::uuid`;
      vi.restoreAllMocks();
    }
  });
  it('checks active physical rooms against the real room schema before provider pricing', async () => {
    const active = randomUUID(),
      inactive = randomUUID();
    await admin.$executeRaw`INSERT INTO rooms(id,tenant_id,property_id,room_type_id,name,is_active) VALUES(${active}::uuid,${tenantId}::uuid,${propertyId}::uuid,${roomType}::uuid,'Search active',true),(${inactive}::uuid,${tenantId}::uuid,${propertyId}::uuid,${roomType}::uuid,'Search inactive',false)`;
    const { StaffAvailabilityService } = await import('../src/booking/staff-availability.service');
    const { IntegrationConnectionsService } =
      await import('../src/integrations/integration-connections.service');
    const { ClockAvailabilityService } =
      await import('../src/integrations/clock/clock-availability.service');
    vi.spyOn(
      app.get(IntegrationConnectionsService),
      'activePmsConnectionCredentials',
    ).mockResolvedValue({ provider: 'CLOCK_PMS' } as never);
    const price = vi
      .spyOn(app.get(ClockAvailabilityService), 'getQuotesForStay')
      .mockResolvedValue({
        [roomType]: { ok: true, value: { amount: '100.00', currency: 'EUR' } },
      });
    vi.spyOn(app.get(ClockAvailabilityService), 'unavailableRoomsForBooking').mockResolvedValue({
      ok: true,
      value: [],
    });
    try {
      const result = await app.get(StaffAvailabilityService).search(
        { tenantId, propertyId },
        {
          startsOn: STAY_STARTS_ON,
          endsOn: STAY_ENDS_ON,
          adults: 1,
          children: 0,
          items: [
            { key: 'active', roomTypeId: roomType, roomId: active },
            { key: 'inactive', roomTypeId: roomType, roomId: inactive },
          ],
        },
      );
      expect(result.offers.active).toMatchObject({ ok: true });
      expect(result.offers.inactive.ok).toBe(false);
      expect(price.mock.calls[0][2]).toHaveLength(1);
      expect(price.mock.calls[0][2][0].roomTypeId).toBe(roomType);
    } finally {
      vi.restoreAllMocks();
    }
  });
  it('keeps Clock guest profiles without email and enforces property RLS', async () => {
    const connection = randomUUID();
    await admin.$executeRaw`INSERT INTO integration_connections(id,tenant_id,kind,provider,name,encrypted_credentials,status) VALUES(${connection}::uuid,${tenantId}::uuid,'PMS','CLOCK_PMS','Projection fixture','never-decrypted-test','CONNECTED')`;
    await admin.$executeRaw`INSERT INTO property_integration_connections(tenant_id,property_id,connection_id,kind) VALUES(${tenantId}::uuid,${propertyId}::uuid,${connection}::uuid,'PMS')`;
    await admin.$executeRaw`INSERT INTO clock_guest_profiles(tenant_id,property_id,connection_id,external_guest_id,first_name) VALUES(${tenantId}::uuid,${propertyId}::uuid,${connection}::uuid,'123','No Email Guest')`;
    const profiles = await request(app.getHttpServer())
      .get(`/tenants/${tenantId}/properties/${propertyId}/clock-guests`)
      .set('Cookie', cookie)
      .expect(200);
    expect(profiles.body).toHaveLength(1);
    expect(profiles.body[0]).toMatchObject({ firstName: 'No Email Guest', email: null });
    const directory = await request(app.getHttpServer())
      .get(`/tenants/${tenantId}/properties/${propertyId}/guests`)
      .set('Cookie', cookie)
      .expect(200);
    expect(directory.body).toContainEqual(
      expect.objectContaining({ firstName: 'No Email Guest', source: 'CLOCK', email: '' }),
    );
    const { TenantDatabaseService } = await import('../src/tenancy/tenant-database.service');
    const hidden = await app
      .get(TenantDatabaseService)
      .withTenantTransaction(
        { tenantId, propertyId: randomUUID() },
        (tx) => tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM clock_guest_profiles`,
      );
    expect(hidden).toEqual([]);
  });
  it('serves stored Clock snapshots without a provider read and fences expired worker leases', async () => {
    const { ClockBackgroundSyncService } =
      await import('../src/integrations/clock/clock-background-sync.service');
    const { TenantDatabaseService } = await import('../src/tenancy/tenant-database.service');
    const sync = app.get(ClockBackgroundSyncService);
    const db = app.get(TenantDatabaseService);
    const connections = await admin.$queryRaw<
      Array<{ connectionId: string }>
    >`SELECT connection_id AS "connectionId" FROM property_integration_connections WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND enabled AND kind='PMS'`;
    const scope = { tenantId, propertyId, connectionId: connections[0].connectionId };
    await sync.ensure(scope, ['rooms']);
    const sample = { source: 'CLOCK_PMS', roomTypes: [{ roomTypeId: roomType, totalRooms: 23 }] };
    await admin.$executeRaw`UPDATE clock_sync_jobs SET snapshot=${JSON.stringify(sample)}::jsonb,last_success_at=now() WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND resource='rooms'`;
    const response = await request(app.getHttpServer())
      .get(`/tenants/${tenantId}/properties/${propertyId}/clock-sync/rooms`)
      .set('Cookie', cookie)
      .expect(200);
    expect(response.body.data).toEqual(sample);
    const hidden = await db.withTenantTransaction(
      { tenantId, propertyId: randomUUID() },
      (tx) => tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM clock_sync_jobs`,
    );
    expect(hidden).toEqual([]);
    // A restarted instance resumes the same checkpoint; the old instance cannot save after losing its lease.
    type Lease = {
      id: string;
      resource: string;
      progress: Record<string, unknown>;
      snapshot: unknown;
      processed: number;
      leaseToken: string;
    };
    const worker = sync as unknown as {
      claim(s: typeof scope): Promise<Lease>;
      save(
        s: typeof scope,
        j: Lease,
        p: Record<string, unknown>,
        complete: boolean,
        snapshot: unknown,
      ): Promise<void>;
    };
    const first = await worker.claim(scope);
    expect(first.resource).toBe('rooms');
    expect(await worker.claim(scope)).toBeNull();
    await admin.$executeRaw`UPDATE clock_sync_jobs SET lease_until=now()-interval '1 second',progress='{"index":5}'::jsonb WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${first.id}::uuid`;
    const resumed = await worker.claim(scope);
    expect(resumed.progress).toEqual({ index: 5 });
    expect(resumed.leaseToken).not.toBe(first.leaseToken);
    await worker.save(scope, first, {}, true, { wrong: true });
    expect((await sync.read(tenantId, propertyId, 'rooms')).data).toEqual(sample);
    await admin.$executeRaw`UPDATE clock_sync_jobs SET requested_at=now() WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${resumed.id}::uuid`;
    await worker.save(scope, resumed, {}, true, { recovered: true });
    const wake = await admin.$queryRaw<
      Array<{ due: boolean }>
    >`SELECT next_run_at<=now() AS due FROM clock_sync_jobs WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${resumed.id}::uuid`;
    expect(wake[0].due).toBe(true);
    expect((await sync.read(tenantId, propertyId, 'rooms')).data).toEqual({ recovered: true });
    await admin.$executeRaw`UPDATE property_integration_connections SET enabled=false WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND connection_id=${scope.connectionId}::uuid`;
    expect((await sync.read(tenantId, propertyId, 'rooms')).data).toBeNull();
  });

  it('persists validated server images across instances and rejects forged or cross-property uploads', async () => {
    const { ServerStorageProvider } = await import('../src/storage/server-storage.provider');
    const { TenantDatabaseService } = await import('../src/tenancy/tenant-database.service');
    const { R2StorageProvider } = await import('../src/storage/r2-storage.provider');
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const sharp = (await import('sharp')).default;
    const root = await mkdtemp(join(tmpdir(), 'must-media-test-'));
    const oldRoot = process.env.MEDIA_ROOT,
      oldBase = process.env.MEDIA_PUBLIC_BASE_URL;
    process.env.MEDIA_ROOT = root;
    process.env.MEDIA_PUBLIC_BASE_URL = 'http://localhost:3000/media';
    const provider = app.get(ServerStorageProvider);
    const scope = { tenantId, propertyId };
    try {
      const image = await sharp({
        create: { width: 2, height: 2, channels: 3, background: 'white' },
      })
        .png()
        .toBuffer();
      const key = provider.newObjectKey(`library/${tenantId}/${propertyId}/${randomUUID()}.png`);
      const intent = await provider.createPresignedUpload({
        key,
        contentType: 'image/png',
        contentLength: image.length,
      });
      const token = intent.uploadUrl.split('/').at(-1)!;
      async function* stream(bytes: Buffer) {
        yield bytes;
      }
      await expect(
        provider.upload({ ...scope, propertyId: randomUUID() }, token, 'image/png', stream(image)),
      ).rejects.toThrow();
      await expect(
        provider.upload(scope, token, 'image/png', stream(Buffer.alloc(image.length))),
      ).rejects.toThrow('could not be decoded');
      await provider.upload(scope, token, 'image/png', stream(image));
      await expect(provider.upload(scope, token, 'image/png', stream(image))).rejects.toThrow(
        'already completed',
      );
      const restarted = new ServerStorageProvider(
        app.get(TenantDatabaseService),
        app.get(R2StorageProvider),
      );
      expect((await restarted.image(key)).contentType).toBe('image/png');
      expect((await restarted.image(key)).data.length).toBeGreaterThan(0);
      await admin.$executeRaw`INSERT INTO property_library_images(tenant_id,property_id,object_key,original_name,confirmed_at) VALUES(${tenantId}::uuid,${propertyId}::uuid,${key},'Logo fixture',now())`;
      const { PropertiesService } = await import('../src/tenancy/properties.service');
      const logo = provider.publicUrl(key);
      expect(
        (await app.get(PropertiesService).update(tenantId, propertyId, userId, { logoUrl: logo }))
          .logoUrl,
      ).toBe(logo);
      const forged = provider.publicUrl(key.replace(propertyId, randomUUID()));
      await expect(
        app.get(PropertiesService).update(tenantId, propertyId, userId, { logoUrl: forged }),
      ).rejects.toThrow('this hotel');

      await expect(restarted.image('server-v1/../../secret.png')).rejects.toThrow('Invalid media');
      await expect(
        provider.createPresignedUpload({ key, contentType: 'image/svg+xml', contentLength: 100 }),
      ).rejects.toThrow('JPEG');
      const hidden = await app
        .get(TenantDatabaseService)
        .withTenantTransaction(
          { tenantId, propertyId: randomUUID() },
          (tx) => tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM server_media_uploads`,
        );
      expect(hidden).toEqual([]);
    } finally {
      if (oldRoot === undefined) delete process.env.MEDIA_ROOT;
      else process.env.MEDIA_ROOT = oldRoot;
      if (oldBase === undefined) delete process.env.MEDIA_PUBLIC_BASE_URL;
      else process.env.MEDIA_PUBLIC_BASE_URL = oldBase;
      // Only the freshly created test directory is removed.
      if (root.startsWith(join(tmpdir(), 'must-media-test-')))
        await rm(root, { recursive: true, force: true });
    }
  });
  it('serves verified Clock money from a scoped snapshot and refuses an outbound-read race', async () => {
    const { ClockFinancialService } =
      await import('../src/integrations/clock/clock-financial.service');
    const { ClockBookingConsistencyService } =
      await import('../src/integrations/clock/clock-booking-consistency.service');
    const financial = app.get(ClockFinancialService);
    const { IntegrationConnectionsService } =
      await import('../src/integrations/integration-connections.service');
    const binding = { id: randomUUID() };
    await admin.$executeRaw`INSERT INTO integration_connections(id,tenant_id,kind,provider,name,encrypted_credentials,status) VALUES(${binding.id}::uuid,${tenantId}::uuid,'PMS','CLOCK_PMS','Financial fixture','never-decrypted','CONNECTED')`;
    await admin.$executeRaw`INSERT INTO property_integration_connections(tenant_id,property_id,connection_id,kind) VALUES(${tenantId}::uuid,${propertyId}::uuid,${binding.id}::uuid,'PMS')`;
    vi.spyOn(
      app.get(IntegrationConnectionsService),
      'activePmsConnectionCredentials',
    ).mockResolvedValue({
      connectionId: binding.id,
      provider: 'CLOCK_PMS',
      credentials: {
        host: 'sandbox.example.test',
        accountId: '1',
        subscriptionId: '2',
        apiUser: 'test',
        apiKey: 'not-a-real-key',
      },
    });

    await admin.$executeRaw`UPDATE bookings SET external_booking_id='98700001' WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${fine}::uuid`;
    const raw = {
      booking: { balance: { cents: 10000, currency: 'EUR' } },
      folios: [
        {
          detail: {
            id: 22,
            value: { cents: 10000, currency: 'EUR' },
            balance: { cents: 10000, currency: 'EUR' },
          },
          credits: [],
        },
      ],
    };
    const read = vi
      .spyOn(app.get(ClockBookingConsistencyService), 'financialData')
      .mockResolvedValue(raw);
    try {
      const snapshot = await financial.refresh({ tenantId, propertyId }, fine);
      expect(snapshot?.balance.amount).toBe('100.00');
      read.mockClear();
      const response = await request(app.getHttpServer())
        .get(`/tenants/${tenantId}/properties/${propertyId}/clock-sync/financial/${fine}`)
        .set('Cookie', cookie)
        .expect(200);
      expect(response.body.data.balance).toEqual({ amount: '100.00', currency: 'EUR' });
      expect(read).not.toHaveBeenCalled();
      read.mockImplementationOnce(async () => {
        await admin.$executeRaw`UPDATE bookings SET version=version+1 WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${fine}::uuid`;
        return raw;
      });
      await expect(financial.refresh({ tenantId, propertyId }, fine)).rejects.toThrow('changed');
      expect((await financial.read({ tenantId, propertyId }, fine)).data?.fetchedAt).toBe(
        snapshot?.fetchedAt,
      );
    } finally {
      vi.restoreAllMocks();
    }
  });
  it('checks the real financial guard before a direct guest Clock cancellation', async () => {
    const id = randomUUID(),
      session = randomUUID(),
      guest = randomUUID();
    await admin.$executeRaw`INSERT INTO guests(id,tenant_id,email) VALUES(${guest}::uuid,${tenantId}::uuid,${guest + '@example.test'})`;
    await admin.$executeRaw`INSERT INTO bookings(id,tenant_id,property_id,room_type_id,rate_plan_id,guest_id,guest_session_id,external_reference,status,source,starts_on,ends_on,total_amount) VALUES(${id}::uuid,${tenantId}::uuid,${propertyId}::uuid,${roomType}::uuid,${ratePlan}::uuid,${guest}::uuid,${session}::uuid,${'GUEST-GUARD-' + id},'CONFIRMED','WEBSITE','2030-07-10','2030-07-12',100)`;
    const { LocalPmsProvider } = await import('../src/booking/local-pms.provider');
    const provider = app.get(LocalPmsProvider);
    const connection = vi
      .spyOn(
        provider as unknown as { isClockConnected: () => Promise<boolean> },
        'isClockConnected',
      )
      .mockResolvedValue(true);
    try {
      const result = await provider.cancelBooking(
        { tenantId, propertyId },
        {
          bookingId: id,
          guestSessionId: session,
          expectedVersion: 1,
          idempotencyKey: randomUUID(),
          reason: 'Guest cancellation',
        },
      );
      expect(result).toMatchObject({ ok: false, error: { code: 'CANCELLATION_REQUIRES_REVIEW' } });
      const stored = await admin.$queryRaw<
        Array<{ status: string }>
      >`SELECT status::text FROM bookings WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${id}::uuid`;
      expect(stored[0].status).toBe('CONFIRMED');
    } finally {
      connection.mockRestore();
    }
  });

  it('serves signed guest management anonymously and queues a review request without cancelling', async () => {
    const id = randomUUID(),
      session = randomUUID();
    await admin.$executeRaw`INSERT INTO bookings(id,tenant_id,property_id,room_type_id,rate_plan_id,guest_session_id,external_reference,status,source,starts_on,ends_on,total_amount) VALUES(${id}::uuid,${tenantId}::uuid,${propertyId}::uuid,${roomType}::uuid,${ratePlan}::uuid,${session}::uuid,'GUEST-MANAGE-HTTP','CONFIRMED','WEBSITE','2030-07-10','2030-07-12',100)`;
    const { CancellationLinkService } = await import('../src/booking/cancellation-link.service');
    const token = app
      .get(CancellationLinkService)
      .create({ tenantId, propertyId, bookingId: id, guestSessionId: session });
    const path = `${base()}/${id}/manage`;
    const before = await request(app.getHttpServer()).get(path).query({ token }).expect(200);
    expect(before.headers['cache-control']).toBe('private, no-store');
    expect(before.headers['referrer-policy']).toBe('no-referrer');
    expect(before.body).toMatchObject({
      reference: 'GUEST-MANAGE-HTTP',
      status: 'CONFIRMED',
      policyKnown: true,
    });
    await request(app.getHttpServer())
      .get(path)
      .query({ token: token + 'tampered' })
      .expect(400);
    const send = () =>
      request(app.getHttpServer())
        .post(path)
        .set('Idempotency-Key', 'guest-request-' + id)
        .send({
          token,
          version: before.body.version,
          action: 'request',
          details: 'Guest needs staff review',
          requestRefund: true,
        });
    const first = await send().expect(201);
    const second = await send().expect(201);
    expect(first.body.requestId).toBe(second.body.requestId);
    const stored = await admin.$queryRaw<
      Array<{ status: string; requester: string | null }>
    >`SELECT b.status::text,q.requester_id AS requester FROM bookings b JOIN booking_requests q ON q.tenant_id=b.tenant_id AND q.property_id=b.property_id AND q.booking_id=b.id WHERE b.tenant_id=${tenantId}::uuid AND b.property_id=${propertyId}::uuid AND b.id=${id}::uuid`;
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ status: 'CONFIRMED', requester: null });
  });
});
