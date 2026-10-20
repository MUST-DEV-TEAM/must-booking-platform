import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { RenderedEmailCommand } from '@must/domain-contracts';
import { TenantDatabaseService, type TenantTransaction } from '../tenancy/tenant-database.service';
import type { EmailContext } from '../tenancy/email-workspace-writes';
import { MailDeliveryError } from './mail-delivery-error';
import {
  SenderVerificationPayloadService,
  type SenderVerificationBinding,
} from './sender-verification-secrets';

export const SENDER_PROOF_SUBJECT = 'Verify your hotel email sender';
export const senderProofKey = (id: string) => `sender-verification/${id}`;

/** Refuse to replay an accepted email through a changed default provider account or identity. */
export function senderProofTransportFingerprint(): string {
  const key = process.env.RESEND_API_KEY ?? '';
  const from = process.env.MAIL_FROM_EMAIL ?? '';
  if (!key || !from)
    throw new MailDeliveryError('Default MUST email sending is unavailable.', false);
  return createHash('sha256')
    .update(
      JSON.stringify(['sender-proof-default-v1', key, from, process.env.RESEND_API_BASE_URL ?? '']),
    )
    .digest('hex');
}

export type SenderProofRow = {
  id: string;
  credentialRevision: string;
  fromAddress: string;
  codeHash: string | null;
  encryptedMessage: string | null;
  transportFingerprint: string;
  state: string;
  attempts: number;
  guessFingerprints: string[];
  createdAt: Date;
  expiresAt: Date;
  verifiedAt: Date | null;
};

export function proofBinding(scope: EmailContext, row: SenderProofRow): SenderVerificationBinding {
  return {
    ...scope,
    verificationId: row.id,
    credentialRevision: row.credentialRevision,
    fromAddress: row.fromAddress,
    expiresAt: row.expiresAt.toISOString(),
  };
}

/** Loads a scoped encrypted security message just before default-provider delivery. */
@Injectable()
export class SenderVerificationStore {
  constructor(
    @Inject(TenantDatabaseService) private readonly db: TenantDatabaseService,
    @Inject(SenderVerificationPayloadService)
    private readonly payload: SenderVerificationPayloadService,
  ) {}

  async read(
    tx: TenantTransaction,
    scope: EmailContext,
    id: string,
  ): Promise<SenderProofRow | null> {
    const rows = await tx.$queryRaw<
      SenderProofRow[]
    >`SELECT id::text,credential_revision::text AS "credentialRevision",
      from_address AS "fromAddress",code_hash AS "codeHash",encrypted_message AS "encryptedMessage",
      transport_fingerprint AS "transportFingerprint",state,attempts,guess_fingerprints AS "guessFingerprints",created_at AS "createdAt",expires_at AS "expiresAt",verified_at AS "verifiedAt"
      FROM email_sender_proofs WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND id=${id}::uuid`;
    return rows[0] ?? null;
  }

  async cleanup(tx: TenantTransaction, scope: EmailContext): Promise<void> {
    await tx.$executeRaw`UPDATE email_sender_proofs s SET state=CASE WHEN s.expires_at<=now() THEN 'expired' ELSE 'superseded' END,
      code_hash=NULL,encrypted_message=NULL
      WHERE s.tenant_id=${scope.tenantId}::uuid AND s.property_id=${scope.propertyId}::uuid AND s.state='pending'
      AND (s.expires_at<=now() OR NOT EXISTS(SELECT 1 FROM email_sending_profiles p WHERE p.tenant_id=s.tenant_id AND p.property_id=s.property_id
      AND p.mode='SMTP' AND p.credential_revision=s.credential_revision AND p.from_address=s.from_address))`;
  }

  async command(scope: EmailContext, id: string): Promise<RenderedEmailCommand> {
    return this.db.withTenantTransaction(scope, async (tx) => {
      await this.cleanup(tx, scope);
      const row = await this.read(tx, scope, id);
      if (
        !row ||
        row.state !== 'pending' ||
        !row.encryptedMessage ||
        row.expiresAt.getTime() <= Date.now()
      )
        throw new MailDeliveryError(
          'Sender verification expired or was replaced. Request a new email.',
          false,
        );
      if (row.transportFingerprint !== senderProofTransportFingerprint())
        throw new MailDeliveryError(
          'Default sender changed. Request a new verification email.',
          false,
        );
      let message;
      try {
        message = this.payload.open(proofBinding(scope, row), row.encryptedMessage);
      } catch {
        throw new MailDeliveryError(
          'Sender verification is unavailable. Request a new email.',
          false,
        );
      }
      return {
        ...message,
        to: row.fromAddress,
        fromName: 'MUST Booking',
        replyTo: null,
        bookingId: null,
        eventType: 'email.sender_verification',
        idempotencyKey: senderProofKey(id),
      };
    });
  }
}
