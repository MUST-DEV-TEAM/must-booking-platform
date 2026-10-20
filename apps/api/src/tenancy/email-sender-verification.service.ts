import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import { AuditLogService } from './audit-log.service';
import { emailWrite, type EmailContext } from './email-workspace-writes';
import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';
import { MailDeliveryService } from '../mail/mail-delivery.service';
import { escapeHtml, MUST_BOOKING_BRAND, renderBrandedEmail } from '../mail/email-layout';
import {
  issueSenderVerificationCode,
  matchesSenderVerificationCode,
  senderVerificationId,
  SenderVerificationPayloadService,
} from '../mail/sender-verification-secrets';
import {
  proofBinding,
  SenderVerificationStore,
  senderProofKey,
  senderProofTransportFingerprint,
  SENDER_PROOF_SUBJECT,
  type SenderProofRow,
} from '../mail/sender-verification-store';

type Profile = {
  version: number;
  mode: string;
  credentialRevision: string | null;
  fromAddress: string | null;
  connectionStatus: string;
  connectionCheckedAt: Date | null;
};
type ProofResult = {
  id: string;
  state: string;
  version: number;
  expiresAt: string;
  verifiedAt: string | null;
  message: string;
};

function validVersion(body: Record<string, unknown>, allowed: string[]) {
  if (
    Object.keys(body).some((k) => !allowed.includes(k)) ||
    !Number.isSafeInteger(body.version) ||
    Number(body.version) < 1
  )
    throw new BadRequestException('Use the current saved sender version.');
}

/** Mailbox ownership proof is separate from staff account verification and sender activation. */
@Injectable()
export class EmailSenderVerificationService {
  constructor(
    @Inject(TenantDatabaseService) private readonly db: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(SenderVerificationStore) private readonly store: SenderVerificationStore,
    @Inject(SenderVerificationPayloadService)
    private readonly payload: SenderVerificationPayloadService,
    @Inject(MailDeliveryService) private readonly delivery: MailDeliveryService,
  ) {}

  private async profile(tx: TenantTransaction, scope: EmailContext): Promise<Profile> {
    const rows = await tx.$queryRaw<
      Profile[]
    >`SELECT version,mode,credential_revision::text AS "credentialRevision",from_address AS "fromAddress",
      connection_status AS "connectionStatus",connection_checked_at AS "connectionCheckedAt" FROM email_sending_profiles
      WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid`;
    if (!rows[0]) throw new BadRequestException('Save and check an SMTP sender first.');
    return rows[0];
  }

  private view(row: SenderProofRow, version: number): ProofResult {
    const state =
      row.state === 'pending' && row.expiresAt.getTime() <= Date.now() ? 'expired' : row.state;
    return {
      id: row.id,
      state,
      version,
      expiresAt: row.expiresAt.toISOString(),
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
      message:
        state === 'verified'
          ? 'From address verified. Custom sending is not yet activated.'
          : state === 'pending'
            ? 'A verification email was requested. Enter its code within 30 minutes.'
            : 'This verification is no longer usable. Request a new email.',
    };
  }

  async get(scope: EmailContext, id: string) {
    return this.db.withTenantTransaction(scope, async (tx) => {
      await this.store.cleanup(tx, scope);
      const row = await this.store.read(tx, scope, id);
      if (!row) throw new NotFoundException('Sender verification was not found.');
      const profile = await this.profile(tx, scope);
      if (
        profile.mode !== 'SMTP' ||
        profile.credentialRevision !== row.credentialRevision ||
        profile.fromAddress !== row.fromAddress
      ) {
        row.state = 'superseded';
        row.verifiedAt = null;
      }
      const messages = await tx.$queryRaw<
        { status: string }[]
      >`SELECT status::text FROM email_messages WHERE tenant_id=${scope.tenantId}::uuid
        AND property_id=${scope.propertyId}::uuid AND idempotency_key=${senderProofKey(id)}`;
      return {
        ...this.view(row, profile.version),
        deliveryStatus: messages[0]?.status ?? 'PENDING',
      };
    });
  }

  async request(scope: EmailContext, userId: string, body: Record<string, unknown>, key?: string) {
    validVersion(body, ['version', 'reason']);
    if (
      typeof body.reason !== 'string' ||
      body.reason.trim().length < 3 ||
      body.reason.trim().length > 300
    )
      throw new BadRequestException('Enter a reason (3-300 characters).');
    const reason = body.reason.trim();
    const response = await emailWrite<ProofResult>(
      this.db,
      this.audit,
      scope,
      userId,
      key,
      'email_configuration.from_verification.requested',
      scope.propertyId,
      { version: body.version, reason },
      async (tx) => {
        const profile = await this.profile(tx, scope);
        if (profile.version !== body.version)
          throw new ConflictException(
            'Sender setup changed. Reload before requesting verification.',
          );
        if (
          profile.mode !== 'SMTP' ||
          !profile.credentialRevision ||
          !profile.fromAddress ||
          profile.connectionStatus !== 'verified' ||
          !profile.connectionCheckedAt
        )
          throw new BadRequestException('Save the SMTP setup and pass its connection check first.');
        const counts = await tx.$queryRaw<
          { count: number }[]
        >`SELECT count(*)::int AS count FROM email_sender_proofs
          WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND created_at>now()-interval '1 hour'`;
        if (counts[0]!.count >= 3)
          throw new HttpException(
            'Three sender verification emails per hotel per rolling hour are allowed.',
            429,
          );
        const id = randomUUID(),
          createdAt = new Date(),
          expiresAt = new Date(createdAt.getTime() + 30 * 60_000);
        const row: SenderProofRow = {
          id,
          credentialRevision: profile.credentialRevision,
          fromAddress: profile.fromAddress,
          createdAt,
          expiresAt,
          codeHash: null,
          encryptedMessage: null,
          transportFingerprint: senderProofTransportFingerprint(),
          state: 'pending',
          attempts: 0,
          guessFingerprints: [],
          verifiedAt: null,
        };
        const binding = proofBinding(scope, row),
          issued = issueSenderVerificationCode(binding);
        const configured = new URL(process.env.WEB_APP_URL ?? 'http://localhost:3001');
        if (
          !['http:', 'https:'].includes(configured.protocol) ||
          configured.username ||
          configured.password
        )
          throw new BadRequestException('Dashboard URL configuration is unavailable.');
        const link = new URL(`/dashboard/${scope.tenantId}`, configured.origin);
        link.searchParams.set('propertyId', scope.propertyId);
        link.searchParams.set('section', 'settings');
        link.searchParams.set('settingsArea', 'email');
        link.searchParams.set('emailTab', 'sender');
        link.hash = `sender-proof=${encodeURIComponent(issued.code)}`;
        const text = `Verify ${profile.fromAddress} as your hotel sender in MUST Booking.\n\nOpen: ${link.toString()}\n\nOr paste this code in Emails > Configuration:\n${issued.code}\n\nThis code expires in 30 minutes. It does not activate custom sending. If you did not request this, ignore this email.`;
        const html = renderBrandedEmail({
          brand: MUST_BOOKING_BRAND,
          subject: SENDER_PROOF_SUBJECT,
          heading: 'Verify your hotel sender',
          content: `<p>Confirm ${escapeHtml(profile.fromAddress)} for your hotel in MUST Booking.</p><p>Or paste this code in Emails &gt; Configuration:</p><p style="overflow-wrap:anywhere">${escapeHtml(issued.code)}</p><p>Expires in 30 minutes. This does not activate custom sending. If you did not request this, ignore this email.</p>`,
          cta: { url: link.toString(), label: 'Verify sender' },
        });
        const encrypted = this.payload.seal(binding, { subject: SENDER_PROOF_SUBJECT, html, text });
        await tx.$executeRaw`UPDATE email_sender_proofs SET state='superseded',code_hash=NULL,encrypted_message=NULL
          WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND state='pending'`;
        await tx.$executeRaw`INSERT INTO email_sender_proofs(tenant_id,property_id,id,credential_revision,from_address,code_hash,encrypted_message,transport_fingerprint,created_at,expires_at)
          VALUES(${scope.tenantId}::uuid,${scope.propertyId}::uuid,${id}::uuid,${profile.credentialRevision}::uuid,${profile.fromAddress},${issued.hash},${encrypted},${row.transportFingerprint},${createdAt},${expiresAt})`;
        await tx.$executeRaw`UPDATE email_sending_profiles SET version=version+1,updated_at=now()
          WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid`;
        return {
          response: this.view(row, profile.version + 1),
          details: { verificationId: id, reason, version: profile.version + 1 },
        };
      },
    );
    // Replays recover the original committed intention, never generate a second code.
    await this.publish(scope, response.id);
    return response;
  }

  async confirm(scope: EmailContext, userId: string, body: Record<string, unknown>, key?: string) {
    validVersion(body, ['version', 'code']);
    if (typeof body.code !== 'string')
      throw new BadRequestException('Enter the code from the verification email.');
    const id = senderVerificationId(body.code);
    if (!id) throw new BadRequestException('Enter the complete verification code.');
    const code = body.code.trim();
    const secret = Buffer.from(process.env.INTEGRATION_CREDENTIALS_KEY ?? '', 'base64');
    if (secret.length !== 32) throw new BadRequestException('Sender verification is unavailable.');
    const fingerprint = createHmac('sha256', secret)
      .update(JSON.stringify([scope, id, code]))
      .digest('hex');
    return emailWrite<ProofResult>(
      this.db,
      this.audit,
      scope,
      userId,
      key,
      'email_configuration.from_verification.confirmed',
      id,
      { version: body.version, codeFingerprint: fingerprint },
      async (tx) => {
        const profile = await this.profile(tx, scope);
        if (profile.version !== body.version)
          throw new ConflictException('Sender setup changed. Reload before confirming.');
        await this.store.cleanup(tx, scope);
        const row = await this.store.read(tx, scope, id);
        if (!row) throw new NotFoundException('Sender verification was not found.');
        if (
          profile.mode !== 'SMTP' ||
          profile.credentialRevision !== row.credentialRevision ||
          profile.fromAddress !== row.fromAddress
        ) {
          row.state = 'superseded';
          row.verifiedAt = null;
        }
        if (row.state !== 'pending')
          return {
            response: this.view(row, profile.version),
            details: { verificationId: id, result: 'unavailable' },
          };
        const valid =
          !!row.codeHash &&
          matchesSenderVerificationCode(proofBinding(scope, row), code, row.codeHash);
        const distinct = !row.guessFingerprints.includes(fingerprint);
        const attempts = row.attempts + (!valid && distinct ? 1 : 0),
          state = valid ? 'verified' : attempts >= 5 ? 'locked' : 'pending';
        await tx.$executeRaw`UPDATE email_sender_proofs SET attempts=${attempts},state=${state},verified_at=CASE WHEN ${valid} THEN now() ELSE NULL END,
          guess_fingerprints=CASE WHEN ${!valid && distinct} THEN array_append(guess_fingerprints,${fingerprint}) ELSE guess_fingerprints END,
          verified_by=CASE WHEN ${valid} THEN ${userId}::uuid ELSE NULL END,
          code_hash=CASE WHEN ${state !== 'pending'} THEN NULL ELSE code_hash END,encrypted_message=CASE WHEN ${state !== 'pending'} THEN NULL ELSE encrypted_message END
          WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND id=${id}::uuid`;
        if (valid)
          await tx.$executeRaw`UPDATE email_sending_profiles SET version=version+1,from_verified_at=now(),updated_at=now()
          WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid`;
        const result = this.view(
          { ...row, state, verifiedAt: valid ? new Date() : null },
          profile.version + (valid ? 1 : 0),
        );
        if (!valid && state === 'pending') {
          result.state = 'invalid';
          result.message = 'That code is not correct. Check the email and try again.';
        }
        // A typed invalid result commits the guess count, receipt and audit instead of rolling them back.
        return {
          response: result,
          details: {
            verificationId: id,
            result: valid ? 'verified' : state === 'locked' ? 'locked' : 'invalid',
            attempts,
          },
        };
      },
    );
  }

  private async publish(scope: EmailContext, id: string) {
    const pending = await this.db.withTenantTransaction(scope, async (tx) => {
      await this.store.cleanup(tx, scope);
      const row = await this.store.read(tx, scope, id);
      return row?.state === 'pending' ? row : null;
    });
    if (pending)
      await this.delivery.dispatch(
        'senderVerification',
        { verificationId: id, to: pending.fromAddress },
        scope,
        { preserveIdentity: true },
      );
  }

  async recover(scope: EmailContext) {
    const rows = await this.db.withTenantTransaction(scope, async (tx) => {
      await this.store.cleanup(tx, scope);
      return tx.$queryRaw<
        { id: string }[]
      >`SELECT id::text FROM email_sender_proofs WHERE tenant_id=${scope.tenantId}::uuid
        AND property_id=${scope.propertyId}::uuid AND state='pending' AND expires_at>now()`;
    });
    for (const row of rows) await this.publish(scope, row.id);
  }
}
