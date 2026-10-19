import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EMAIL_TEMPLATES,
  isEmailTemplateKey,
  type EmailTemplateKey,
  type SavedTemplate,
} from '../mail/email-templates';
import { AuditLogService } from './audit-log.service';
import { EmailTemplatesService } from './email-templates.service';
import { emailWrite, type EmailContext } from './email-workspace-writes';
import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';

type Revision = SavedTemplate & { revision: number; actorUserId: string; createdAt: string };
type Head = { version: number; liveRevision: number | null; draftRevision: number | null };
type Locale = 'en' | 'sq';
export type TemplateVersions = {
  key: EmailTemplateKey;
  language: Locale;
  version: number;
  live: SavedTemplate | null;
  draft: Revision | null;
  history: Revision[];
};

/** One draft and one published version per hotel/template/locale; history retains wording. */
@Injectable()
export class EmailTemplateVersionsService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(EmailTemplatesService) private readonly templates: EmailTemplatesService,
  ) {}

  list(context: EmailContext, key: string, language: unknown): Promise<TemplateVersions> {
    const input = this.identity(key, language);
    return this.database.withTenantTransaction(context, (tx) =>
      this.read(tx, context, input.key, input.language),
    );
  }

  async mutate(
    context: EmailContext,
    actorUserId: string,
    key: string,
    operation: 'draft' | 'publish' | 'restore',
    raw: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<TemplateVersions> {
    const identity = this.identity(key, raw.language);
    if (!Number.isSafeInteger(raw.version) || Number(raw.version) < 0)
      throw new BadRequestException('A nonnegative version is required.');
    const draft = operation === 'draft' ? this.templates.validate(identity.key, raw) : null;
    if (
      operation === 'restore' &&
      (!Number.isSafeInteger(raw.revision) || Number(raw.revision) < 0)
    )
      throw new BadRequestException('A recorded revision is required.');
    const input = {
      ...identity,
      version: raw.version,
      operation,
      ...(draft ?? {}),
      ...(operation === 'restore' ? { revision: raw.revision } : {}),
    };
    return emailWrite(
      this.database,
      this.audit,
      context,
      actorUserId,
      idempotencyKey,
      `email_template.${operation}`,
      `${key}/${identity.language}`,
      input,
      async (tx) => {
        const before = await this.read(tx, context, identity.key, identity.language);
        if (before.version !== raw.version)
          throw new ConflictException('The template changed. Reload before saving.');
        await tx.$executeRaw`
          INSERT INTO email_template_heads(tenant_id,property_id,template_key,language)
          VALUES(${context.tenantId}::uuid,${context.propertyId}::uuid,${identity.key},${identity.language}) ON CONFLICT DO NOTHING
        `;
        if (!before.history.length && before.live) {
          await tx.$executeRaw`INSERT INTO email_template_revisions(tenant_id,property_id,template_key,language,revision,subject,body,actor_user_id) VALUES(${context.tenantId}::uuid,${context.propertyId}::uuid,${identity.key},${identity.language},0,${before.live.subject},${before.live.body},${actorUserId}::uuid) ON CONFLICT DO NOTHING`;
          await tx.$executeRaw`UPDATE email_template_heads SET live_revision=0 WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND template_key=${identity.key} AND language=${identity.language}`;
        }
        const nextVersion = before.version + 1;
        if (operation === 'publish') {
          if (!before.draft) throw new BadRequestException('Save a draft before publishing.');
          const missing = requiredTemplateVariables(identity.key).filter(
            (name) => !`${before.draft!.subject} ${before.draft!.body}`.includes(`{${name}}`),
          );
          if (missing.length)
            throw new BadRequestException(
              `Required variables: ${missing.map((name) => `{${name}}`).join(', ')}.`,
            );
          await tx.$executeRaw`
            INSERT INTO email_templates(tenant_id,property_id,template_key,language,subject,body,updated_by_user_id)
            VALUES(${context.tenantId}::uuid,${context.propertyId}::uuid,${identity.key},${identity.language},${before.draft.subject},${before.draft.body},${actorUserId}::uuid)
            ON CONFLICT(tenant_id,property_id,template_key,language) DO UPDATE SET subject=EXCLUDED.subject,body=EXCLUDED.body,updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=now()
          `;
          await tx.$executeRaw`
            UPDATE email_template_heads SET live_revision=draft_revision,draft_revision=NULL,version=${nextVersion}
            WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND template_key=${identity.key} AND language=${identity.language}
          `;
        } else {
          const wording = draft ?? before.history.find((item) => item.revision === raw.revision);
          if (!wording) throw new NotFoundException('Revision was not found.');
          await tx.$executeRaw`
            INSERT INTO email_template_revisions(tenant_id,property_id,template_key,language,revision,subject,body,actor_user_id)
            VALUES(${context.tenantId}::uuid,${context.propertyId}::uuid,${identity.key},${identity.language},${nextVersion},${wording.subject},${wording.body},${actorUserId}::uuid)
          `;
          await tx.$executeRaw`
            UPDATE email_template_heads SET draft_revision=${nextVersion},version=${nextVersion}
            WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND template_key=${identity.key} AND language=${identity.language}
          `;
        }
        const after = await this.read(tx, context, identity.key, identity.language);
        return {
          response: after,
          details: {
            language: identity.language,
            before: { version: before.version, live: before.live, draft: before.draft },
            after: { version: after.version, live: after.live, draft: after.draft },
          },
        };
      },
    );
  }

  private identity(key: string, language: unknown): { key: EmailTemplateKey; language: Locale } {
    if (!isEmailTemplateKey(key)) throw new NotFoundException('Template was not found.');
    if (language !== undefined && language !== 'en' && language !== 'sq')
      throw new BadRequestException('Language must be en or sq.');
    return { key, language: language === 'sq' ? 'sq' : 'en' };
  }

  private async read(
    tx: TenantTransaction,
    context: EmailContext,
    key: EmailTemplateKey,
    language: Locale,
  ): Promise<TemplateVersions> {
    const heads = await tx.$queryRaw<Head[]>`
      SELECT version,live_revision AS "liveRevision",draft_revision AS "draftRevision" FROM email_template_heads
      WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND template_key=${key} AND language=${language}
    `;
    const head = heads[0];
    const history = await tx.$queryRaw<Revision[]>`
      SELECT revision,subject,body,actor_user_id::text AS "actorUserId",created_at::text AS "createdAt" FROM email_template_revisions
      WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND template_key=${key} AND language=${language} ORDER BY revision DESC
    `;
    const saved = await tx.$queryRaw<SavedTemplate[]>`
      SELECT subject,body FROM email_templates WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND template_key=${key} AND language=${language}
    `;
    return {
      key,
      language,
      version: head?.version ?? 0,
      live:
        history.find((row) => row.revision === head?.liveRevision) ??
        saved[0] ??
        (language === 'en'
          ? { subject: EMAIL_TEMPLATES[key].subject, body: EMAIL_TEMPLATES[key].body }
          : null),
      draft: history.find((row) => row.revision === head?.draftRevision) ?? null,
      history,
    };
  }
}

/** Protected detail blocks remain generated; these semantic variables cannot be lost in publication. */
export function requiredTemplateVariables(key: EmailTemplateKey): string[] {
  return [
    'guest_name',
    ...(key === 'booking_confirmed' ? ['payment_note'] : []),
    ...(key === 'refund_processed' ? ['refund_amount'] : []),
  ];
}
