import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  Inject,
  Injectable,
  Param,
  Put,
  Req,
} from '@nestjs/common';
import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { EMAIL_TEMPLATES } from '../mail/email-templates';
import { parseReviewLinks } from '../mail/review-links';
import { AuditLogService } from './audit-log.service';
import { RequiresCapability } from './capabilities.decorator';
import { emailWrite, type EmailContext } from './email-workspace-writes';
import { NotificationSettingsService } from './notification-settings.service';
import { Role, Roles } from './roles.decorator';
import { TenantScoped } from './tenant-context.decorator';
import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';
type Configuration = {
  version: number;
  senderName: string | null;
  replyTo: string | null;
  defaultLanguage: 'en' | 'sq';
};
type Request = { tenantContext: EmailContext & { userId: string } };
@Injectable()
export class EmailConfigurationService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(NotificationSettingsService) private readonly topics: NotificationSettingsService,
  ) {}
  get(context: EmailContext) {
    return this.database.withTenantTransaction(context, (tx) => this.read(tx, context));
  }
  private async read(tx: TenantTransaction, c: EmailContext): Promise<Configuration> {
    const rows = await tx.$queryRaw<
      Configuration[]
    >`SELECT email_configuration_version AS version,email_sender_name AS "senderName",email_reply_to AS "replyTo",email_default_language AS "defaultLanguage" FROM properties WHERE tenant_id=${c.tenantId}::uuid AND id=${c.propertyId}::uuid`;
    if (!rows[0]) throw new BadRequestException('Property was not found.');
    return rows[0];
  }
  update(
    c: EmailContext,
    userId: string,
    kind: 'sender' | 'topic' | 'reviews' | 'preferences',
    target: string,
    body: Record<string, unknown>,
    key?: string,
  ) {
    if (!Number.isSafeInteger(body.version) || Number(body.version) < 1)
      throw new BadRequestException('A positive configuration version is required.');
    return emailWrite(
      this.database,
      this.audit,
      c,
      userId,
      key,
      `email_configuration.${kind}`,
      target,
      body,
      async (tx) => {
        const before = await this.read(tx, c);
        if (kind !== 'preferences' && before.version !== body.version)
          throw new ConflictException('Email settings changed. Reload before saving.');
        if (kind === 'preferences') {
          if (typeof body.muteOptionalEmails !== 'boolean')
            throw new BadRequestException('muteOptionalEmails must be true or false.');
          const membership = await tx.$queryRaw<
            { version: number; mute: boolean }[]
          >`SELECT email_preferences_version AS version,mute_optional_emails AS mute FROM tenant_memberships WHERE tenant_id=${c.tenantId}::uuid AND user_id=${userId}::uuid FOR UPDATE`;
          if (!membership[0] || membership[0].version !== body.version)
            throw new ConflictException('Email preferences changed. Reload before saving.');
          await tx.$executeRaw`UPDATE tenant_memberships SET mute_optional_emails=${body.muteOptionalEmails},email_preferences_version=email_preferences_version+1,updated_at=now() WHERE tenant_id=${c.tenantId}::uuid AND user_id=${userId}::uuid`;
          return {
            response: before,
            details: {
              before: membership[0],
              after: { version: membership[0].version + 1, mute: body.muteOptionalEmails },
              scope: 'personal tenant preference',
            },
          };
        } else if (kind === 'sender') {
          const senderName =
            body.senderName === null
              ? null
              : typeof body.senderName === 'string'
                ? body.senderName.trim()
                : undefined;
          const replyTo =
            body.replyTo === null
              ? null
              : typeof body.replyTo === 'string'
                ? body.replyTo.trim().toLowerCase()
                : undefined;
          if (
            senderName === undefined ||
            replyTo === undefined ||
            senderName?.length === 0 ||
            (senderName?.length ?? 0) > 100 ||
            /[\r\n<>]/.test(senderName ?? '')
          )
            throw new BadRequestException(
              'Use a sender name of 1-100 characters, or null to inherit.',
            );
          if (
            replyTo !== null &&
            (!/^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/.test(replyTo) ||
              replyTo.length > 254)
          )
            throw new BadRequestException('Use a valid reply-to email, or null to inherit.');
          if (body.defaultLanguage !== 'en' && body.defaultLanguage !== 'sq')
            throw new BadRequestException('Default language must be en or sq.');
          if (body.defaultLanguage === 'sq') {
            const translations = await tx.$queryRaw<
              { key: string }[]
            >`SELECT template_key AS key FROM email_templates WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND language='sq'`;
            if (
              Object.keys(EMAIL_TEMPLATES).some(
                (key) => !translations.some((row) => row.key === key),
              )
            )
              throw new BadRequestException(
                'Publish all Albanian guest templates before selecting Albanian as the hotel default.',
              );
          }
          await tx.$executeRaw`UPDATE properties SET email_sender_name=${senderName},email_reply_to=${replyTo},email_default_language=${body.defaultLanguage} WHERE tenant_id=${c.tenantId}::uuid AND id=${c.propertyId}::uuid`;
        } else if (kind === 'topic') {
          await this.topics.updateInTransaction(tx, c.tenantId, c.propertyId, userId, target, body);
        } else {
          const links = parseReviewLinks(body.links);
          await tx.$executeRaw`UPDATE properties SET review_links=${JSON.stringify(links)}::jsonb WHERE tenant_id=${c.tenantId}::uuid AND id=${c.propertyId}::uuid`;
        }
        await tx.$executeRaw`UPDATE properties SET email_configuration_version=email_configuration_version+1,updated_at=now() WHERE tenant_id=${c.tenantId}::uuid AND id=${c.propertyId}::uuid`;
        const after = await this.read(tx, c);
        return { response: after, details: { before, after, target, kind } };
      },
    );
  }
}
@Controller('tenants/:tenantId/properties/:propertyId/email-configuration')
@Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
export class EmailConfigurationController {
  constructor(
    @Inject(EmailConfigurationService) private readonly configuration: EmailConfigurationService,
  ) {}
  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  get(@Req() r: Request) {
    return this.configuration.get(r.tenantContext);
  }
  @Put()
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  sender(
    @Req() r: Request,
    @Body() b: Record<string, unknown>,
    @Headers('idempotency-key') k?: string,
  ) {
    return this.configuration.update(
      r.tenantContext,
      r.tenantContext.userId,
      'sender',
      r.tenantContext.propertyId,
      b ?? {},
      k,
    );
  }
  @Put('topics/:topic')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  topic(
    @Req() r: Request,
    @Param('topic') topic: string,
    @Body() b: Record<string, unknown>,
    @Headers('idempotency-key') k?: string,
  ) {
    return this.configuration.update(
      r.tenantContext,
      r.tenantContext.userId,
      'topic',
      topic,
      b ?? {},
      k,
    );
  }
  @Put('preferences')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  preferences(
    @Req() r: Request,
    @Body() b: Record<string, unknown>,
    @Headers('idempotency-key') k?: string,
  ) {
    return this.configuration.update(
      r.tenantContext,
      r.tenantContext.userId,
      'preferences',
      r.tenantContext.userId,
      b ?? {},
      k,
    );
  }
  @Put('review-links')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  reviews(
    @Req() r: Request,
    @Body() b: Record<string, unknown>,
    @Headers('idempotency-key') k?: string,
  ) {
    return this.configuration.update(
      r.tenantContext,
      r.tenantContext.userId,
      'reviews',
      r.tenantContext.propertyId,
      b ?? {},
      k,
    );
  }
}
