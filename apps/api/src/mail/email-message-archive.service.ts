import { Inject, Injectable, Logger } from '@nestjs/common';
import { CredentialCipherService } from '../integrations/credential-cipher';
import { TenantDatabaseService, type TenantTransaction } from '../tenancy/tenant-database.service';
import { currentMailAttempt } from './mail-attempt-context';
import { safeEmailPreview } from './email-preview-safety';

type Scope = { tenantId: string; propertyId: string };
/** Seven-day encrypted, redacted prepared-message evidence; never a source for sending mail. */
@Injectable()
export class EmailMessageArchiveService {
  private readonly logger = new Logger(EmailMessageArchiveService.name);
  constructor(
    @Inject(TenantDatabaseService) private readonly db: TenantDatabaseService,
    @Inject(CredentialCipherService) private readonly cipher: CredentialCipherService,
  ) {}
  async capture(message: { subject: string; html: string; text: string }): Promise<void> {
    const context = currentMailAttempt();
    if (!context?.tenantId || !context.propertyId || context.sensitive) return;
    try {
      if (Buffer.byteLength(JSON.stringify(message), 'utf8') > 300_000) return;
      const preview = safeEmailPreview(message);
      const encrypted = this.cipher.encrypt({
        tenantId: context.tenantId,
        propertyId: context.propertyId,
        messageId: context.messageId,
        ...preview,
      });
      const scope = { tenantId: context.tenantId, propertyId: context.propertyId };
      await this.db.withTenantTransaction(
        scope,
        (tx) => tx.$executeRaw`
        INSERT INTO email_message_previews(tenant_id,property_id,message_id,encrypted_preview,expires_at)
        SELECT tenant_id,property_id,id,${encrypted},created_at+interval '7 days' FROM email_messages
        WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND id=${context.messageId}::uuid AND created_at>now()-interval '7 days' AND created_at<=now()
        ON CONFLICT(tenant_id,property_id,message_id) DO NOTHING`,
      );
    } catch {
      // Preview retention must not fail or duplicate an otherwise valid transactional email.
      this.logger.warn('Encrypted email preview retention was unavailable; sending continues.');
    }
  }
  async read(scope: Scope, messageId: string, tx?: TenantTransaction) {
    const query = (transaction: TenantTransaction) => transaction.$queryRaw<
      { encrypted: string; capturedAt: Date; expiresAt: Date }[]
    >`
      SELECT encrypted_preview AS encrypted,captured_at AS "capturedAt",expires_at AS "expiresAt" FROM email_message_previews
      WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND message_id=${messageId}::uuid AND expires_at>now()`;
    const row = (await (tx ? query(tx) : this.db.withTenantTransaction(scope, query)))[0];
    if (!row) return null;
    try {
      const payload = this.cipher.decrypt(row.encrypted);
      if (
        payload.tenantId !== scope.tenantId ||
        payload.propertyId !== scope.propertyId ||
        payload.messageId !== messageId ||
        !['subject', 'html', 'text'].every((key) => typeof payload[key] === 'string')
      )
        return null;
      return {
        ...safeEmailPreview({ subject: payload.subject, html: payload.html, text: payload.text }),
        capturedAt: row.capturedAt,
        expiresAt: row.expiresAt,
      };
    } catch {
      return null;
    }
  }
  cleanup(scope: Scope, now = new Date()) {
    return this.db.withTenantTransaction(
      scope,
      (tx) =>
        tx.$executeRaw`DELETE FROM email_message_previews WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND expires_at<=${now}`,
    );
  }
}
