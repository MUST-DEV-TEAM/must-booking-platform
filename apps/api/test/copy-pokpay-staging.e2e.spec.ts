import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CredentialCipherService } from '../src/integrations/credential-cipher';
import { copyPokpayStaging, verifyStaging } from '../src/operations/copy-pokpay-staging';
import { AuditLogService } from '../src/tenancy/audit-log.service';
import { TenantDatabaseService } from '../src/tenancy/tenant-database.service';
import { cleanupTenant } from './helpers/cleanup-tenant';

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});
const database = new TenantDatabaseService({
  datasources: {
    db: {
      url: 'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking?schema=public',
    },
  },
});
const cipher = new CredentialCipherService();
const staging = {
  keyId: 'fixture-key',
  keySecret: 'fixture-secret',
  merchantId: 'fixture-merchant',
  baseUrl: 'https://api-staging.pokpay.io',
  webhookUrl: 'https://booking.must.al/api/webhooks/pokpay',
};
let source: { tenantId: string; propertyId: string };
let destination: typeof source;
let sourceId: string;
let liveId: string;
let originalKey: string | undefined;
const verify = vi.fn(async () => undefined);

async function account(scope: typeof source, keys: Record<string, string>, enabled: boolean) {
  const id = randomUUID();
  await admin.$executeRaw`INSERT INTO integration_connections(id,tenant_id,kind,provider,name,encrypted_credentials,status)
    VALUES(${id}::uuid,${scope.tenantId}::uuid,'PAYMENT','POKPAY',${id},${cipher.encrypt(keys)},'CONNECTED')`;
  await admin.$executeRaw`INSERT INTO property_integration_connections(tenant_id,property_id,connection_id,kind,enabled)
    VALUES(${scope.tenantId}::uuid,${scope.propertyId}::uuid,${id}::uuid,'PAYMENT',${enabled})`;
  return id;
}
async function targetRows() {
  return admin.$queryRaw<Array<{ id: string; encrypted: string; enabled: boolean }>>`
    SELECT c.id,c.encrypted_credentials AS encrypted,pc.enabled FROM integration_connections c
    JOIN property_integration_connections pc ON pc.tenant_id=c.tenant_id AND pc.connection_id=c.id
    WHERE c.tenant_id=${destination.tenantId}::uuid AND pc.property_id=${destination.propertyId}::uuid`;
}

describe('server-side staging copy', () => {
  beforeAll(() => {
    originalKey = process.env.INTEGRATION_CREDENTIALS_KEY;
    process.env.INTEGRATION_CREDENTIALS_KEY = Buffer.alloc(32, 9).toString('base64');
  });
  beforeEach(async () => {
    verify.mockClear();
    source = { tenantId: randomUUID(), propertyId: randomUUID() };
    destination = { tenantId: randomUUID(), propertyId: randomUUID() };
    for (const scope of [source, destination]) {
      await admin.$executeRaw`INSERT INTO organizations(id,name) VALUES(${scope.tenantId}::uuid,'Staging copy fixture')`;
      await admin.$executeRaw`INSERT INTO properties(id,tenant_id,name,slug)
        VALUES(${scope.propertyId}::uuid,${scope.tenantId}::uuid,'Staging copy fixture',${scope.propertyId})`;
    }
    sourceId = await account(source, staging, true);
    liveId = await account(
      destination,
      { ...staging, keySecret: 'live-fixture-secret', baseUrl: 'https://api.pokpay.io' },
      true,
    );
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    for (const scope of [source, destination]) await cleanupTenant(admin, scope.tenantId);
  });
  afterAll(async () => {
    if (originalKey === undefined) delete process.env.INTEGRATION_CREDENTIALS_KEY;
    else process.env.INTEGRATION_CREDENTIALS_KEY = originalKey;
    await Promise.all([admin.$disconnect(), database.$disconnect()]);
  });

  it('copies encrypted keys, keeps live selected, audits without secrets, and reuses on rerun', async () => {
    const before = await targetRows();
    const first = await copyPokpayStaging(database, source, destination, verify);
    const second = await copyPokpayStaging(database, source, destination, verify);
    expect(first).toMatchObject({ created: true, enabled: false, mode: 'TEST' });
    expect(second).toEqual({ ...first, created: false });
    const rows = await targetRows();
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === liveId)).toEqual(before[0]);
    const copied = rows.find((row) => row.id === first.connectionId)!;
    expect(copied.enabled).toBe(false);
    expect(cipher.decrypt(copied.encrypted)).toEqual(staging);
    const original = await admin.integrationConnection.findUniqueOrThrow({
      where: { id: sourceId },
    });
    expect(copied.encrypted).not.toBe(original.encryptedCredentials);
    expect(verify).toHaveBeenCalledWith(staging);
    const logs = await admin.auditLog.findMany({ where: { tenantId: destination.tenantId } });
    expect(logs).toHaveLength(2);
    expect(logs[0]?.propertyId).toBe(destination.propertyId);
    expect(JSON.stringify(logs)).not.toContain(staging.keySecret);
    expect(JSON.stringify(first)).not.toContain(staging.keyId);
  });

  it('refuses a live source before authentication or writing', async () => {
    await admin.$executeRaw`UPDATE integration_connections
      SET encrypted_credentials=${cipher.encrypt({ ...staging, baseUrl: 'https://api.pokpay.io' })}
      WHERE tenant_id=${source.tenantId}::uuid AND id=${sourceId}::uuid`;
    await expect(copyPokpayStaging(database, source, destination, verify)).rejects.toThrow(
      'staging',
    );
    expect(verify).not.toHaveBeenCalled();
    expect(await targetRows()).toHaveLength(1);
  });

  it('does not overwrite a different staging account', async () => {
    await account(destination, { ...staging, keySecret: 'another-fixture-secret' }, false);
    const before = await targetRows();
    await expect(copyPokpayStaging(database, source, destination, verify)).rejects.toThrow(
      'different staging',
    );
    expect(await targetRows()).toEqual(before);
  });

  it('stops before writes when staging authentication fails', async () => {
    await expect(
      copyPokpayStaging(database, source, destination, async () => {
        throw new Error('Authentication failed');
      }),
    ).rejects.toThrow('Authentication failed');
    expect(await targetRows()).toHaveLength(1);
  });

  it('rolls back the copy when the audit cannot be stored', async () => {
    vi.spyOn(AuditLogService.prototype, 'recordInTransaction').mockRejectedValue(
      new Error('Audit failed'),
    );
    await expect(copyPokpayStaging(database, source, destination, verify)).rejects.toThrow(
      'Audit failed',
    );
    expect(await targetRows()).toHaveLength(1);
  });

  it('serializes concurrent copies and creates one inactive account', async () => {
    const results = await Promise.all([
      copyPokpayStaging(database, source, destination, verify),
      copyPokpayStaging(database, source, destination, verify),
    ]);
    expect(new Set(results.map((result) => result.connectionId)).size).toBe(1);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(await targetRows()).toHaveLength(2);
  });

  it('rejects a privileged database connection', async () => {
    await expect(
      copyPokpayStaging(admin as TenantDatabaseService, source, destination, verify),
    ).rejects.toThrow('runtime database role');
    expect(verify).not.toHaveBeenCalled();
  });

  it('authenticates only against staging and never creates an order', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: { accessToken: 'fixture-token' } })));
    vi.stubGlobal('fetch', fetchMock);
    await verifyStaging(staging);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api-staging.pokpay.io/auth/sdk/login');
    await expect(verifyStaging({ ...staging, baseUrl: 'https://api.pokpay.io' })).rejects.toThrow(
      'staging',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
