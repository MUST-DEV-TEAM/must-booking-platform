import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EmailTransportCredentialService } from '../mail/email-transport-credentials';
import { ResendSendingDomainProvider } from '../mail/resend-domain.provider';
import {
  SendingDomainProviderError,
  type SendingDomainEvidence,
  type SendingDomainRecord,
} from '../mail/sending-domain-provider';
import { smtpHostname } from '../mail/smtp-network-policy';
import { readDmarcPublication, type DmarcPublication } from '../mail/dmarc-publication';
import { AuditLogService } from './audit-log.service';
import { emailWrite, type EmailContext } from './email-workspace-writes';
import { emailSendingCredentialBinding } from './email-sending-profile.service';
import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';

type Profile = {
  version: number;
  mode: 'DEFAULT' | 'SMTP' | 'RESEND';
  activeMode: string;
  fromAddress: string | null;
  domain: string | null;
  credentialRevision: string | null;
  encryptedCredentials: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecurity: 'TLS' | 'STARTTLS' | null;
};
type Operation = {
  kind: 'DOMAIN_CHECK';
  id: string;
  domain: string;
  version: number;
  state: string;
  startedAt: string;
  expiresAt: string;
  completedAt: string | null;
  registrationAttempted: boolean;
  dmarc: DmarcPublication | null;
  providerId: string | null;
  records: SendingDomainRecord[];
  message: string;
};
const operationView = (op: Operation): Operation =>
  op.state === 'checking' && Date.parse(op.expiresAt) <= Date.now()
    ? {
        ...op,
        state: 'unknown',
        message:
          'The check did not finish. Refresh domain evidence; an uncertain registration is never repeated.',
      }
    : op;

function defaultDomain(): string {
  const address = process.env.MAIL_FROM_EMAIL?.trim() ?? '';
  const email = /<([^<>]+)>/.exec(address)?.[1] ?? address;
  const at = email.lastIndexOf('@');
  if (at < 1)
    throw new BadRequestException(
      'The default MUST sender is not configured. Contact platform support.',
    );
  try {
    return smtpHostname(email.slice(at + 1));
  } catch {
    throw new BadRequestException(
      'The default MUST sender domain is unavailable. Contact platform support.',
    );
  }
}

/** Manual provider evidence with a durable registration marker, never transport activation. */
@Injectable()
export class EmailDomainVerificationService {
  constructor(
    @Inject(TenantDatabaseService) private readonly db: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(EmailTransportCredentialService)
    private readonly credentials: EmailTransportCredentialService,
  ) {}

  private async profile(tx: TenantTransaction, scope: EmailContext): Promise<Profile> {
    const rows = await tx.$queryRaw<
      Profile[]
    >`SELECT version,mode,active_mode AS "activeMode",from_address AS "fromAddress",domain,
      credential_revision::text AS "credentialRevision",encrypted_credentials AS "encryptedCredentials",smtp_host AS "smtpHost",smtp_port AS "smtpPort",smtp_security AS "smtpSecurity"
      FROM email_sending_profiles WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid`;
    return (
      rows[0] ?? {
        version: 1,
        mode: 'DEFAULT',
        activeMode: 'DEFAULT',
        fromAddress: null,
        domain: null,
        credentialRevision: null,
        encryptedCredentials: null,
        smtpHost: null,
        smtpPort: null,
        smtpSecurity: null,
      }
    );
  }

  async get(scope: EmailContext, id: string) {
    return this.db.withTenantTransaction(scope, async (tx) => {
      const rows = await tx.$queryRaw<
        { response: Operation }[]
      >`SELECT response FROM email_workspace_operations WHERE tenant_id=${scope.tenantId}::uuid
        AND property_id=${scope.propertyId}::uuid AND response->>'kind'='DOMAIN_CHECK' AND response->>'id'=${id}`;
      if (!rows[0]) throw new NotFoundException('Domain operation was not found.');
      return operationView(rows[0].response);
    });
  }

  async check(scope: EmailContext, userId: string, body: Record<string, unknown>, key?: string) {
    if (
      Object.keys(body).some((k) => !['version', 'reason', 'allowCreate'].includes(k)) ||
      !Number.isSafeInteger(body.version) ||
      Number(body.version) < 1 ||
      typeof body.reason !== 'string' ||
      body.reason.trim().length < 3 ||
      body.reason.trim().length > 300 ||
      (body.allowCreate !== undefined && typeof body.allowCreate !== 'boolean')
    )
      throw new BadRequestException(
        'Use the current version, a reason (3-300 characters), and an explicit registration choice.',
      );
    const reason = body.reason.trim(),
      allowCreate = body.allowCreate === true;
    let claimed: { profile: Profile; apiKey: string } | undefined;
    const reserved = await emailWrite<Operation>(
      this.db,
      this.audit,
      scope,
      userId,
      key,
      'email_configuration.domain_check.requested',
      scope.propertyId,
      { version: body.version, reason, allowCreate },
      async (tx) => {
        const profile = await this.profile(tx, scope);
        if (profile.version !== body.version)
          throw new ConflictException('Sending setup changed. Reload before checking its domain.');
        if (profile.mode === 'SMTP')
          throw new BadRequestException('SMTP uses a From mailbox verification instead.');
        if (profile.activeMode !== 'DEFAULT')
          throw new ConflictException(
            'Switch to the default MUST sender before preparing domain setup.',
          );
        let apiKey: string, domain: string;
        if (profile.mode === 'DEFAULT') {
          if (allowCreate)
            throw new BadRequestException('Default MUST domain checks are read-only.');
          domain = defaultDomain();
          apiKey = process.env.RESEND_API_KEY?.trim() ?? '';
          if (!apiKey)
            throw new BadRequestException(
              'Default MUST domain diagnostics are unavailable. Contact platform support.',
            );
        } else {
          if (!profile.domain || !profile.encryptedCredentials)
            throw new BadRequestException(
              'Save the domain and its replacement provider key first.',
            );
          domain = profile.domain;
          let platformDomain: string | null = null;
          try {
            platformDomain = defaultDomain();
          } catch {
            /* Own-domain reads do not require a configured shared sender. */
          }
          if (domain === platformDomain)
            throw new BadRequestException('Use the default MUST sender for the platform domain.');
          let secret;
          try {
            secret = this.credentials.open(
              scope,
              emailSendingCredentialBinding(profile),
              profile.encryptedCredentials,
            );
          } catch {
            throw new BadRequestException(
              'Saved domain credentials are unavailable. Replace them.',
            );
          }
          if (secret.provider !== 'resend')
            throw new BadRequestException(
              'Saved domain credentials are unavailable. Replace them.',
            );
          apiKey = secret.apiKey;
        }
        const counts = await tx.$queryRaw<
          { count: number; running: boolean }[]
        >`SELECT count(*)::int AS count,
          coalesce(bool_or(response->>'state'='checking' AND (response->>'expiresAt')::timestamptz>clock_timestamp()),false) AS running
          FROM email_workspace_operations WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid
          AND response->>'kind'='DOMAIN_CHECK' AND created_at>clock_timestamp()-interval '1 hour'`;
        if (counts[0]!.running) throw new ConflictException('A domain check is already running.');
        if (counts[0]!.count >= 10)
          throw new HttpException('Ten domain checks per hotel per rolling hour are allowed.', 429);
        const now = new Date(),
          operation: Operation = {
            kind: 'DOMAIN_CHECK',
            id: randomUUID(),
            domain,
            version: profile.version + 1,
            state: 'checking',
            startedAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + 70_000).toISOString(),
            completedAt: null,
            registrationAttempted: false,
            dmarc: null,
            providerId: null,
            records: [],
            message: 'Checking the saved domain. Current sending is unchanged.',
          };
        await tx.$executeRaw`INSERT INTO email_sending_profiles(tenant_id,property_id,version) VALUES(${scope.tenantId}::uuid,${scope.propertyId}::uuid,${operation.version})
          ON CONFLICT(tenant_id,property_id) DO UPDATE SET version=email_sending_profiles.version+1,updated_at=now()`;
        claimed = { profile, apiKey };
        return {
          response: operation,
          details: {
            operationId: operation.id,
            domain,
            reason,
            allowCreate,
            version: operation.version,
          },
        };
      },
    );
    if (!claimed) return operationView(reserved);
    const claim = claimed,
      provider = new ResendSendingDomainProvider(claim.apiKey);
    let evidence: SendingDomainEvidence | undefined,
      state = 'failed',
      message =
        'Domain evidence is unavailable. Check the provider key permissions and saved domain.',
      registrationAttempted = false,
      creating = false;
    try {
      const existing = await provider.findDomain(reserved.domain);
      if (existing) {
        evidence = await provider.getDomain(existing.id, reserved.domain);
      } else if (claim.profile.mode === 'DEFAULT') {
        state = 'not_found';
        message =
          'The default MUST sender domain was not found. Contact platform support; hotel staff cannot register or change it.';
      } else if (!allowCreate) {
        state = 'not_found';
        message =
          'This domain is not in the connected Resend account. Register it here or add it in Resend, then check again.';
      } else {
        await this.beginRegistration(scope, userId, reserved, claim.profile, key!, reason);
        registrationAttempted = true;
        creating = true;
        evidence = await provider.createDomain(reserved.domain);
        creating = false;
      }
      if (
        evidence &&
        claim.profile.mode === 'RESEND' &&
        !(evidence.verified && evidence.sendingEnabled) &&
        Date.now() + 35_000 < Date.parse(reserved.expiresAt)
      ) {
        await this.assertCurrent(scope, reserved, claim.profile);
        evidence = await provider.recheckDomain(evidence.id, reserved.domain);
      }
      if (evidence) {
        state = evidence.verified && evidence.sendingEnabled ? 'verified' : 'pending';
        message =
          state === 'verified'
            ? claim.profile.mode === 'DEFAULT'
              ? 'The provider verified the default MUST sender domain.'
              : 'The provider verified this sending domain. Custom sending is not yet activated.'
            : claim.profile.mode === 'DEFAULT'
              ? 'The shared MUST domain needs DNS attention. Contact platform support; hotel staff cannot change it.'
              : 'Publish the exact DNS records below, then check the domain again.';
      }
    } catch (error) {
      if (
        creating &&
        error instanceof SendingDomainProviderError &&
        !error.uncertain &&
        error.status &&
        error.status >= 400 &&
        error.status < 500
      )
        registrationAttempted = false;
      state =
        error instanceof ConflictException
          ? 'stale'
          : registrationAttempted ||
              (error instanceof SendingDomainProviderError && error.uncertain)
            ? 'unknown'
            : 'failed';
      message =
        error instanceof ConflictException
          ? error.message
          : state === 'unknown'
            ? 'Registration may have succeeded. Check the existing domain in Resend; a second registration is blocked until evidence is reconciled.'
            : 'Domain evidence is unavailable. Check the provider key permissions and saved domain, then try again.';
    }
    const dmarc = evidence ? await readDmarcPublication(reserved.domain) : null;
    return this.db.withTenantTransaction(scope, async (tx) => {
      await tx.$queryRaw`SELECT id FROM properties WHERE tenant_id=${scope.tenantId}::uuid AND id=${scope.propertyId}::uuid FOR UPDATE`;
      const profile = await this.profile(tx, scope);
      const stale =
        !this.sameBinding(profile, claim.profile) ||
        Date.now() >= Date.parse(reserved.expiresAt) ||
        (profile.mode === 'DEFAULT' &&
          (defaultDomain() !== reserved.domain ||
            process.env.RESEND_API_KEY?.trim() !== claim.apiKey));
      const result: Operation = {
        ...reserved,
        dmarc,
        registrationAttempted,
        providerId: evidence?.id ?? null,
        records: evidence?.records ?? [],
        completedAt: new Date().toISOString(),
        version: profile.version + (stale ? 0 : 1),
        state: stale ? 'stale' : state,
        message: stale
          ? 'Sender setup changed or the check expired. Check the saved domain again.'
          : message,
      };
      if (!stale)
        await tx.$executeRaw`UPDATE email_sending_profiles SET version=version+1,domain_status=${state},domain_checked_at=now(),dns_records=${JSON.stringify(result.records)}::jsonb,dmarc_evidence=${dmarc === null ? null : JSON.stringify(dmarc)}::jsonb,updated_at=now()
        WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid`;
      await this.audit.recordInTransaction(tx, {
        ...scope,
        actorUserId: userId,
        action: 'email_configuration.domain_check.completed',
        targetType: 'email',
        targetId: scope.propertyId,
        details: {
          operationId: reserved.id,
          domain: reserved.domain,
          state: result.state,
          providerId: result.providerId,
          registrationAttempted,
          version: result.version,
          reason,
        },
      });
      await tx.$executeRaw`UPDATE email_workspace_operations SET response=${JSON.stringify(result)}::jsonb WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid
        AND idempotency_key=${key!} AND response->>'id'=${reserved.id} AND response->>'kind'='DOMAIN_CHECK'`;
      return result;
    });
  }

  private sameBinding(a: Profile, b: Profile) {
    return (
      emailSendingCredentialBinding(a).endpoint === emailSendingCredentialBinding(b).endpoint &&
      a.credentialRevision === b.credentialRevision
    );
  }
  private async assertCurrent(scope: EmailContext, operation: Operation, expected: Profile) {
    return this.db.withTenantTransaction(scope, async (tx) => {
      const current = await this.profile(tx, scope);
      if (
        !this.sameBinding(current, expected) ||
        Date.now() + 35_000 >= Date.parse(operation.expiresAt)
      )
        throw new ConflictException(
          'Sender setup changed or the check deadline was reached. Check the saved domain again.',
        );
    });
  }
  private async beginRegistration(
    scope: EmailContext,
    userId: string,
    operation: Operation,
    expected: Profile,
    key: string,
    reason: string,
  ) {
    await this.db.withTenantTransaction(scope, async (tx) => {
      await tx.$queryRaw`SELECT id FROM properties WHERE tenant_id=${scope.tenantId}::uuid AND id=${scope.propertyId}::uuid FOR UPDATE`;
      if (
        !this.sameBinding(await this.profile(tx, scope), expected) ||
        Date.now() + 45_000 >= Date.parse(operation.expiresAt)
      )
        throw new ConflictException(
          'Sender setup changed or registration deadline was reached. Check again.',
        );
      const prior = await tx.$queryRaw<
        { id: string }[]
      >`SELECT response->>'id' AS id FROM email_workspace_operations WHERE tenant_id=${scope.tenantId}::uuid
        AND property_id=${scope.propertyId}::uuid AND response->>'kind'='DOMAIN_CHECK' AND response->>'domain'=${operation.domain}
        AND response->>'registrationAttempted'='true' LIMIT 1`;
      if (prior.length)
        throw new ConflictException(
          'A prior registration may already exist. Add or check the exact domain in Resend, then refresh here.',
        );
      await this.audit.recordInTransaction(tx, {
        ...scope,
        actorUserId: userId,
        action: 'email_configuration.domain_registration.started',
        targetType: 'email',
        targetId: scope.propertyId,
        details: { operationId: operation.id, domain: operation.domain, reason },
      });
      await tx.$executeRaw`UPDATE email_workspace_operations SET response=jsonb_set(response,'{registrationAttempted}','true'::jsonb)
        WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND idempotency_key=${key}
        AND response->>'id'=${operation.id} AND response->>'state'='checking'`;
    });
  }
}
