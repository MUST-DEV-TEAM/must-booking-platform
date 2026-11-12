import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { AuditLogService } from '../tenancy/audit-log.service';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { connectionMode, type ConnectionMode } from './connection-mode';
import { ConnectionTestRegistry } from './connection-tester';
import { CredentialCipherService } from './credential-cipher';

export type ConnectionKind = 'PAYMENT' | 'PMS';
export type ConnectionProvider = 'STRIPE' | 'POKPAY' | 'CLOCK_PMS';
export type ConnectionStatus = 'PENDING' | 'CONNECTED' | 'FAILED';
export type PaymentConnectionProvider = 'STRIPE' | 'POKPAY';

const KINDS: ConnectionKind[] = ['PAYMENT', 'PMS'];
const PROVIDERS: ConnectionProvider[] = ['STRIPE', 'POKPAY', 'CLOCK_PMS'];

export interface ConnectionSummary {
  id: string;
  kind: ConnectionKind;
  provider: ConnectionProvider;
  name: string;
  status: ConnectionStatus;
  /** TEST or LIVE for a payment connection, from its own keys; null for a PMS connection. */
  mode: ConnectionMode | null;
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
  mode: ConnectionMode | null;
  enabled: boolean;
}

/** A payment connection with its decrypted keys, for payment providers only. */
export interface PaymentConnection {
  connectionId: string;
  mode: ConnectionMode;
  credentials: Record<string, string>;
}

export interface ActiveClockPmsProperty {
  tenantId: string;
  propertyId: string;
}

const SUMMARY_COLUMNS = `id, kind, provider, name, status,
  last_tested_at AS "lastTestedAt", last_test_result AS "lastTestResult",
  webhook_public_id AS "webhookPublicId", created_at AS "createdAt"`;
/** Summary columns plus the encrypted keys, which never leave this service (see summarize()). */
const SUMMARY_SOURCE = `${SUMMARY_COLUMNS}, encrypted_credentials AS "encryptedCredentials"`;
type ConnectionRow = Omit<ConnectionSummary, 'mode'> & { encryptedCredentials: string };

@Injectable()
export class IntegrationConnectionsService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(CredentialCipherService) private readonly cipher: CredentialCipherService,
    @Inject(ConnectionTestRegistry) private readonly testers: ConnectionTestRegistry,
  ) {}

  async list(tenantId: string): Promise<ConnectionSummary[]> {
    const rows = await this.database.withTenantTransaction({ tenantId }, (tx) =>
      tx.$queryRawUnsafe<ConnectionRow[]>(
        `SELECT ${SUMMARY_SOURCE} FROM integration_connections WHERE tenant_id = $1::uuid ORDER BY created_at`,
        tenantId,
      ),
    );
    return rows.map((row) => this.summarize(row));
  }

  async credentialDetails(tenantId: string, connectionId: string) {
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ provider: ConnectionProvider; encrypted: string }>
      >`SELECT provider, encrypted_credentials AS encrypted FROM integration_connections WHERE tenant_id=${tenantId}::uuid AND id=${connectionId}::uuid`;
      if (!rows[0]) throw new BadRequestException('Connection not found.');
      const data = this.cipher.decrypt(rows[0].encrypted);
      const fields =
        rows[0].provider === 'CLOCK_PMS'
          ? ['host', 'accountId', 'subscriptionId', 'apiUser', 'apiKey']
          : rows[0].provider === 'POKPAY'
            ? ['keyId', 'keySecret', 'merchantId', 'webhookUrl', 'baseUrl']
            : ['secretKey', 'webhookSecret'];
      const secretKeys = new Set(['apiKey', 'keySecret', 'secretKey', 'webhookSecret']);
      return {
        provider: rows[0].provider,
        fields: Object.fromEntries(
          fields.map((key) => [
            key,
            secretKeys.has(key)
              ? data[key]?.length > 4
                ? '***' + data[key].slice(-4)
                : '****'
              : data[key] || (key === 'baseUrl' ? 'https://api-staging.pokpay.io' : ''),
          ]),
        ),
      };
    });
  }

  setup() {
    const explicit = process.env.POKPAY_WEBHOOK_URL?.trim();
    const origin = process.env.WEB_APP_URL?.trim();
    return {
      pokpayWebhookUrl:
        explicit || (origin ? new URL('/api/webhooks/pokpay', origin).toString() : ''),
    };
  }

  async create(tenantId: string, actorUserId: string, body: unknown): Promise<ConnectionSummary> {
    const input = this.createInput(body);
    if (input.provider === 'POKPAY' && !input.credentials.webhookUrl) {
      const callback = this.setup().pokpayWebhookUrl;
      if (!callback)
        throw new BadRequestException(
          'MUST needs its public payment notification address configured before activation.',
        );
      input.credentials = { ...input.credentials, webhookUrl: callback };
    }
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
      const rows = await tx.$queryRawUnsafe<ConnectionRow[]>(
        `INSERT INTO integration_connections (id, tenant_id, kind, provider, name, encrypted_credentials)
         VALUES ($1::uuid, $2::uuid, $3::"IntegrationConnectionKind", $4::"IntegrationProvider", $5, $6)
         RETURNING ${SUMMARY_SOURCE}`,
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
        details: {
          kind: input.kind,
          provider: input.provider,
          name: input.name,
          ...(input.kind === 'PAYMENT'
            ? { mode: connectionMode(input.provider, input.credentials) }
            : {}),
        },
      });
      return this.summarize(rows[0]!);
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
      const rows = await tx.$queryRawUnsafe<ConnectionRow[]>(
        `UPDATE integration_connections SET encrypted_credentials=$3,status='CONNECTED',last_tested_at=now(),last_test_result='Replacement credentials verified' WHERE tenant_id=$1::uuid AND id=$2::uuid AND encrypted_credentials=$4 RETURNING ${SUMMARY_SOURCE}`,
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
      return this.summarize(rows[0]);
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
      const affected = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT property_id AS id FROM property_integration_connections WHERE tenant_id=${tenantId}::uuid AND connection_id=${connectionId}::uuid`;
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
        affectedPropertyIds: affected.map((row) => row.id),
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
      const updated = await tx.$queryRawUnsafe<ConnectionRow[]>(
        `UPDATE integration_connections
         SET status = $3::"IntegrationConnectionStatus", last_tested_at = CURRENT_TIMESTAMP, last_test_result = $4
         WHERE tenant_id = $1::uuid AND id = $2::uuid
         RETURNING ${SUMMARY_SOURCE}`,
        tenantId,
        connectionId,
        result.ok ? 'CONNECTED' : 'FAILED',
        result.message,
      );
      await this.audit.recordInTransaction(tx, {
        tenantId,
        actorUserId,
        action: 'integration_connection.tested',
        result: result.ok ? 'completed' : 'failed',
        targetType: 'integration_connection',
        targetId: connectionId,
        details: { ok: result.ok, message: result.message },
      });
      return this.summarize(updated[0]!);
    });
  }

  async listForProperty(
    tenantId: string,
    propertyId: string,
  ): Promise<PropertyConnectionAssignment[]> {
    const rows = await this.database.withTenantTransaction({ tenantId, propertyId }, (tx) =>
      tx.$queryRawUnsafe<
        Array<Omit<PropertyConnectionAssignment, 'mode'> & { encryptedCredentials: string }>
      >(
        `SELECT c.id AS "connectionId", c.kind, c.provider, c.name,
             COALESCE(pic.enabled, false) AS enabled, c.encrypted_credentials AS "encryptedCredentials"
           FROM integration_connections c
           LEFT JOIN property_integration_connections pic
             ON pic.tenant_id = c.tenant_id AND pic.connection_id = c.id AND pic.property_id = $2::uuid
           WHERE c.tenant_id = $1::uuid
           ORDER BY c.created_at`,
        tenantId,
        propertyId,
      ),
    );
    return rows.map(({ encryptedCredentials, ...row }) => ({
      ...row,
      mode: this.modeOf(row.provider, encryptedCredentials),
    }));
  }

  /**
   * The payment connections switched on for a property and whether each is a test or live account.
   * Holds no keys, so every member of the hotel may read it (the dashboard's test-mode bar).
   */
  async paymentModes(
    tenantId: string,
    propertyId: string,
  ): Promise<Array<{ provider: PaymentConnectionProvider; name: string; mode: ConnectionMode }>> {
    const assignments = await this.listForProperty(tenantId, propertyId);
    return assignments
      .filter((row) => row.kind === 'PAYMENT' && row.enabled && row.mode)
      .map((row) => ({
        provider: row.provider as PaymentConnectionProvider,
        name: row.name,
        mode: row.mode!,
      }));
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
    provider: PaymentConnectionProvider,
  ): Promise<Record<string, string> | null> {
    return (
      (await this.activePaymentConnection(tenantId, propertyId, provider))?.credentials ?? null
    );
  }

  /** Internal-only: the property's switched-on connection for this payment provider, with its keys. */
  async activePaymentConnection(
    tenantId: string,
    propertyId: string,
    provider: PaymentConnectionProvider,
  ): Promise<PaymentConnection | null> {
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ connectionId: string; encrypted: string }>>(
        `SELECT c.id AS "connectionId", c.encrypted_credentials AS encrypted
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
      return rows[0] ? this.paymentConnection(provider, rows[0]) : null;
    });
  }

  /**
   * Internal-only: the connection that created this provider order, as recorded on its payment
   * session — switched on or not. Checks and refunds of a payment must reach the account that took
   * it, even after the hotel switched between its test and live accounts. Null when the session
   * has no recorded connection (older sessions; see linkedPaymentConnections).
   */
  async sessionPaymentConnection(
    tenantId: string,
    propertyId: string,
    provider: PaymentConnectionProvider,
    externalPaymentId: string,
  ): Promise<PaymentConnection | null> {
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ connectionId: string; encrypted: string }>>`
        SELECT c.id AS "connectionId", c.encrypted_credentials AS encrypted
        FROM payment_provider_sessions s
        JOIN integration_connections c ON c.tenant_id = s.tenant_id AND c.id = s.connection_id
        WHERE s.tenant_id = ${tenantId}::uuid AND s.property_id = ${propertyId}::uuid
          AND s.provider = ${provider.toLowerCase()} AND s.external_payment_id = ${externalPaymentId}
          AND c.kind = 'PAYMENT' AND c.provider = ${provider}::"IntegrationProvider"`;
      return rows[0] ? this.paymentConnection(provider, rows[0]) : null;
    });
  }

  /**
   * Internal-only: every connection of this payment provider linked to the property, switched on or
   * off, the one in use first. Used to find which account an older order (one whose session does not
   * record its connection) belongs to.
   */
  async linkedPaymentConnections(
    tenantId: string,
    propertyId: string,
    provider: PaymentConnectionProvider,
  ): Promise<PaymentConnection[]> {
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ connectionId: string; encrypted: string }>>`
        SELECT c.id AS "connectionId", c.encrypted_credentials AS encrypted
        FROM integration_connections c
        JOIN property_integration_connections pic
          ON pic.tenant_id = c.tenant_id AND pic.connection_id = c.id
        WHERE c.tenant_id = ${tenantId}::uuid AND pic.property_id = ${propertyId}::uuid
          AND c.kind = 'PAYMENT' AND c.provider = ${provider}::"IntegrationProvider"
        ORDER BY pic.enabled DESC, pic.updated_at DESC, c.created_at DESC`;
      return rows.map((row) => this.paymentConnection(provider, row));
    });
  }

  /** Internal-only: records which connection an older session belongs to, once it has been found. */
  async rememberSessionConnection(
    tenantId: string,
    propertyId: string,
    provider: PaymentConnectionProvider,
    externalPaymentId: string,
    connectionId: string,
  ): Promise<void> {
    await this.database.withTenantTransaction(
      { tenantId, propertyId },
      (tx) =>
        tx.$executeRaw`
        UPDATE payment_provider_sessions SET connection_id = ${connectionId}::uuid
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
          AND provider = ${provider.toLowerCase()} AND external_payment_id = ${externalPaymentId}
          AND connection_id IS NULL`,
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
      let switchedFrom: string[] = [];
      await tx.$queryRaw`SELECT id FROM properties WHERE tenant_id=${tenantId}::uuid AND id=${propertyId}::uuid FOR UPDATE`;

      const connection = await tx.$queryRawUnsafe<
        Array<{ kind: ConnectionKind; provider: ConnectionProvider; encrypted: string }>
      >(
        `SELECT kind,provider,encrypted_credentials AS encrypted FROM integration_connections WHERE tenant_id = $1::uuid AND id = $2::uuid`,
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
      // Clock bookings are tied to one Clock account, so moving a hotel with Clock history to another
      // Clock account stays a reviewed migration. Payment accounts are different: every payment session
      // records the account that took it, and checks and refunds use that account, so a hotel may switch
      // freely between its PokPay test and live accounts (or move to a new live account) at any time.
      if (enabled && connection[0].provider === 'CLOCK_PMS') {
        const history = await tx.$queryRaw<
          Array<{ unsafe: boolean }>
        >`SELECT EXISTS(SELECT 1 FROM property_integration_connections pc JOIN integration_connections ic ON ic.tenant_id=pc.tenant_id AND ic.id=pc.connection_id WHERE pc.tenant_id=${tenantId}::uuid AND pc.property_id=${propertyId}::uuid AND pc.connection_id<>${connectionId}::uuid AND ic.provider='CLOCK_PMS'::"IntegrationProvider") AND EXISTS(SELECT 1 FROM bookings WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND external_booking_id IS NOT NULL) AS unsafe`;
        if (history[0]?.unsafe)
          throw new ConflictException(
            'This hotel already has history with another Clock connection. Replace credentials on that connection; moving to another Clock account requires a reviewed migration.',
          );
      }
      if (enabled && connection[0].provider === 'POKPAY') {
        // One PokPay account in use at a time. The others stay saved with their keys, so the hotel
        // can switch back whenever it wants.
        const previous = await tx.$queryRaw<Array<{ id: string }>>`
          UPDATE property_integration_connections pc SET enabled=false,updated_at=now() FROM integration_connections c
          WHERE pc.tenant_id=${tenantId}::uuid AND pc.property_id=${propertyId}::uuid AND pc.connection_id=c.id AND c.tenant_id=pc.tenant_id AND c.provider='POKPAY' AND c.id<>${connectionId}::uuid AND pc.enabled
          RETURNING pc.connection_id AS id`;
        switchedFrom = previous.map((row) => row.id);
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
        ...(connection[0].kind === 'PAYMENT'
          ? {
              details: {
                provider: connection[0].provider,
                mode: this.modeOf(connection[0].provider, connection[0].encrypted),
                ...(switchedFrom.length ? { switchedFrom } : {}),
              },
            }
          : {}),
      });
    });
  }

  private summarize({ encryptedCredentials, ...summary }: ConnectionRow): ConnectionSummary {
    return { ...summary, mode: this.modeOf(summary.provider, encryptedCredentials) };
  }

  /** TEST or LIVE for a payment connection; null for a PMS one or keys that cannot be read. */
  private modeOf(provider: ConnectionProvider, encrypted: string): ConnectionMode | null {
    if (provider === 'CLOCK_PMS') return null;
    try {
      return connectionMode(provider, this.cipher.decrypt(encrypted));
    } catch {
      return null;
    }
  }

  private paymentConnection(
    provider: PaymentConnectionProvider,
    row: { connectionId: string; encrypted: string },
  ): PaymentConnection {
    const credentials = this.cipher.decrypt(row.encrypted);
    return {
      connectionId: row.connectionId,
      mode: connectionMode(provider, credentials) ?? 'LIVE',
      credentials,
    };
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
