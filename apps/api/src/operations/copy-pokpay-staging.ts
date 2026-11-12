import { randomUUID } from 'node:crypto';

import { CredentialCipherService } from '../integrations/credential-cipher';
import { POKPAY_STAGING_BASE_URL, resolvePokpayBaseUrl } from '../payments/pokpay-environments';
import { AuditLogService } from '../tenancy/audit-log.service';
import {
  TenantDatabaseService,
  type TenantDatabaseContext,
} from '../tenancy/tenant-database.service';

export class StagingCopyPreconditionError extends Error {}

type Scope = Required<TenantDatabaseContext>;
type Connection = { id: string; encrypted: string; name: string };
const connectionName = 'PokPay staging (Must Hotel)';
const webhookUrl = 'https://booking.must.al/api/webhooks/pokpay';

/** Authentication only: never creates an order or sends a payment. */
export async function verifyStaging(credentials: Record<string, string>): Promise<void> {
  if (resolvePokpayBaseUrl(credentials) !== POKPAY_STAGING_BASE_URL)
    throw new StagingCopyPreconditionError('Only PokPay staging may be copied.');
  const response = await fetch(`${POKPAY_STAGING_BASE_URL}/auth/sdk/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ keyId: credentials.keyId, keySecret: credentials.keySecret }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json()) as { data?: { accessToken?: string } };
  if (!response.ok || !body?.data?.accessToken)
    throw new StagingCopyPreconditionError('PokPay staging authentication failed.');
}

/** Server-only maintenance primitive; no API route and no credentials returned or logged. */
export async function copyPokpayStaging(
  database: TenantDatabaseService,
  source: Scope,
  destination: Scope,
  verify: typeof verifyStaging = verifyStaging,
) {
  if (source.tenantId === destination.tenantId || source.propertyId === destination.propertyId)
    throw new StagingCopyPreconditionError('Source and destination must be different hotels.');
  const roles = await database.$queryRaw<Array<{ unsafe: boolean }>>`
    SELECT (rolsuper OR rolbypassrls) AS unsafe FROM pg_roles WHERE rolname = current_user`;
  if (roles.length !== 1 || roles[0]!.unsafe)
    throw new StagingCopyPreconditionError('Use the RLS-constrained runtime database role.');
  const cipher = new CredentialCipherService();
  const saved = await database.withTenantTransaction(
    source,
    (tx) =>
      tx.$queryRaw<Connection[]>`
      SELECT c.id, c.name, c.encrypted_credentials AS encrypted FROM integration_connections c
      JOIN property_integration_connections pc ON pc.tenant_id=c.tenant_id AND pc.connection_id=c.id
      WHERE c.tenant_id=${source.tenantId}::uuid AND pc.property_id=${source.propertyId}::uuid
        AND c.kind='PAYMENT' AND c.provider='POKPAY' AND c.status='CONNECTED' AND pc.enabled`,
  );
  if (saved.length !== 1)
    throw new StagingCopyPreconditionError('Expected one connected PokPay account at Must Hotel.');
  const original = cipher.decrypt(saved[0]!.encrypted);
  if (resolvePokpayBaseUrl(original) !== POKPAY_STAGING_BASE_URL)
    throw new StagingCopyPreconditionError('Must Hotel must be using PokPay staging.');
  if (!original.keyId?.trim() || !original.keySecret?.trim() || !original.merchantId?.trim())
    throw new StagingCopyPreconditionError('The source staging credentials are incomplete.');
  const credentials = {
    keyId: original.keyId,
    keySecret: original.keySecret,
    merchantId: original.merchantId,
    baseUrl: POKPAY_STAGING_BASE_URL,
    webhookUrl,
  };
  await verify(credentials);
  const audit = new AuditLogService(database);
  return database.withTenantTransaction(destination, async (tx) => {
    const property = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM properties WHERE tenant_id=${destination.tenantId}::uuid
        AND id=${destination.propertyId}::uuid FOR UPDATE`;
    if (property.length !== 1)
      throw new StagingCopyPreconditionError('Destination hotel was not found.');
    const existing = await tx.$queryRaw<Connection[]>`
      SELECT id, name, encrypted_credentials AS encrypted FROM integration_connections
      WHERE tenant_id=${destination.tenantId}::uuid AND kind='PAYMENT' AND provider='POKPAY'
      FOR UPDATE`;
    const staging = existing.filter(
      (row) => resolvePokpayBaseUrl(cipher.decrypt(row.encrypted)) === POKPAY_STAGING_BASE_URL,
    );
    const matching = staging.filter((row) => {
      const keys = cipher.decrypt(row.encrypted);
      return (
        keys.keyId === credentials.keyId &&
        keys.keySecret === credentials.keySecret &&
        keys.merchantId === credentials.merchantId &&
        (keys.webhookUrl || webhookUrl) === webhookUrl
      );
    });
    if (
      staging.length > 1 ||
      (staging.length === 1 && matching.length !== 1) ||
      existing.some((row) => row.name === connectionName && !matching.includes(row))
    )
      throw new StagingCopyPreconditionError(
        'A different staging connection already exists; nothing was overwritten.',
      );
    const id = matching[0]?.id ?? randomUUID();
    const assigned = await tx.$queryRaw<Array<{ enabled: boolean }>>`
      SELECT enabled FROM property_integration_connections
      WHERE tenant_id=${destination.tenantId}::uuid AND property_id=${destination.propertyId}::uuid
        AND connection_id=${id}::uuid`;
    if (assigned[0]?.enabled)
      throw new StagingCopyPreconditionError(
        'The matching staging connection is already active; nothing was changed.',
      );
    const created = !matching.length;
    if (created)
      await tx.$executeRaw`
        INSERT INTO integration_connections(id,tenant_id,kind,provider,name,encrypted_credentials,status,last_tested_at,last_test_result)
        VALUES(${id}::uuid,${destination.tenantId}::uuid,'PAYMENT','POKPAY',${connectionName},
          ${cipher.encrypt(credentials)},'CONNECTED',now(),'Staging authentication verified; account left inactive')`;
    else
      await tx.$executeRaw`
        UPDATE integration_connections SET status='CONNECTED',last_tested_at=now(),
          last_test_result='Staging authentication verified; account left inactive',updated_at=now()
        WHERE tenant_id=${destination.tenantId}::uuid AND id=${id}::uuid`;
    await tx.$executeRaw`
      INSERT INTO property_integration_connections(tenant_id,property_id,connection_id,kind,enabled)
      VALUES(${destination.tenantId}::uuid,${destination.propertyId}::uuid,${id}::uuid,'PAYMENT',false)
      ON CONFLICT(tenant_id,property_id,connection_id) DO NOTHING`;
    await audit.recordInTransaction(tx, {
      tenantId: destination.tenantId,
      propertyId: destination.propertyId,
      actorUserId: null,
      action: created ? 'integration_connection.created' : 'integration_connection.tested',
      targetType: 'integration_connection',
      targetId: id,
      result: 'completed',
      details: {
        provider: 'POKPAY',
        mode: 'TEST',
        enabled: false,
        source: 'OPS',
        operation: 'copy-empire-pokpay-staging',
        sourceTenantId: source.tenantId,
        sourcePropertyId: source.propertyId,
        sourceConnectionId: saved[0]!.id,
        created,
      },
    });
    return { connectionId: id, created, mode: 'TEST', enabled: false };
  });
}
