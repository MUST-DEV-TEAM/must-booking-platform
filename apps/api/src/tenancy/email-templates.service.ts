import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { MailBrand } from '@must/domain-contracts';

import { renderBrandedEmail } from '../mail/email-layout';
import {
  EMAIL_TEMPLATES,
  MAX_BODY_LENGTH,
  MAX_SUBJECT_LENGTH,
  TEMPLATE_LANGUAGE,
  isEmailTemplateKey,
  renderTemplate,
  savedTemplate,
  stayTemplateValues,
  unknownPlaceholders,
  type EmailTemplateKey,
  type SavedTemplate,
} from '../mail/email-templates';
import { MailDeliveryService } from '../mail/mail-delivery.service';
import { emailWrite } from './email-workspace-writes';
import { AuditLogService } from './audit-log.service';
import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';

export type EmailTemplateView = {
  key: EmailTemplateKey;
  label: string;
  language: string;
  subject: string;
  body: string;
  /** True when the property saved its own wording; false = the default below. */
  custom: boolean;
  defaultSubject: string;
  defaultBody: string;
  placeholders: string[];
};

export type EmailTemplatePreview = { subject: string; html: string; text: string };

type Context = { tenantId: string; propertyId: string };

/** Example values for previews and test emails. */
const SAMPLE = {
  guestName: 'Ana Smith',
  reference: 'MH-1234',
  startsOn: '2026-07-14',
  endsOn: '2026-07-17',
  roomName: 'Double Room with Sea View',
  guestCount: 2,
};
const SAMPLE_EXTRA = {
  payment_note: "We've received your payment.",
  refund_amount: '120.00 EUR',
};

/** A property's own wording for its guest emails (email plan Step 3). */
@Injectable()
export class EmailTemplatesService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(MailDeliveryService) private readonly delivery: MailDeliveryService,
  ) {}

  list(context: Context): Promise<EmailTemplateView[]> {
    return this.database.withTenantTransaction(context, async (tx) => {
      const saved = await tx.$queryRaw<Array<SavedTemplate & { key: string }>>`
        SELECT template_key AS key, subject, body FROM email_templates
        WHERE tenant_id = ${context.tenantId}::uuid AND property_id = ${context.propertyId}::uuid
          AND language = ${TEMPLATE_LANGUAGE}
      `;
      const heads = await tx.$queryRaw<
        {
          key: string;
          language: string;
          draftRevision: number | null;
          liveRevision: number | null;
          version: number;
        }[]
      >`SELECT template_key AS key,language,draft_revision AS "draftRevision",live_revision AS "liveRevision",version FROM email_template_heads WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid`;
      const topics = await tx.$queryRaw<
        { topic: string; enabled: boolean }[]
      >`SELECT topic,guest_enabled AS enabled FROM notification_topic_settings WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid`;
      return (Object.keys(EMAIL_TEMPLATES) as EmailTemplateKey[]).map((key) => ({
        enabled:
          topics.find(
            (topic) => topic.topic === (key === 'booking_confirmed' ? 'new_booking' : key),
          )?.enabled ?? true,
        ...this.view(key, saved.find((row) => row.key === key) ?? null),
        hasDraft: heads.some((row) => row.key === key && row.draftRevision !== null),
        locales: [
          'en',
          ...(heads.some(
            (row) => row.key === key && row.language === 'sq' && row.liveRevision !== null,
          )
            ? ['sq']
            : []),
        ],
      }));
    });
  }

  update(
    context: Context,
    actorUserId: string,
    key: string,
    body: object,
  ): Promise<EmailTemplateView> {
    const templateKey = this.requireKey(key);
    const input = this.validate(templateKey, body);
    return this.database.withTenantTransaction(context, async (tx) => {
      await this.requireLegacyTemplate(tx, context, templateKey);
      await tx.$executeRaw`
        INSERT INTO email_templates
          (tenant_id, property_id, template_key, language, subject, body, updated_by_user_id)
        VALUES (${context.tenantId}::uuid, ${context.propertyId}::uuid, ${templateKey},
          ${TEMPLATE_LANGUAGE}, ${input.subject}, ${input.body}, ${actorUserId}::uuid)
        ON CONFLICT (tenant_id, property_id, template_key, language) DO UPDATE SET
          subject = EXCLUDED.subject, body = EXCLUDED.body,
          updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = now()
      `;
      await this.audit.recordInTransaction(tx, {
        tenantId: context.tenantId,
        propertyId: context.propertyId,
        actorUserId,
        action: 'email_template.updated',
        targetType: 'email_template',
        targetId: templateKey,
        details: { language: TEMPLATE_LANGUAGE },
      });
      return this.view(templateKey, input);
    });
  }

  /** Back to the default wording. */
  reset(context: Context, actorUserId: string, key: string): Promise<EmailTemplateView> {
    const templateKey = this.requireKey(key);
    return this.database.withTenantTransaction(context, async (tx) => {
      await this.requireLegacyTemplate(tx, context, templateKey);
      await tx.$executeRaw`
        DELETE FROM email_templates
        WHERE tenant_id = ${context.tenantId}::uuid AND property_id = ${context.propertyId}::uuid
          AND template_key = ${templateKey} AND language = ${TEMPLATE_LANGUAGE}
      `;
      await this.audit.recordInTransaction(tx, {
        tenantId: context.tenantId,
        propertyId: context.propertyId,
        actorUserId,
        action: 'email_template.reset',
        targetType: 'email_template',
        targetId: templateKey,
        details: { language: TEMPLATE_LANGUAGE },
      });
      return this.view(templateKey, null);
    });
  }

  /** How a draft (or the saved wording, when no draft is sent) looks with example data. */
  preview(context: Context, key: string, body: object): Promise<EmailTemplatePreview> {
    const templateKey = this.requireKey(key);
    const draft = this.hasDraft(body) ? this.validate(templateKey, body) : null;
    return this.database.withTenantTransaction(context, async (tx) =>
      this.render(
        templateKey,
        draft ?? (await savedTemplate(tx, context, templateKey)),
        await this.brand(tx, context),
      ),
    );
  }

  /** Tests use only the verified actor's own address and a stable, audited send intention. */
  async sendTest(
    context: Context,
    userId: string,
    key: string,
    body: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<{ sentTo: string }> {
    const templateKey = this.requireKey(key);
    const draft = this.hasDraft(body) ? this.validate(templateKey, body) : null;
    const language = body.language ?? 'en';
    if (language !== 'en' && language !== 'sq')
      throw new BadRequestException('Language must be en or sq.');
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason || reason.length > 300)
      throw new BadRequestException('A test reason of 1 to 300 characters is required.');
    if (!Number.isSafeInteger(body.version) || Number(body.version) < 0)
      throw new BadRequestException('A nonnegative version is required.');
    const work = await emailWrite(
      this.database,
      this.audit,
      context,
      userId,
      idempotencyKey,
      'email.test.requested',
      templateKey,
      { templateKey, language, draft, reason, version: body.version },
      async (tx) => {
        const heads = await tx.$queryRaw<{ version: number }[]>`
          SELECT version FROM email_template_heads WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND template_key=${templateKey} AND language=${language}
        `;
        if ((heads[0]?.version ?? 0) !== body.version)
          throw new ConflictException('The template changed. Reload before testing.');
        const users = await tx.$queryRaw<
          { email: string; verified: Date | null }[]
        >`SELECT email,email_verified_at AS verified FROM users WHERE id=${userId}::uuid`;
        if (!users[0]?.verified)
          throw new ForbiddenException('Verify your email before sending a test.');
        const count = await tx.$queryRaw<{ count: number }[]>`
          SELECT count(*)::int AS count FROM audit_logs WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid
          AND actor_user_id=${userId}::uuid AND action='email.test.requested' AND created_at>now()-interval '1 hour'
        `;
        if ((count[0]?.count ?? 0) >= 5)
          throw new HttpException('At most five test emails per person and hotel per hour.', 429);
        const brand = await this.brand(tx, context);
        const preview = this.render(
          templateKey,
          draft ?? (await savedTemplate(tx, context, templateKey)),
          brand,
        );
        const response = {
          to: users[0].email,
          subject: `[TEST] ${preview.subject}`,
          html: preview.html,
          text: preview.text,
          replyTo: brand.replyTo ?? brand.supportEmail ?? null,
          fromName: brand.senderName ?? brand.name ?? null,
        };
        return {
          response,
          details: {
            templateKey,
            language,
            reason,
            recipient: users[0].email,
            version: body.version,
          },
        };
      },
    );
    await this.delivery.dispatch(
      'rendered',
      {
        ...work,
        eventType: 'template.test',
        idempotencyKey: `template-test/${context.propertyId}/${idempotencyKey}`,
        bookingId: null,
      },
      context,
      { preserveIdentity: true },
    );
    return { sentTo: work.to };
  }

  private render(
    key: EmailTemplateKey,
    template: SavedTemplate | null,
    brand: MailBrand,
  ): EmailTemplatePreview {
    const hotelName = brand.name || 'the hotel';
    const message = renderTemplate(key, template, {
      ...stayTemplateValues({ ...SAMPLE, hotelName }),
      ...SAMPLE_EXTRA,
    });
    const rows = [
      { label: 'Booking reference', value: SAMPLE.reference },
      { label: 'Room', value: SAMPLE.roomName },
      { label: 'Dates', value: '14 July 2026 – 17 July 2026 (3 nights)' },
      { label: 'Guests', value: String(SAMPLE.guestCount) },
    ];
    const html = renderBrandedEmail({
      subject: message.subject,
      brand,
      preheader: message.text.split('\n')[0] ?? null,
      heading: EMAIL_TEMPLATES[key].label,
      content: message.html,
      summaryRows: rows,
      summaryHeading: 'Booking details (example)',
      footerNote: 'This is a preview with example booking details.',
    });
    const text = [message.text, '', ...rows.map((row) => `${row.label}: ${row.value}`)].join('\n');
    return { subject: message.subject, html, text };
  }

  private view(key: EmailTemplateKey, saved: SavedTemplate | null): EmailTemplateView {
    const definition = EMAIL_TEMPLATES[key];
    return {
      key,
      label: definition.label,
      language: TEMPLATE_LANGUAGE,
      subject: saved?.subject ?? definition.subject,
      body: saved?.body ?? definition.body,
      custom: saved !== null,
      defaultSubject: definition.subject,
      defaultBody: definition.body,
      placeholders: [...definition.placeholders],
    };
  }

  private requireKey(key: string): EmailTemplateKey {
    if (!isEmailTemplateKey(key)) throw new NotFoundException('Unknown email template.');
    return key;
  }

  private hasDraft(body: object): boolean {
    const value = body as { subject?: unknown; body?: unknown };
    return value.subject !== undefined || value.body !== undefined;
  }

  validate(key: EmailTemplateKey, body: object): SavedTemplate {
    const value = body as { subject?: unknown; body?: unknown };
    if (typeof value.subject !== 'string' || typeof value.body !== 'string')
      throw new BadRequestException('subject and body are required.');
    const subject = value.subject.replace(/[\r\n]+/g, ' ').trim();
    const text = value.body.replace(/\r\n/g, '\n').trim();
    if (!subject || subject.length > MAX_SUBJECT_LENGTH)
      throw new BadRequestException(`The subject must be 1 to ${MAX_SUBJECT_LENGTH} characters.`);
    if (!text || text.length > MAX_BODY_LENGTH)
      throw new BadRequestException(`The message must be 1 to ${MAX_BODY_LENGTH} characters.`);
    const unknown = unknownPlaceholders(key, subject, text);
    if (unknown.length)
      throw new BadRequestException(
        `Unknown placeholder${unknown.length === 1 ? '' : 's'}: ${unknown.map((name) => `{${name}}`).join(', ')}.`,
      );
    return { subject, body: text };
  }

  private async requireLegacyTemplate(
    tx: TenantTransaction,
    context: Context,
    key: EmailTemplateKey,
  ): Promise<void> {
    await tx.$queryRaw`SELECT id FROM properties WHERE tenant_id=${context.tenantId}::uuid AND id=${context.propertyId}::uuid FOR UPDATE`;
    const heads = await tx.$queryRaw<{ live: number | null; draft: number | null }[]>`
      SELECT live_revision AS live,draft_revision AS draft FROM email_template_heads WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND template_key=${key} AND language='en'
    `;
    if (heads.some((head) => head.live !== null || head.draft !== null))
      throw new ConflictException('Use the versioned template editor to change this template.');
    // Compatibility writes invalidate an already-open new editor even before its first draft.
    await tx.$executeRaw`INSERT INTO email_template_heads(tenant_id,property_id,template_key,language,version) VALUES(${context.tenantId}::uuid,${context.propertyId}::uuid,${key},'en',1) ON CONFLICT(tenant_id,property_id,template_key,language) DO UPDATE SET version=email_template_heads.version+1`;
  }

  private async brand(tx: TenantTransaction, context: Context): Promise<MailBrand> {
    const rows = await tx.$queryRaw<MailBrand[]>`
      SELECT name, email_sender_name AS "senderName",email_reply_to AS "replyTo",logo_url AS "logoUrl", support_email AS "supportEmail", phone,
        public_website_origin AS "websiteUrl", address
      FROM properties WHERE tenant_id = ${context.tenantId}::uuid AND id = ${context.propertyId}::uuid
    `;
    if (!rows[0]) throw new NotFoundException('Property was not found.');
    return rows[0];
  }
}
