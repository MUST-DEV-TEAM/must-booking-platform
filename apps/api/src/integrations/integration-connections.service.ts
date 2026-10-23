import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { AuditLogService } from '../tenancy/audit-log.service';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { ConnectionTestRegistry } from './connection-tester';
import { CredentialCipherService } from './credential-cipher';

export type ConnectionKind = 'PAYMENT' | 'PMS';
export type ConnectionProvider = 'STRIPE' | 'POKPAY' | 'CLOCK_PMS';
export type ConnectionStatus = 'PENDING' | 'CONNECTED' | 'FAILED';

const KINDS: ConnectionKind[] = ['PAYMENT', 'PMS'];
const PROVIDERS: ConnectionProvider[] = ['STRIPE', 'POKPAY', 'CLOCK_PMS'];

export interface ConnectionSummary {
  id: string;
  kind: ConnectionKind;
  provider: ConnectionProvider;
  name: string;
  status: ConnectionStatus;
  lastTestedAt: string | null;
  lastTestResult: string | null;
  webhookPublicId: string;
  createdAt: string;
}

export interface PropertyConnectionAssignment {
  connectionId: string;
  kind: ConnectionKind;
  provider: ConnectionProvider;
  name: string;
  enabled: boolean;
}

export interface ActiveClockPmsProperty {
  tenantId: string;
  propertyId: string;
}

const SUMMARY_COLUMNS = `id, kind, provider, name, status,
  last_tested_at AS "lastTestedAt", last_test_result AS "lastTestResult",
  webhook_public_id AS "webhookPublicId", created_at AS "createdAt"`;

@Injectable()
export class IntegrationConnectionsService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(CredentialCipherService) private readonly cipher: CredentialCipherService,
    @Inject(ConnectionTestRegistry) private readonly testers: ConnectionTestRegistry,
  ) {}

  list(tenantId: string): Promise<ConnectionSummary[]> {
    return this.database.withTenantTransaction({ tenantId }, (tx) =>
      tx.$queryRawUnsafe<ConnectionSummary[]>(
        `SELECT ${SUMMARY_COLUMNS} FROM integration_connections WHERE tenant_id = $1::uuid ORDER BY created_at`,
        tenantId,
      ),
    );
  }

  async create(tenantId: string, actorUserId: string, body: unknown): Promise<ConnectionSummary> {
    const input = this.createInput(body);
    const id = randomUUID();
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      if (input.kind === 'PMS') {
        const plan = await tx.$queryRaw<Array<{ pmsEnabled: boolean }>>`
          SELECT p."pms_enabled" AS "pmsEnabled"
          FROM "organizations" o JOIN "plans" p ON p."id" = o."plan_id"
          WHERE o."id" = ${tenantId}::uuid
        `;
        if (!plan[0]?.pmsEnabled)
          throw new ConflictException(
            'This plan does not include PMS access. Upgrade to connect a PMS.',
          );
      }
      const encrypted = this.cipher.encrypt(input.credentials);
      const rows = await tx.$queryRawUnsafe<ConnectionSummary[]>(
        `INSERT INTO integration_connections (id, tenant_id, kind, provider, name, encrypted_credentials)
         VALUES ($1::uuid, $2::uuid, $3::"IntegrationConnectionKind", $4::"IntegrationProvider", $5, $6)
         RETURNING ${SUMMARY_COLUMNS}`,
        id,
        tenantId,
        input.kind,
        input.provider,
        input.name,
        encrypted,
      );
      await this.audit.recordInTransaction(tx, {
        tenantId,
        actorUserId,
        action: 'integration_connection.created',
        targetType: 'integration_connection',
        targetId: id,
        details: { kind: input.kind, provider: input.provider, name: input.name },
      });
      return rows[0];
    });
  }

  async replaceCredentials(
    tenantId: string,
    actorUserId: string,
    connectionId: string,
    body: unknown,
  ): Promise<ConnectionSummary> {
    const value = (body ?? {}) as Record<string, unknown>;
    const supplied = value.credentials;
    if (
      !supplied ||
      typeof supplied !== 'object' ||
      Array.isArray(supplied) ||
      !Object.keys(supplied).length ||
      Object.values(supplied).some((v) => typeof v !== 'string' || v.length > 5000)
    )
      throw new BadRequestException('Enter replacement credentials.');
    const before = await this.database.withTenantTransaction(
      { tenantId },
      (tx) =>
        tx.$queryRaw<
          Array<{ provider: ConnectionProvider; encrypted: string }>
        >`SELECT provider,encrypted_credentials AS encrypted FROM integration_connections WHERE tenant_id=${tenantId}::uuid AND id=${connectionId}::uuid`,
    );
    if (!before[0]) throw new BadRequestException('Connection not found.');
    const previous = this.cipher.decrypt(before[0].encrypted);
    const allowed =
      before[0].provider === 'CLOCK_PMS'
        ? ['apiUser', 'apiKey']
        : before[0].provider === 'POKPAY'
          ? ['keyId', 'keySecret']
          : [];
    if (Object.keys(supplied).some((k) => !allowed.includes(k)))
      throw new BadRequestException(
        'Use a new connection to change the provider account. Only authentication credentials can be replaced here.',
      );
    const credentials = { ...previous, ...(supplied as Record<string, string>) };
    const result = await this.testers.test(before[0].provider, credentials);
    if (!result.ok)
      throw new BadRequestException(
        'Replacement credentials failed verification. The existing connection has been kept.',
      );
    const encrypted = this.cipher.encrypt(credentials);
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      const rows = await tx.$queryRawUnsafe<ConnectionSummary[]>(
        `UPDATE integration_connections SET encrypted_credentials=$3,status='CONNECTED',last_tested_at=now(),last_test_result='Replacement credentials verified' WHERE tenant_id=$1::uuid AND id=$2::uuid AND encrypted_credentials=$4 RETURNING ${SUMMARY_COLUMNS}`,
        tenantId,
        connectionId,
        encrypted,
        before[0].encrypted,
      );
      if (!rows[0])
        throw new ConflictException(
          'The connection changed during verification. Reload and retry.',
        );
      await this.audit.recordInTransaction(tx, {
        tenantId,
        actorUserId,
        action: 'integration_connection.credentials_replaced',
        targetType: 'integration_connection',
        targetId: connectionId,
        details: { provider: before[0].provider, verified: true },
      });
      return rows[0];
    });
  }

  async delete(tenantId: string, actorUserId: string, connectionId: string): Promise<void> {
    await this.database.withTenantTransaction({ tenantId }, async (tx) => {
      const history = await tx.$queryRaw<Array<{ used: boolean }>>`
        SELECT EXISTS(SELECT 1 FROM property_integration_connections pc
          JOIN integration_connections ic ON ic.tenant_id=pc.tenant_id AND ic.id=pc.connection_id
          WHERE pc.tenant_id=${tenantId}::uuid AND pc.connection_id=${connectionId}::uuid
          AND ((ic.provider='CLOCK_PMS' AND EXISTS(SELECT 1 FROM bookings b WHERE b.tenant_id=pc.tenant_id AND b.property_id=pc.property_id AND b.external_booking_id IS NOT NULL))
            OR (ic.provider='POKPAY' AND EXISTS(SELECT 1 FROM payments p WHERE p.tenant_id=pc.tenant_id AND p.property_id=pc.property_id AND p.provider='pokpay')))) AS used`;
      if (history[0]?.used)
        throw new ConflictException(
          'Keep this connection for existing bookings and payments. Disable it or replace its credentials instead of deleting its history.',
        );
      const deleted = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `DELETE FROM integration_connections WHERE tenant_id = $1::uuid AND id = $2::uuid RETURNING id`,
        tenantId,
        connectionId,
      );
      if (!deleted[0]) throw new BadRequestException('Connection not found.');
      await this.audit.recordInTransaction(tx, {
        tenantId,
        actorUserId,
        action: 'integration_connection.deleted',
        targetType: 'integration_connection',
        targetId: connectionId,
      });
    });
  }

  async test(
    tenantId: string,
    actorUserId: string,
    connectionId: string,
  ): Promise<ConnectionSummary> {
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      const rows = await tx.$queryRawUnsafe<
        Array<{ provider: ConnectionProvider; encryptedCredentials: string }>
      >(
        `SELECT provider, encrypted_credentials AS "encryptedCredentials" FROM integration_connections WHERE tenant_id = $1::uuid AND id = $2::uuid`,
        tenantId,
        connectionId,
      );
      if (!rows[0]) throw new BadRequestException('Connection not found.');
      const credentials = this.cipher.decrypt(rows[0].encryptedCredentials);
      const result = await this.testers.test(rows[0].provider, credentials);
      const updated = await tx.$queryRawUnsafe<ConnectionSummary[]>(
        `UPDATE integration_connections
         SET status = $3::"IntegrationConnectionStatus", last_tested_at = CURRENT_TIMESTAMP, last_test_result = $4
         WHERE tenant_id = $1::uuid AND id = $2::uuid
         RETURNING ${SUMMARY_COLUMNS}`,
        tenantId,
        connectionId,
        result.ok ? 'CONNECTED' : 'FAILED',
        result.message,
      );
      await this.audit.recordInTransaction(tx, {
        tenantId,
        actorUserId,
        action: 'integration_connection.tested',
        targetType: 'integration_connection',
        targetId: connectionId,
        details: { ok: result.ok, message: result.message },
      });
      return updated[0];
    });
  }

  listForProperty(tenantId: string, propertyId: string): Promise<PropertyConnectionAssignment[]> {
    return this.database.withTenantTransaction({ tenantId, propertyId }, (tx) =>
      tx.$queryRawUnsafe<PropertyConnectionAssignment[]>(
        `SELECT c.id AS "connectionId", c.kind, c.provider, c.name,
             COALESCE(pic.enabled, false) AS enabled
           FROM integration_connections c
           LEFT JOIN property_integration_connections pic
             ON pic.tenant_id = c.tenant_id AND pic.connection_id = c.id AND pic.property_id = $2::uuid
           WHERE c.tenant_id = $1::uuid
           ORDER BY c.created_at`,
        tenantId,
        propertyId,
      ),
    );
  }

  /**
   * Internal-only: the decrypted credentials for a property's active PMS
   * connection (if any). Never exposed through the controller — the only
   * callers are PMS provider implementations (e.g. ClockPmsProvider) that
   * need real credentials to make outbound calls on the tenant's behalf.
   */
  async activePmsConnectionCredentials(
    tenantId: string,
    propertyId: string,
  ): Promise<{
    connectionId: string;
    provider: ConnectionProvider;
    credentials: Record<string, string>;
  } | null> {
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const rows = await tx.$queryRawUnsafe<
        Array<{ connectionId: string; provider: ConnectionProvider; encryptedCredentials: string }>
      >(
        `SELECT c.id AS "connectionId", c.provider, c.encrypted_credentials AS "encryptedCredentials"
         FROM integration_connections c
         JOIN property_integration_connections pic
           ON pic.tenant_id = c.tenant_id AND pic.connection_id = c.id
         WHERE c.tenant_id = $1::uuid AND pic.property_id = $2::uuid
           AND c.kind = 'PMS' AND pic.enabled = true`,
        tenantId,
        propertyId,
      );
      if (!rows[0]) return null;
      return {
        connectionId: rows[0].connectionId,
        provider: rows[0].provider,
        credentials: this.cipher.decrypt(rows[0].encryptedCredentials),
      };
    });
  }

  /**
   * Internal-only: all properties with an enabled Clock PMS connection.
   *
   * The first read uses the existing platform-admin read-only organization
   * carve-out solely to enumerate tenant IDs. Each connection lookup then
   * runs in that tenant's normal RLS context, so this background scheduler
   * never needs a cross-tenant integration-connection policy or bypass.
   */
  async activeClockPmsProperties(): Promise<ActiveClockPmsProperty[]> {
    const tenants = await this.database.withPlatformAdminTransaction(
      { role: 'platform_admin' },
      (tx) => tx.$queryRaw<Array<{ tenantId: string }>>`SELECT id AS "tenantId" FROM organizations`,
    );
    const byTenant = await Promise.all(
      tenants.map(({ tenantId }) =>
        this.database.withTenantTransaction({ tenantId }, (tx) =>
          tx.$queryRawUnsafe<Array<{ propertyId: string }>>(
            `SELECT pic.property_id AS "propertyId"
             FROM integration_connections c
             JOIN property_integration_connections pic
               ON pic.tenant_id = c.tenant_id AND pic.connection_id = c.id
             WHERE c.tenant_id = $1::uuid
               AND c.kind = 'PMS' AND c.provider = 'CLOCK_PMS'
               AND pic.enabled = true
             ORDER BY pic.property_id`,
            tenantId,
          ),
        ),
      ),
    );
    return byTenant.flatMap((properties, index) =>
      properties.map(({ propertyId }) => ({ tenantId: tenants[index]!.tenantId, propertyId })),
    );
  }

  /**
   * Internal-only: the decrypted credentials for a property's active
   * connection for a given payment provider (if any). Never exposed through
   * the controller — the only callers are payment providers (StripePaymentProvider,
   * PokPayPaymentProvider) that need real credentials to act on the tenant's
   * behalf. Unlike PMS, a property may have more than one enabled payment
   * connection at once (e.g. both Stripe and PokPay) — the caller already
   * knows which provider it needs.
   */
  async activePaymentConnectionCredentials(
    tenantId: string,
    propertyId: string,
    provider: 'STRIPE' | 'POKPAY',
  ): Promise<Record<string, string> | null> {
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ encryptedCredentials: string }>>(
        `SELECT c.encrypted_credentials AS "encryptedCredentials"
         FROM integration_connections c
         JOIN property_integration_connections pic
           ON pic.tenant_id = c.tenant_id AND pic.connection_id = c.id
         WHERE c.tenant_id = $1::uuid AND pic.property_id = $2::uuid
           AND c.kind = 'PAYMENT' AND c.provider = $3::"IntegrationProvider" AND pic.enabled = true
         LIMIT 1`,
        tenantId,
        propertyId,
        provider,
      );
      if (!rows[0]) return null;
      return this.cipher.decrypt(rows[0].encryptedCredentials);
    });
  }

  async setPropertyConnection(
    tenantId: string,
    propertyId: string,
    actorUserId: string,
    connectionId: string,
    enabled: boolean,
  ): Promise<void> {
    await this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await tx.$queryRaw`SELECT id FROM properties WHERE tenant_id=${tenantId}::uuid AND id=${propertyId}::uuid FOR UPDATE`;

      const connection = await tx.$queryRawUnsafe<
        Array<{ kind: ConnectionKind; provider: ConnectionProvider }>
      >(
        `SELECT kind,provider FROM integration_connections WHERE tenant_id = $1::uuid AND id = $2::uuid`,
        tenantId,
        connectionId,
      );
      if (!connection[0]) throw new BadRequestException('Connection not found.');
      if (!enabled && connection[0].provider === 'CLOCK_PMS') {
        const active = await tx.$queryRaw<Array<{ unsafe: boolean }>>`
          SELECT EXISTS(SELECT 1 FROM property_integration_connections pc
          WHERE pc.tenant_id=${tenantId}::uuid AND pc.property_id=${propertyId}::uuid
          AND pc.connection_id=${connectionId}::uuid AND pc.enabled)
          AND EXISTS(SELECT 1 FROM bookings WHERE tenant_id=${tenantId}::uuid
          AND property_id=${propertyId}::uuid AND ends_on>=CURRENT_DATE
          AND status IN ('CONFIRMED','PAYMENT_PENDING','PMS_CONFIRMATION_PENDING','PMS_UNKNOWN_RESULT')) AS unsafe`;
        if (active[0]?.unsafe)
          throw new ConflictException(
            'This hotel has active bookings. Replace credentials to repair the connection; disabling Clock requires a reviewed migration to standalone inventory.',
          );
      }
      if (enabled && ['CLOCK_PMS', 'POKPAY'].includes(connection[0].provider)) {
        const history = await tx.$queryRaw<
          Array<{ unsafe: boolean }>
        >`SELECT EXISTS(SELECT 1 FROM property_integration_connections pc JOIN integration_connections ic ON ic.tenant_id=pc.tenant_id AND ic.id=pc.connection_id WHERE pc.tenant_id=${tenantId}::uuid AND pc.property_id=${propertyId}::uuid AND pc.connection_id<>${connectionId}::uuid AND ic.provider=${connection[0].provider}::"IntegrationProvider") AND (CASE WHEN ${connection[0].provider}='CLOCK_PMS' THEN EXISTS(SELECT 1 FROM bookings WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND external_booking_id IS NOT NULL) ELSE EXISTS(SELECT 1 FROM payments WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND provider='pokpay') END) AS unsafe`;
        if (history[0]?.unsafe)
          throw new ConflictException(
            'This hotel already has history with another connection. Replace credentials on that connection; moving to another provider account requires a reviewed migration.',
          );
      }
      if (enabled && connection[0].provider === 'POKPAY') {
        await tx.$executeRaw`UPDATE property_integration_connections pc SET enabled=false,updated_at=now() FROM integration_connections c
        WHERE pc.tenant_id=${tenantId}::uuid AND pc.property_id=${propertyId}::uuid AND pc.connection_id=c.id AND c.tenant_id=pc.tenant_id AND c.provider='POKPAY' AND c.id<>${connectionId}::uuid AND pc.enabled`;
      }
      try {
        await tx.$executeRawUnsafe(
          `INSERT INTO property_integration_connections (tenant_id, property_id, connection_id, kind, enabled)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::"IntegrationConnectionKind", $5)
           ON CONFLICT (tenant_id, property_id, connection_id)
           DO UPDATE SET enabled = $5, updated_at = CURRENT_TIMESTAMP`,
          tenantId,
          propertyId,
          connectionId,
          connection[0].kind,
          enabled,
        );
      } catch (error: unknown) {
        if (this.isUniqueViolation(error))
          throw new ConflictException(
            'Only one PMS connection can be active per property. Disable the current one first.',
          );
        throw error;
      }
      await this.audit.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId,
        action: enabled
          ? 'integration_connection.enabled_for_property'
          : 'integration_connection.disabled_for_property',
        targetType: 'integration_connection',
        targetId: connectionId,
      });
    });
  }

  private createInput(body: unknown): {
    kind: ConnectionKind;
    provider: ConnectionProvider;
    name: string;
    credentials: Record<string, string>;
  } {
    const value = (body ?? {}) as Record<string, unknown>;
    const kind = value.kind;
    if (typeof kind !== 'string' || !KINDS.includes(kind as ConnectionKind))
      throw new BadRequestException(`kind must be one of: ${KINDS.join(', ')}.`);
    const provider = value.provider;
    if (typeof provider !== 'string' || !PROVIDERS.includes(provider as ConnectionProvider))
      throw new BadRequestException(`provider must be one of: ${PROVIDERS.join(', ')}.`);
    const name = typeof value.name === 'string' ? value.name.trim() : '';
    if (!name || name.length > 200)
      throw new BadRequestException('name is required and must be 200 characters or fewer.');
    const credentials = value.credentials;
    if (
      !credentials ||
      typeof credentials !== 'object' ||
      Array.isArray(credentials) ||
      Object.values(credentials).some((entry) => typeof entry !== 'string')
    )
      throw new BadRequestException('credentials must be an object of string values.');
    return {
      kind: kind as ConnectionKind,
      provider: provider as ConnectionProvider,
      name,
      credentials: credentials as Record<string, string>,
    };
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2010' &&
      (error as { meta?: { code?: string } }).meta?.code === '23505'
    );
  }
}
