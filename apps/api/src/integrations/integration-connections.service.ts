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
  createdAt: string;
}

export interface PropertyConnectionAssignment {
  connectionId: string;
  kind: ConnectionKind;
  provider: ConnectionProvider;
  name: string;
  enabled: boolean;
}

const SUMMARY_COLUMNS = `id, kind, provider, name, status,
  last_tested_at AS "lastTestedAt", last_test_result AS "lastTestResult",
  created_at AS "createdAt"`;

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

  async delete(tenantId: string, actorUserId: string, connectionId: string): Promise<void> {
    await this.database.withTenantTransaction({ tenantId }, async (tx) => {
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

  async setPropertyConnection(
    tenantId: string,
    propertyId: string,
    actorUserId: string,
    connectionId: string,
    enabled: boolean,
  ): Promise<void> {
    await this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const connection = await tx.$queryRawUnsafe<Array<{ kind: ConnectionKind }>>(
        `SELECT kind FROM integration_connections WHERE tenant_id = $1::uuid AND id = $2::uuid`,
        tenantId,
        connectionId,
      );
      if (!connection[0]) throw new BadRequestException('Connection not found.');
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
