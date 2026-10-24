import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TenantDatabaseService } from '../src/tenancy/tenant-database.service';
const schema = 'audit_guard_' + randomUUID().replaceAll('-', '');
const admin = new PrismaClient({
  datasources: {
    db: { url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking' },
  },
});
const app = new TenantDatabaseService({
  datasources: {
    db: {
      url:
        'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking?schema=' +
        schema,
    },
  },
});
const scope = { tenantId: randomUUID(), propertyId: randomUUID() },
  id = randomUUID();
beforeAll(async () => {
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  await admin.$executeRawUnsafe(
    `CREATE TABLE "${schema}".audit_logs(id uuid PRIMARY KEY,tenant_id uuid,property_id uuid,details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now())`,
  );
  await admin.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "${schema}" TO must_booking_app`);
  await admin.$executeRawUnsafe(
    `GRANT SELECT,INSERT,UPDATE,DELETE ON "${schema}".audit_logs TO must_booking_app`,
  );
  await admin.$executeRawUnsafe(`ALTER TABLE "${schema}".audit_logs ENABLE ROW LEVEL SECURITY`);
  await admin.$executeRawUnsafe(`ALTER TABLE "${schema}".audit_logs FORCE ROW LEVEL SECURITY`);
  await admin.$executeRawUnsafe(
    `CREATE POLICY scoped ON "${schema}".audit_logs USING(tenant_id=public.app_current_tenant_id() AND property_id=public.app_current_property_id()) WITH CHECK(tenant_id=public.app_current_tenant_id() AND property_id=public.app_current_property_id())`,
  );
  const sql = await readFile(
    'prisma/migrations/20261024010000_audit_append_only/migration.sql',
    'utf8',
  );
  for (let replay = 0; replay < 2; replay++)
    await admin.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}",public`);
      for (const statement of sql.split(';').filter((s) => s.trim()))
        await tx.$executeRawUnsafe(statement);
    });
});
afterAll(async () => {
  await app.$disconnect();
  if (!/^audit_guard_[a-f0-9]{32}$/.test(schema)) throw Error('Unsafe test schema');
  await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.$disconnect();
});
describe('application append-only audit policies', () => {
  it('permits scoped inserts and reads but prevents updates and deletes after two migration replays', async () => {
    await app.withTenantTransaction(
      scope,
      (tx) =>
        tx.$executeRaw`INSERT INTO audit_logs(id,tenant_id,property_id,details) VALUES(${id}::uuid,${scope.tenantId}::uuid,${scope.propertyId}::uuid,'{"result":"completed"}'::jsonb)`,
    );
    await app.withTenantTransaction(scope, async (tx) => {
      expect(
        await tx.$executeRaw`UPDATE audit_logs SET details='{}' WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND id=${id}::uuid`,
      ).toBe(0);
      expect(
        await tx.$executeRaw`DELETE FROM audit_logs WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND id=${id}::uuid`,
      ).toBe(0);
      expect(
        await tx.$queryRaw`SELECT details FROM audit_logs WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND id=${id}::uuid`,
      ).toEqual([{ details: { result: 'completed' } }]);
    });
    expect(
      await app.withTenantTransaction(
        { ...scope, propertyId: randomUUID() },
        (tx) => tx.$queryRaw`SELECT id FROM audit_logs`,
      ),
    ).toEqual([]);
    expect(
      await app.withTenantTransaction(
        { ...scope, tenantId: randomUUID() },
        (tx) => tx.$queryRaw`SELECT id FROM audit_logs`,
      ),
    ).toEqual([]);
  });
});
