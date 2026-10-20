import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CredentialCipherService } from '../integrations/credential-cipher';
import { AuditLogService } from '../tenancy/audit-log.service';
import { TenantDatabaseService, type TenantTransaction } from '../tenancy/tenant-database.service';
import { MailDeliveryError } from './mail-delivery-error';
import { PreparedMailError, type PreparedMailReceipt } from './prepared-mail-transport';

export type TransportScope = { tenantId: string; propertyId: string; messageId: string };
export type TransportStage = 'PRIMARY' | 'FALLBACK';
export type FrozenTransport = { provider: 'resend' | 'smtp'; contents: string };
type AttemptRow = {
  provider: 'resend' | 'smtp';
  state: 'READY' | 'SENDING' | 'ACCEPTED' | 'REJECTED' | 'UNKNOWN';
  encrypted: string | null;
  attempt: number;
  fence: string | null;
  elapsed: boolean;
  expired: boolean;
  retryable: boolean;
  providerMessageId: string | null;
};
export type TransportClaim =
  | { kind: 'bypass' }
  | { kind: 'accepted'; receipt: PreparedMailReceipt }
  | { kind: 'unknown' }
  | { kind: 'rejected'; retryable: boolean }
  | { kind: 'busy' }
  | { kind: 'fallback' }
  | { kind: 'send'; fence: string; attempt: number; snapshot: FrozenTransport };
export class TransportAttemptBusyError extends MailDeliveryError {
  constructor() {
    super('Another worker owns this email delivery attempt.', true);
  }
}
/** Scoped frozen envelopes, exclusive leases and immutable uncertainty tombstones. */
@Injectable()
export class EmailTransportJournal {
  constructor(
    @Inject(TenantDatabaseService) private readonly db: TenantDatabaseService,
    @Inject(CredentialCipherService) private readonly cipher: CredentialCipherService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}
  claim(
    scope: TransportScope,
    stage: TransportStage,
    prepare: (tx: TenantTransaction) => Promise<FrozenTransport | null>,
  ): Promise<TransportClaim> {
    return this.db.withTenantTransaction(scope, async (tx) => {
      const messages = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM email_messages WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND id=${scope.messageId}::uuid FOR UPDATE
      `;
      if (!messages.length)
        throw new MailDeliveryError('Scoped email intention was not found.', false);
      if (stage === 'PRIMARY') {
        const fallback = await tx.$queryRaw<{ stage: string }[]>`
          SELECT stage FROM email_transport_attempts WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND message_id=${scope.messageId}::uuid AND stage='FALLBACK'
        `;
        if (fallback.length) return { kind: 'fallback' };
      }
      if (stage === 'FALLBACK') {
        const primary = await tx.$queryRaw<{ state: string }[]>`
          SELECT state FROM email_transport_attempts WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND message_id=${scope.messageId}::uuid AND stage='PRIMARY'
        `;
        if (primary[0]?.state !== 'REJECTED') return { kind: 'unknown' };
      }
      let row = (
        await tx.$queryRaw<AttemptRow[]>`
        SELECT provider,state,encrypted_payload AS encrypted,attempt,fence,retryable,provider_message_id AS "providerMessageId",
          lease_expires_at<=clock_timestamp() AS elapsed,expires_at<=clock_timestamp() AS expired
        FROM email_transport_attempts WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND message_id=${scope.messageId}::uuid AND stage=${stage} FOR UPDATE
      `
      )[0];
      if (!row) {
        const snapshot = await prepare(tx);
        if (!snapshot) return { kind: 'bypass' };
        if (Buffer.byteLength(snapshot.contents, 'utf8') > 350_000)
          throw new MailDeliveryError('Prepared email exceeds the supported size.', false);
        const encrypted = this.cipher.encrypt({
          kind: 'hotel-mail-attempt-v1',
          tenantId: scope.tenantId,
          propertyId: scope.propertyId,
          messageId: scope.messageId,
          stage,
          provider: snapshot.provider,
          contents: snapshot.contents,
        });
        await tx.$executeRaw`
          INSERT INTO email_transport_attempts(tenant_id,property_id,message_id,stage,provider,encrypted_payload)
          VALUES(${scope.tenantId}::uuid,${scope.propertyId}::uuid,${scope.messageId}::uuid,${stage},${snapshot.provider},${encrypted})
        `;
        row = {
          provider: snapshot.provider,
          state: 'READY',
          encrypted,
          attempt: 0,
          fence: null,
          elapsed: false,
          expired: false,
          retryable: true,
          providerMessageId: null,
        };
      }
      if (row.state === 'ACCEPTED' && row.providerMessageId)
        return {
          kind: 'accepted',
          receipt: { provider: row.provider, providerMessageId: row.providerMessageId },
        };
      if (row.state === 'SENDING' && !row.elapsed) return { kind: 'busy' };
      if (row.state === 'UNKNOWN') return { kind: 'unknown' };
      if (row.expired || !row.encrypted || row.state === 'SENDING') {
        await tx.$executeRaw`
          UPDATE email_transport_attempts SET state='UNKNOWN',retryable=false,updated_at=clock_timestamp()
          WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND message_id=${scope.messageId}::uuid AND stage=${stage}
        `;
        return { kind: 'unknown' };
      }
      if (row.state === 'REJECTED' && !row.retryable) return { kind: 'rejected', retryable: false };
      const contents = this.open(scope, stage, row.provider, row.encrypted);
      const fence = randomUUID();
      await tx.$executeRaw`
        UPDATE email_transport_attempts SET state='SENDING',attempt=attempt+1,fence=${fence}::uuid,lease_expires_at=clock_timestamp()+interval '70 seconds',retryable=false,updated_at=clock_timestamp()
        WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND message_id=${scope.messageId}::uuid AND stage=${stage}
      `;
      return {
        kind: 'send',
        fence,
        attempt: row.attempt + 1,
        snapshot: { provider: row.provider, contents },
      };
    });
  }
  frozen(
    scope: TransportScope,
    stage: TransportStage,
    transaction?: TenantTransaction,
  ): Promise<FrozenTransport> {
    const query = async (tx: TenantTransaction): Promise<FrozenTransport> => {
      const rows = await tx.$queryRaw<{ provider: 'smtp' | 'resend'; encrypted: string }[]>`
        SELECT provider,encrypted_payload AS encrypted FROM email_transport_attempts
        WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND message_id=${scope.messageId}::uuid AND stage=${stage} AND encrypted_payload IS NOT NULL AND expires_at>clock_timestamp()
      `;
      if (!rows[0]) throw new PreparedMailError('unknown', false);
      return {
        provider: rows[0].provider,
        contents: this.open(scope, stage, rows[0].provider, rows[0].encrypted),
      };
    };
    return transaction ? query(transaction) : this.db.withTenantTransaction(scope, query);
  }
  private open(
    scope: TransportScope,
    stage: TransportStage,
    provider: string,
    encrypted: string,
  ): string {
    try {
      const payload = this.cipher.decrypt(encrypted);
      if (
        payload.kind !== 'hotel-mail-attempt-v1' ||
        payload.tenantId !== scope.tenantId ||
        payload.propertyId !== scope.propertyId ||
        payload.messageId !== scope.messageId ||
        payload.stage !== stage ||
        payload.provider !== provider ||
        typeof payload.contents !== 'string'
      )
        throw new Error();
      return payload.contents;
    } catch {
      throw new MailDeliveryError(
        'Frozen email is unavailable. Automatic delivery is stopped.',
        false,
      );
    }
  }
  finish(
    scope: TransportScope,
    stage: TransportStage,
    fence: string,
    result: PreparedMailReceipt | PreparedMailError,
  ): Promise<boolean> {
    return this.db.withTenantTransaction(scope, async (tx) => {
      const success = !(result instanceof PreparedMailError);
      const state = success ? 'ACCEPTED' : result.acceptance === 'unknown' ? 'UNKNOWN' : 'REJECTED';
      const rows = await tx.$queryRaw<{ provider: string; attempt: number }[]>`
        UPDATE email_transport_attempts SET state=${state},retryable=${!success && result.retryable},provider_message_id=${success ? result.providerMessageId : null},updated_at=clock_timestamp()
        WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND message_id=${scope.messageId}::uuid AND stage=${stage} AND fence=${fence}::uuid AND state IN ('SENDING','UNKNOWN')
        RETURNING provider,attempt
      `;
      if (!rows[0]) return false;
      await this.audit.recordInTransaction(tx, {
        tenantId: scope.tenantId,
        propertyId: scope.propertyId,
        actorUserId: null,
        action: 'email_transport.attempt_finished',
        targetType: 'email',
        targetId: scope.messageId,
        details: {
          actorType: 'job',
          source: 'job',
          stage,
          state,
          provider: rows[0].provider,
          attempt: rows[0].attempt,
          retryable: !success && result.retryable,
        },
      });
      return true;
    });
  }
  /** Expire encrypted bodies/credential snapshots without deleting deduplication tombstones. */
  cleanup(scope: { tenantId: string; propertyId: string }) {
    return this.db.withTenantTransaction(scope, async (tx) => {
      const elapsed = await tx.$queryRaw<
        { messageId: string; stage: string; provider: string; attempt: number }[]
      >`
        WITH stale AS (
          SELECT message_id,stage FROM email_transport_attempts WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid
            AND state='SENDING' AND lease_expires_at<=clock_timestamp() ORDER BY lease_expires_at LIMIT 100 FOR UPDATE SKIP LOCKED
        )
        UPDATE email_transport_attempts a SET state='UNKNOWN',retryable=false,updated_at=clock_timestamp() FROM stale s
        WHERE a.tenant_id=${scope.tenantId}::uuid AND a.property_id=${scope.propertyId}::uuid AND a.message_id=s.message_id AND a.stage=s.stage
        RETURNING a.message_id AS "messageId",a.stage,a.provider,a.attempt
      `;
      for (const row of elapsed)
        await this.audit.recordInTransaction(tx, {
          ...scope,
          actorUserId: null,
          action: 'email_transport.attempt_expired',
          targetType: 'email',
          targetId: row.messageId,
          details: {
            actorType: 'job',
            source: 'job',
            stage: row.stage,
            provider: row.provider,
            attempt: row.attempt,
            state: 'UNKNOWN',
            reason: 'Exclusive send lease expired without a durable receipt',
          },
        });
      return tx.$executeRaw`
        WITH expired AS (
          SELECT message_id,stage FROM email_transport_attempts WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid
            AND encrypted_payload IS NOT NULL AND expires_at<=clock_timestamp() ORDER BY expires_at LIMIT 500 FOR UPDATE SKIP LOCKED
        )
        UPDATE email_transport_attempts a SET encrypted_payload=NULL FROM expired e
        WHERE a.tenant_id=${scope.tenantId}::uuid AND a.property_id=${scope.propertyId}::uuid AND a.message_id=e.message_id AND a.stage=e.stage
      `;
    });
  }
}
