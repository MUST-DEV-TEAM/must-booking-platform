import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { MailSendReceipt } from '@must/domain-contracts';
import type { TenantTransaction } from '../tenancy/tenant-database.service';
import { AuditLogService } from '../tenancy/audit-log.service';
import { emailSendingCredentialBinding } from '../tenancy/email-sending-profile.service';
import {
  EmailTransportCredentialService,
  type EmailTransportCredentials,
} from './email-transport-credentials';
import {
  EmailTransportJournal,
  TransportAttemptBusyError,
  type TransportClaim,
  type TransportScope,
  type TransportStage,
} from './email-transport-journal';
import { currentMailAttempt } from './mail-attempt-context';
import { MailDeliveryError } from './mail-delivery-error';
import { PreparedMailError, type PreparedMailReceipt } from './prepared-mail-transport';
import { ResendPreparedTransport } from './resend-prepared.transport';
import { SmtpNetworkPolicyError } from './smtp-network-policy';
import { SmtpTransport, SmtpTransportError, type PreparedTransportMessage } from './smtp-transport';

export type RenderedTransportInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
  fromName?: string | null;
  replyTo?: string | null;
};
type Profile = {
  version: number;
  mode: 'DEFAULT' | 'RESEND' | 'SMTP';
  activeMode: 'DEFAULT' | 'RESEND' | 'SMTP';
  fromName: string | null;
  fromAddress: string | null;
  domain: string | null;
  smtpHost: string | null;
  smtpPort: 465 | 587 | 2525 | null;
  smtpSecurity: 'TLS' | 'STARTTLS' | null;
  credentialRevision: string | null;
  encryptedCredentials: string | null;
  fromVerifiedAt: Date | null;
  connectionStatus: string;
  domainStatus: string;
  fallbackGuest: boolean;
};
type Plan = {
  message: PreparedTransportMessage;
  key: string;
  displayName: string | null;
  credentials: EmailTransportCredentials | { provider: 'default'; fingerprint: string };
  smtp?: { host: string; port: 465 | 587 | 2525; security: 'TLS' | 'STARTTLS' };
  fallbackGuest: boolean;
};
const fingerprint = (key: string) => createHash('sha256').update(key).digest('hex');
const sender = (name: string | null | undefined, address: string) => {
  const safeName = (name ?? '')
    .replace(/["\\<>\r\n]/g, '')
    .trim()
    .slice(0, 100);
  if (!address || /[\r\n\0]/.test(address)) throw new PreparedMailError('rejected', false);
  return safeName ? `"${safeName}" <${address}>` : address;
};
function readPlan(contents: string): Plan {
  try {
    const value: unknown = JSON.parse(contents);
    if (
      !value ||
      typeof value !== 'object' ||
      !('message' in value) ||
      !('key' in value) ||
      !('credentials' in value) ||
      typeof value.key !== 'string'
    )
      throw Error();
    // This JSON comes only from the authenticated, scope-bound server envelope, never a request.
    const plan = value as Plan;
    if (
      !plan.message ||
      !Array.isArray(plan.message.to) ||
      !['default', 'resend', 'smtp'].includes(plan.credentials?.provider) ||
      typeof plan.message.subject !== 'string' ||
      typeof plan.message.html !== 'string' ||
      typeof plan.message.text !== 'string' ||
      typeof plan.message.from !== 'string'
    )
      throw Error();
    return plan;
  } catch {
    throw new PreparedMailError('unknown', false);
  }
}
/** Dispatches frozen custom envelopes; account/security mail always bypasses hotel transports. */
@Injectable()
export class PropertyMailDispatcher {
  constructor(
    @Inject(EmailTransportJournal) private readonly journal: EmailTransportJournal,
    @Inject(EmailTransportCredentialService)
    private readonly credentials: EmailTransportCredentialService,
    @Inject(SmtpTransport) private readonly smtp: SmtpTransport,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}
  async send(
    input: RenderedTransportInput,
    defaultSend: () => Promise<MailSendReceipt>,
  ): Promise<PreparedMailReceipt | MailSendReceipt> {
    const attempt = currentMailAttempt();
    if (
      attempt?.senderTestVersion !== undefined &&
      (!attempt.tenantId || !attempt.propertyId || attempt.sensitive || attempt.forceDefault)
    )
      throw new MailDeliveryError(
        'Custom sender test could not use its scoped transport. No default-sender test was sent.',
        false,
      );
    if (!attempt?.tenantId || !attempt.propertyId || attempt.sensitive || attempt.forceDefault)
      return defaultSend();
    const scope = {
      tenantId: attempt.tenantId,
      propertyId: attempt.propertyId,
      messageId: attempt.messageId,
    };
    const claim = await this.journal.claim(scope, 'PRIMARY', (tx) =>
      this.prepare(tx, scope, input),
    );
    if (claim.kind === 'bypass') return defaultSend();
    if (claim.kind === 'fallback') return this.fallback(scope);
    try {
      return await this.execute(scope, 'PRIMARY', claim);
    } catch (error) {
      if (
        !(error instanceof PreparedMailError) ||
        error.acceptance !== 'rejected' ||
        (error.retryable && !attempt.finalAttempt)
      )
        throw error;
      const original = readPlan((await this.journal.frozen(scope, 'PRIMARY')).contents);
      if (!original.fallbackGuest) throw error;
      return this.fallback(scope);
    }
  }
  private async prepare(
    tx: TenantTransaction,
    scope: TransportScope,
    input: RenderedTransportInput,
  ) {
    const rows = await tx.$queryRaw<Profile[]>`
      SELECT version,mode,active_mode AS "activeMode",from_name AS "fromName",from_address AS "fromAddress",domain,
        smtp_host AS "smtpHost",smtp_port AS "smtpPort",smtp_security AS "smtpSecurity",credential_revision AS "credentialRevision",
        encrypted_credentials AS "encryptedCredentials",from_verified_at AS "fromVerifiedAt",connection_status AS "connectionStatus",domain_status AS "domainStatus",fallback_guest AS "fallbackGuest"
      FROM email_sending_profiles WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid
    `;
    const profile = rows[0];
    const testing = currentMailAttempt()?.senderTestVersion;
    if (
      testing !== undefined &&
      (!profile || profile.version !== testing || profile.mode === 'DEFAULT')
    )
      throw new MailDeliveryError(
        'Saved sender setup changed. Create a new test from the current configuration.',
        false,
      );
    if (!profile || (profile.activeMode === 'DEFAULT' && testing === undefined)) return null;
    if (
      (testing === undefined && profile.mode !== profile.activeMode) ||
      !profile.fromAddress ||
      !profile.encryptedCredentials ||
      (profile.mode === 'SMTP' &&
        (!profile.fromVerifiedAt || profile.connectionStatus !== 'verified')) ||
      (profile.mode === 'RESEND' &&
        (profile.domainStatus !== 'verified' ||
          profile.fromAddress.split('@')[1] !== profile.domain))
    )
      throw new PreparedMailError('rejected', false);
    const credentials = this.credentials.open(
      scope,
      emailSendingCredentialBinding(profile),
      profile.encryptedCredentials,
    );
    if ((profile.mode === 'SMTP') !== (credentials.provider === 'smtp'))
      throw new PreparedMailError('rejected', false);
    const displayName = profile.fromName ?? input.fromName ?? null;
    const message: PreparedTransportMessage = {
      from: sender(displayName, profile.fromAddress),
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      messageId: `<${scope.messageId}@mustbooking.com>`,
    };
    const plan: Plan = {
      message,
      key: `hotel-mail/${scope.messageId}/primary`,
      displayName,
      credentials,
      fallbackGuest: Boolean(
        testing === undefined && currentMailAttempt()?.guestTransactional && profile.fallbackGuest,
      ),
      ...(credentials.provider === 'smtp' &&
      profile.smtpHost &&
      profile.smtpPort &&
      profile.smtpSecurity
        ? {
            smtp: {
              host: profile.smtpHost,
              port: profile.smtpPort,
              security: profile.smtpSecurity,
            },
          }
        : {}),
    };
    return { provider: credentials.provider, contents: JSON.stringify(plan) };
  }
  private async fallback(scope: TransportScope): Promise<PreparedMailReceipt> {
    const claim = await this.journal.claim(scope, 'FALLBACK', async (tx) => {
      const original = readPlan((await this.journal.frozen(scope, 'PRIMARY', tx)).contents);
      if (!original.fallbackGuest) throw new PreparedMailError('rejected', false);
      const configured = process.env.MAIL_FROM_EMAIL?.trim() ?? '',
        apiKey = process.env.RESEND_API_KEY?.trim() ?? '';
      if (!configured || !apiKey) throw new PreparedMailError('rejected', false);
      const address = /<([^>]+)>/.exec(configured)?.[1]?.trim() ?? configured;
      const plan: Plan = {
        ...original,
        message: {
          ...original.message,
          from: sender(original.displayName, address),
          messageId: `<${scope.messageId}.fallback@mustbooking.com>`,
        },
        credentials: { provider: 'default', fingerprint: fingerprint(apiKey) },
        smtp: undefined,
        key: `hotel-mail/${scope.messageId}/fallback`,
        fallbackGuest: false,
      };
      await this.audit.recordInTransaction(tx, {
        tenantId: scope.tenantId,
        propertyId: scope.propertyId,
        actorUserId: null,
        action: 'email_transport.fallback_started',
        targetType: 'email',
        targetId: scope.messageId,
        details: {
          actorType: 'job',
          source: 'job',
          reason:
            'Custom transport proved non-acceptance; frozen guest fallback preference enabled',
        },
      });
      return { provider: 'resend', contents: JSON.stringify(plan) };
    });
    return { ...(await this.execute(scope, 'FALLBACK', claim)), usedFallback: true };
  }
  private async execute(
    scope: TransportScope,
    stage: TransportStage,
    claim: TransportClaim,
  ): Promise<PreparedMailReceipt> {
    if (claim.kind === 'accepted') return claim.receipt;
    if (claim.kind === 'busy') throw new TransportAttemptBusyError();
    if (claim.kind === 'rejected') throw new PreparedMailError('rejected', claim.retryable);
    if (claim.kind !== 'send') throw new PreparedMailError('unknown', false);
    const plan = readPlan(claim.snapshot.contents);
    let result: PreparedMailReceipt | PreparedMailError;
    try {
      if (plan.credentials.provider === 'smtp') {
        if (!plan.smtp) throw new PreparedMailError('rejected', false);
        const receipt = await this.smtp.send(
          {
            ...plan.smtp,
            username: plan.credentials.username,
            password: plan.credentials.password,
          },
          plan.message,
        );
        // A partial envelope must never be retried or sent through the fallback account.
        const expected = new Set(
          [...plan.message.to, ...(plan.message.cc ?? []), ...(plan.message.bcc ?? [])].map(
            (address) => address.toLowerCase(),
          ),
        );
        if (
          receipt.rejected.length ||
          new Set(receipt.accepted.map((address) => address.toLowerCase())).size !==
            expected.size ||
          receipt.accepted.some((address) => !expected.has(address.toLowerCase())) ||
          receipt.accepted.length !==
            plan.message.to.length +
              (plan.message.cc?.length ?? 0) +
              (plan.message.bcc?.length ?? 0)
        )
          throw new PreparedMailError('unknown', false);
        result = { provider: 'smtp', providerMessageId: receipt.providerMessageId };
      } else {
        const apiKey =
          plan.credentials.provider === 'default'
            ? (process.env.RESEND_API_KEY?.trim() ?? '')
            : plan.credentials.apiKey;
        if (
          plan.credentials.provider === 'default' &&
          fingerprint(apiKey) !== plan.credentials.fingerprint
        )
          throw new PreparedMailError('rejected', false);
        result = await new ResendPreparedTransport(apiKey).send(plan.message, plan.key);
      }
    } catch (error) {
      result =
        error instanceof PreparedMailError
          ? error
          : error instanceof SmtpTransportError
            ? new PreparedMailError(error.acceptance, error.retryable)
            : error instanceof SmtpNetworkPolicyError
              ? new PreparedMailError('rejected', false)
              : new PreparedMailError('unknown', false);
    }
    try {
      if (!(await this.journal.finish(scope, stage, claim.fence, result))) throw Error();
    } catch {
      throw new PreparedMailError('unknown', false);
    }
    if (result instanceof PreparedMailError) throw result;
    return result;
  }
}
