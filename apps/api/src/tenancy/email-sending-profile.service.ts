import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import {
  EmailTransportCredentialService,
  type EmailTransportCredentials,
} from '../mail/email-transport-credentials';
import { smtpHostname } from '../mail/smtp-network-policy';
import { AuditLogService } from './audit-log.service';
import { emailWrite, type EmailContext } from './email-workspace-writes';
import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';

type Mode = 'DEFAULT' | 'RESEND' | 'SMTP';
type ProfileRow = {
  version: number;
  mode: Mode;
  activeMode: Mode;
  fromName: string | null;
  fromAddress: string | null;
  domain: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecurity: 'TLS' | 'STARTTLS' | null;
  encryptedCredentials: string | null;
  credentialRevision: string | null;
  fallbackGuest: boolean;
  fromVerifiedAt: Date | null;
  connectionCheckedAt: Date | null;
  domainCheckedAt: Date | null;
  domainStatus: string;
  dnsRecords: unknown[];
};
const defaults = (): ProfileRow => ({
  version: 1,
  mode: 'DEFAULT',
  activeMode: 'DEFAULT',
  fromName: null,
  fromAddress: null,
  domain: null,
  smtpHost: null,
  smtpPort: null,
  smtpSecurity: null,
  encryptedCredentials: null,
  credentialRevision: null,
  fallbackGuest: true,
  fromVerifiedAt: null,
  connectionCheckedAt: null,
  domainCheckedAt: null,
  domainStatus: 'unknown',
  dnsRecords: [],
});
const allowed = new Set([
  'version',
  'reason',
  'mode',
  'fromName',
  'fromAddress',
  'domain',
  'smtpHost',
  'smtpPort',
  'smtpSecurity',
  'fallbackGuest',
  'credentials',
]);
const email = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

function publicProfile(row: ProfileRow) {
  const { encryptedCredentials, credentialRevision, ...safe } = row;
  void credentialRevision;
  return { ...safe, credentialsPresent: !!encryptedCredentials };
}
function binding(
  row: Pick<
    ProfileRow,
    | 'mode'
    | 'fromAddress'
    | 'domain'
    | 'smtpHost'
    | 'smtpPort'
    | 'smtpSecurity'
    | 'credentialRevision'
  >,
) {
  return {
    revision: row.credentialRevision ?? '',
    endpoint: JSON.stringify({
      mode: row.mode,
      fromAddress: row.fromAddress,
      domain: row.domain,
      smtpHost: row.smtpHost,
      smtpPort: row.smtpPort,
      smtpSecurity: row.smtpSecurity,
    }),
  };
}

/** Versioned encrypted setup; saving an unverified custom sender does not activate it. */
@Injectable()
export class EmailSendingProfileService {
  constructor(
    @Inject(TenantDatabaseService) private readonly db: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(EmailTransportCredentialService)
    private readonly credentials: EmailTransportCredentialService,
  ) {}
  async get(scope: EmailContext) {
    return this.db.withTenantTransaction(scope, async (tx) =>
      publicProfile(await this.read(tx, scope)),
    );
  }
  private async read(tx: TenantTransaction, scope: EmailContext): Promise<ProfileRow> {
    const property = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM properties WHERE tenant_id=${scope.tenantId}::uuid AND id=${scope.propertyId}::uuid`;
    if (!property[0]) throw new NotFoundException('Property was not found.');
    const rows = await tx.$queryRaw<
      ProfileRow[]
    >`SELECT version,mode,active_mode AS "activeMode",from_name AS "fromName",from_address AS "fromAddress",domain,
      smtp_host AS "smtpHost",smtp_port AS "smtpPort",smtp_security AS "smtpSecurity",encrypted_credentials AS "encryptedCredentials",credential_revision::text AS "credentialRevision",
      fallback_guest AS "fallbackGuest",from_verified_at AS "fromVerifiedAt",connection_checked_at AS "connectionCheckedAt",domain_checked_at AS "domainCheckedAt",
      domain_status AS "domainStatus",dns_records AS "dnsRecords" FROM email_sending_profiles WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid`;
    return rows[0] ?? defaults();
  }
  async update(scope: EmailContext, userId: string, body: Record<string, unknown>, key?: string) {
    if (
      Object.keys(body).some((field) => !allowed.has(field)) ||
      !Number.isSafeInteger(body.version) ||
      Number(body.version) < 1 ||
      typeof body.mode !== 'string' ||
      !['DEFAULT', 'RESEND', 'SMTP'].includes(body.mode) ||
      typeof body.fallbackGuest !== 'boolean' ||
      typeof body.reason !== 'string' ||
      body.reason.trim().length < 3 ||
      body.reason.trim().length > 300
    )
      throw new BadRequestException(
        'Use a valid sender mode, version, fallback choice and reason (3-300 characters).',
      );
    const next = defaults();
    next.mode = body.mode as Mode;
    next.fallbackGuest = body.fallbackGuest;
    if (body.fromName !== null && body.fromName !== undefined) {
      if (
        typeof body.fromName !== 'string' ||
        !body.fromName.trim() ||
        body.fromName.trim().length > 100 ||
        /[\r\n<>\0]/.test(body.fromName)
      )
        throw new BadRequestException(
          'Use a sender name of 1-100 characters, or null to inherit the hotel name.',
        );
      next.fromName = body.fromName.trim();
    }
    if (next.mode !== 'DEFAULT') {
      if (
        typeof body.fromAddress !== 'string' ||
        body.fromAddress.length > 254 ||
        !email.test(body.fromAddress.trim())
      )
        throw new BadRequestException('Use a valid From email address.');
      next.fromAddress = body.fromAddress.trim().toLowerCase();
    }
    if (next.mode === 'RESEND') {
      if (typeof body.domain !== 'string')
        throw new BadRequestException('A sending domain is required.');
      try {
        next.domain = smtpHostname(body.domain);
      } catch {
        throw new BadRequestException('Use a public sending domain name.');
      }
      if (next.fromAddress!.split('@')[1] !== next.domain)
        throw new BadRequestException('From must belong to the exact sending domain.');
    }
    if (next.mode === 'SMTP') {
      if (typeof body.smtpHost !== 'string')
        throw new BadRequestException('An SMTP hostname is required.');
      try {
        next.smtpHost = smtpHostname(body.smtpHost);
      } catch {
        throw new BadRequestException('Use a public SMTP hostname.');
      }
      if (
        ![465, 587, 2525].includes(Number(body.smtpPort)) ||
        typeof body.smtpPort !== 'number' ||
        (body.smtpPort === 465 ? body.smtpSecurity !== 'TLS' : body.smtpSecurity !== 'STARTTLS')
      )
        throw new BadRequestException('Use TLS on port 465 or required STARTTLS on port 587/2525.');
      next.smtpPort = body.smtpPort;
      next.smtpSecurity = body.smtpSecurity as 'TLS' | 'STARTTLS';
    }
    let replacement: EmailTransportCredentials | undefined;
    if (body.credentials !== undefined) {
      if (
        next.mode === 'DEFAULT' ||
        !body.credentials ||
        typeof body.credentials !== 'object' ||
        Array.isArray(body.credentials)
      )
        throw new BadRequestException(
          'Supply replacement credentials for the selected custom sender.',
        );
      const c = body.credentials as Record<string, unknown>;
      if (next.mode === 'RESEND' && Object.keys(c).length === 1 && typeof c.apiKey === 'string')
        replacement = { provider: 'resend', apiKey: c.apiKey };
      else if (
        next.mode === 'SMTP' &&
        Object.keys(c).length === 2 &&
        typeof c.username === 'string' &&
        typeof c.password === 'string'
      )
        replacement = { provider: 'smtp', username: c.username, password: c.password };
      else
        throw new BadRequestException(
          'Replace the complete credentials for the selected custom sender.',
        );
    }
    // Only a keyed fingerprint reaches the operation hash, never a raw password or an offline-guessable password hash.
    const reason = body.reason.trim();
    const intent = {
      version: body.version,
      reason,
      mode: next.mode,
      fromName: next.fromName,
      fromAddress: next.fromAddress,
      domain: next.domain,
      smtpHost: next.smtpHost,
      smtpPort: next.smtpPort,
      smtpSecurity: next.smtpSecurity,
      fallbackGuest: next.fallbackGuest,
    };
    let credentialFingerprint: string | undefined;
    if (replacement) {
      const configured = process.env.INTEGRATION_CREDENTIALS_KEY ?? '';
      const secret = Buffer.from(configured, 'base64');
      if (secret.length !== 32)
        throw new BadRequestException('Sending credential encryption is unavailable.');
      credentialFingerprint = createHmac('sha256', secret)
        .update(JSON.stringify({ scope, replacement }))
        .digest('hex');
    }
    return emailWrite(
      this.db,
      this.audit,
      scope,
      userId,
      key,
      'email_configuration.sending',
      scope.propertyId,
      { ...intent, credentialFingerprint },
      async (tx) => {
        const before = await this.read(tx, scope);
        if (before.version !== body.version)
          throw new ConflictException('Sending configuration changed. Reload before saving.');
        const unchanged = binding(before).endpoint === binding(next).endpoint;
        if (next.mode !== 'DEFAULT') {
          if (replacement) {
            next.credentialRevision = randomUUID();
            try {
              next.encryptedCredentials = this.credentials.seal(scope, binding(next), replacement);
            } catch {
              throw new BadRequestException(
                'Use valid replacement credentials and configured encryption.',
              );
            }
          } else {
            if (!unchanged || !before.encryptedCredentials || !before.credentialRevision)
              throw new BadRequestException(
                'Changing the sender endpoint or From address requires complete replacement credentials.',
              );
            try {
              this.credentials.open(scope, binding(before), before.encryptedCredentials);
            } catch {
              throw new BadRequestException(
                'Stored sending credentials are unavailable. Replace them and verify the sender again.',
              );
            }
            next.encryptedCredentials = before.encryptedCredentials;
            next.credentialRevision = before.credentialRevision;
          }
        }
        if (unchanged && !replacement) {
          next.activeMode = before.activeMode;
          next.fromVerifiedAt = before.fromVerifiedAt;
          next.connectionCheckedAt = before.connectionCheckedAt;
          next.domainCheckedAt = before.domainCheckedAt;
          next.domainStatus = before.domainStatus;
          next.dnsRecords = before.dnsRecords;
        }
        next.version = before.version + 1;
        await tx.$executeRaw`INSERT INTO email_sending_profiles(tenant_id,property_id,version,mode,active_mode,from_name,from_address,domain,smtp_host,smtp_port,smtp_security,
        encrypted_credentials,credential_revision,fallback_guest,from_verified_at,connection_checked_at,domain_checked_at,domain_status,dns_records)
        VALUES(${scope.tenantId}::uuid,${scope.propertyId}::uuid,${next.version},${next.mode},${next.activeMode},${next.fromName},${next.fromAddress},${next.domain},${next.smtpHost},${next.smtpPort},${next.smtpSecurity},
        ${next.encryptedCredentials},${next.credentialRevision}::uuid,${next.fallbackGuest},${next.fromVerifiedAt},${next.connectionCheckedAt},${next.domainCheckedAt},${next.domainStatus},${JSON.stringify(next.dnsRecords)}::jsonb)
        ON CONFLICT(tenant_id,property_id) DO UPDATE SET version=EXCLUDED.version,mode=EXCLUDED.mode,active_mode=EXCLUDED.active_mode,from_name=EXCLUDED.from_name,from_address=EXCLUDED.from_address,domain=EXCLUDED.domain,
        smtp_host=EXCLUDED.smtp_host,smtp_port=EXCLUDED.smtp_port,smtp_security=EXCLUDED.smtp_security,encrypted_credentials=EXCLUDED.encrypted_credentials,credential_revision=EXCLUDED.credential_revision,
        fallback_guest=EXCLUDED.fallback_guest,from_verified_at=EXCLUDED.from_verified_at,connection_checked_at=EXCLUDED.connection_checked_at,domain_checked_at=EXCLUDED.domain_checked_at,domain_status=EXCLUDED.domain_status,dns_records=EXCLUDED.dns_records,updated_at=now()`;
        return {
          response: publicProfile(next),
          details: {
            before: publicProfile(before),
            after: publicProfile(next),
            credentialsReplaced: !!replacement,
            reason,
          },
        };
      },
    );
  }
}
