import 'reflect-metadata';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { copyPokpayStaging } from './copy-pokpay-staging';

// Deliberately fixed source and destination. This is not a general cross-tenant credential API.
const source = {
  tenantId: 'fdb9f701-510e-4deb-857b-08a87fcdfbcc',
  propertyId: '9231b946-f244-4a84-af54-0774710f3464',
};
const database = new TenantDatabaseService();
async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--apply')
    throw new Error('Run only through the approved copy-empire-pokpay-staging Ops action.');
  const tenants = await database.withPlatformAdminTransaction(
    { role: 'platform_admin' },
    (tx) =>
      tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM organizations WHERE lower(trim(name))='empire beach resort'`,
  );
  if (tenants.length !== 1)
    throw new Error('Empire Beach Resort must resolve to exactly one tenant.');
  const tenantId = tenants[0]!.id;
  const properties = await database.withTenantTransaction(
    { tenantId },
    (tx) =>
      tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM properties WHERE tenant_id=${tenantId}::uuid
        AND lower(trim(name))='empire beach resort'`,
  );
  if (properties.length !== 1)
    throw new Error('Empire Beach Resort must resolve to exactly one property.');
  const result = await copyPokpayStaging(database, source, {
    tenantId,
    propertyId: properties[0]!.id,
  });
  console.log(
    JSON.stringify({ ...result, hotel: 'Empire Beach Resort', activeAccountsUnchanged: true }),
  );
}
void main()
  .catch(() => {
    // Prisma/provider errors may include parameters. Never print the exception or credential values.
    console.error(
      'Staging copy stopped. No credentials were printed. Check hotel identity, source staging connection, destination conflicts and provider availability.',
    );
    process.exitCode = 1;
  })
  .finally(() => database.$disconnect());
