import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DataRetentionService, RECEIPT_TABLES } from '../src/tenancy/data-retention.service';
import { TenantDatabaseService } from '../src/tenancy/tenant-database.service';
import { cleanupTenant } from './helpers/cleanup-tenant';

/**
 * Milestone 38 task 8, first release: the retention job only counts. Real Postgres, real application role
 * (row-level security on), so the counts are exactly what the later delete would see in one hotel.
 */
const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});
const db = new TenantDatabaseService();
const service = new DataRetentionService(db);

const tenantId = randomUUID();
const propertyId = randomUUID();
const otherPropertyId = randomUUID();
const connectionId = randomUUID();

async function event(
  property: string,
  status: string,
  ageDays: number,
  payload: Record<string, unknown> = { booking: 1 },
) {
  await admin.$executeRaw`INSERT INTO provider_events(tenant_id,property_id,connection_id,provider,event_id,event_type,payload_hash,raw_payload,status,created_at)
    VALUES(${tenantId}::uuid,${property}::uuid,${connectionId}::uuid,'CLOCK_PMS',${randomUUID()},'booking.updated','hash',${JSON.stringify(payload)}::jsonb,${status}::"ProviderEventStatus",now()-make_interval(days=>${ageDays}::int))`;
}
async function receipt(table: string, property: string, ageDays: number) {
  await admin.$executeRawUnsafe(
    `INSERT INTO ${table}(tenant_id,property_id,idempotency_key,request_hash,response,created_at) VALUES($1::uuid,$2::uuid,$3,$4,'{}'::jsonb,now()-make_interval(days=>$5::int))`,
    tenantId,
    property,
    randomUUID(),
    'a'.repeat(64),
    ageDays,
  );
}

describe('data retention, dry run', () => {
  beforeAll(async () => {
    await admin.$executeRaw`INSERT INTO organizations(id,name) VALUES(${tenantId}::uuid,'Retention test')`;
    await admin.$executeRaw`INSERT INTO properties(id,tenant_id,name,slug) VALUES(${propertyId}::uuid,${tenantId}::uuid,'Retention hotel',${'retention-' + propertyId}),(${otherPropertyId}::uuid,${tenantId}::uuid,'Other hotel',${'retention-' + otherPropertyId})`;
    await admin.$executeRaw`INSERT INTO integration_connections(id,tenant_id,kind,provider,name,encrypted_credentials) VALUES(${connectionId}::uuid,${tenantId}::uuid,'PMS','CLOCK_PMS','Retention fixture','never-decrypted')`;
    await event(propertyId, 'HYDRATED', 120); // counted
    await event(propertyId, 'IGNORED', 91); // counted
    await event(propertyId, 'HYDRATED', 89); // too young
    await event(propertyId, 'RECEIVED', 200); // not finished: kept whole
    await event(propertyId, 'FAILED', 200); // needs a person: kept whole
    await event(propertyId, 'HYDRATED', 200, {}); // already scrubbed
    await event(otherPropertyId, 'HYDRATED', 200); // another hotel
    await receipt('pricing_operations', propertyId, 31); // counted
    await receipt('pricing_operations', propertyId, 29); // too young
    await receipt('report_view_operations', propertyId, 45); // counted
    await receipt('pricing_operations', otherPropertyId, 60); // another hotel
  });
  afterAll(async () => {
    await cleanupTenant(admin, tenantId);
    await admin.$executeRaw`DELETE FROM integration_connections WHERE tenant_id=${tenantId}::uuid`;
    await admin.$executeRaw`DELETE FROM organizations WHERE id=${tenantId}::uuid`;
    await admin.$disconnect();
    await db.$disconnect();
  });

  it('counts only finished webhook payloads older than 90 days and receipts older than 30, per hotel', async () => {
    const counts = await service.count({ tenantId, propertyId });
    const by = Object.fromEntries(counts.map((c) => [c.rule, c.matching]));
    expect(by['provider_events.raw_payload after 90 days']).toBe(2);
    expect(by['pricing_operations after 30 days']).toBe(1);
    expect(by['report_view_operations after 30 days']).toBe(1);
    expect(counts).toHaveLength(1 + RECEIPT_TABLES.length);
    expect(counts.filter((c) => c.action === 'delete').map((c) => c.rule)).not.toContain(
      'integration_operations after 30 days',
    );
    const other = await service.count({ tenantId, propertyId: otherPropertyId });
    expect(other.find((c) => c.rule.startsWith('provider_events'))?.matching).toBe(1);
  });

  it('changes no data', async () => {
    await service.count({ tenantId, propertyId });
    const [left] = await admin.$queryRaw<
      Array<{ events: number; payloads: number; receipts: number }>
    >`
      SELECT (SELECT count(*)::int FROM provider_events WHERE tenant_id=${tenantId}::uuid) AS events,
             (SELECT count(*)::int FROM provider_events WHERE tenant_id=${tenantId}::uuid AND raw_payload <> '{}'::jsonb) AS payloads,
             (SELECT count(*)::int FROM pricing_operations WHERE tenant_id=${tenantId}::uuid)
               + (SELECT count(*)::int FROM report_view_operations WHERE tenant_id=${tenantId}::uuid) AS receipts`;
    expect(left).toEqual({ events: 7, payloads: 6, receipts: 4 });
  });
});
