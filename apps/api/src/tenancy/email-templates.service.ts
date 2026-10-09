import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
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
      return (Object.keys(EMAIL_TEMPLATES) as EmailTemplateKey[]).map((key) =>
        this.view(key, saved.find((row) => row.key === key) ?? null),
      );
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

  /** Sends the preview to the signed-in person's own address. */
  async sendTest(
    context: Context,
    userId: string,
    key: string,
    body: object,
  ): Promise<{ sentTo: string }> {
    const templateKey = this.requireKey(key);
    const draft = this.hasDraft(body) ? this.validate(templateKey, body) : null;
    const work = await this.database.withTenantTransaction(context, async (tx) => {
      const users = await tx.$queryRaw<Array<{ email: string }>>`
        SELECT email FROM users WHERE id = ${userId}::uuid
      `;
      if (!users[0]) throw new NotFoundException('User was not found.');
      const brand = await this.brand(tx, context);
      return {
        to: users[0].email,
        brand,
        preview: this.render(
          templateKey,
          draft ?? (await savedTemplate(tx, context, templateKey)),
          brand,
        ),
      };
    });
    await this.delivery.dispatch(
      'rendered',
      {
        eventType: 'template.test',
        to: work.to,
        subject: `[Test] ${work.preview.subject}`,
        html: work.preview.html,
        text: work.preview.text,
        idempotencyKey: `template-test/${templateKey}/${randomUUID()}`,
        bookingId: null,
        replyTo: work.brand.supportEmail ?? null,
      },
      context,
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

  private validate(key: EmailTemplateKey, body: object): SavedTemplate {
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

  private async brand(tx: TenantTransaction, context: Context): Promise<MailBrand> {
    const rows = await tx.$queryRaw<MailBrand[]>`
      SELECT name, logo_url AS "logoUrl", support_email AS "supportEmail", phone,
        public_website_origin AS "websiteUrl", address
      FROM properties WHERE tenant_id = ${context.tenantId}::uuid AND id = ${context.propertyId}::uuid
    `;
    if (!rows[0]) throw new NotFoundException('Property was not found.');
    return rows[0];
  }
}
