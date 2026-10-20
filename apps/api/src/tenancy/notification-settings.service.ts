import { recipientEnvelope } from '../mail/recipient-envelope';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  NotificationRecipientRule,
  NotificationSettingsResponse,
  NotificationTopicSettings,
  UpdateNotificationTopicCommand,
} from '@must/domain-contracts';

import { staffRecipients } from '../mail/notification-recipients';
import {
  NOTIFICATION_TOPICS,
  isNotificationTopic,
  isOptionalStaffTopic,
  topicDaysOffset,
  type NotificationTopic,
} from '../mail/notification-topics';
import { AuditLogService } from './audit-log.service';
import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';

const MAX_RULES = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

type RuleRow = {
  topic: string;
  channel?: 'TO' | 'CC' | 'BCC';
  target: NotificationRecipientRule['target'];
  membershipRole: 'OWNER' | 'ADMIN' | null;
  roleTemplateId: string | null;
  userId: string | null;
  email: string | null;
};

/** Whether this person skips the non-urgent staff emails, and which ones those are. */
export type EmailPreferences = {
  version: number;
  muteOptionalEmails: boolean;
  optionalEmails: Array<{ topic: string; label: string }>;
};

/** Per-property choice of who receives each notification (email plan Step 1). */
@Injectable()
export class NotificationSettingsService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  /** The signed-in member's own email preferences in this hotel account. */
  getPreferences(tenantId: string, userId: string): Promise<EmailPreferences> {
    return this.database.withTenantTransaction({ tenantId }, async (tx) =>
      this.preferences(tx, tenantId, userId),
    );
  }

  updatePreferences(tenantId: string, userId: string, body: object): Promise<EmailPreferences> {
    const value = body as { muteOptionalEmails?: unknown };
    if (typeof value.muteOptionalEmails !== 'boolean')
      throw new BadRequestException('muteOptionalEmails must be true or false.');
    const mute = value.muteOptionalEmails;
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      await tx.$executeRaw`
        UPDATE tenant_memberships SET mute_optional_emails = ${mute}, email_preferences_version=email_preferences_version+1, updated_at = now()
        WHERE tenant_id = ${tenantId}::uuid AND user_id = ${userId}::uuid
      `;
      return this.preferences(tx, tenantId, userId);
    });
  }

  private async preferences(
    tx: TenantTransaction,
    tenantId: string,
    userId: string,
  ): Promise<EmailPreferences> {
    const rows = await tx.$queryRaw<Array<{ mute: boolean; version: number }>>`
      SELECT mute_optional_emails AS mute,email_preferences_version AS version FROM tenant_memberships
      WHERE tenant_id = ${tenantId}::uuid AND user_id = ${userId}::uuid
    `;
    if (!rows[0]) throw new NotFoundException('Membership was not found.');
    const topics = Object.keys(NOTIFICATION_TOPICS) as NotificationTopic[];
    return {
      muteOptionalEmails: rows[0].mute,
      version: rows[0].version,
      optionalEmails: topics
        .filter(isOptionalStaffTopic)
        .map((topic) => ({ topic, label: NOTIFICATION_TOPICS[topic].label })),
    };
  }

  get(tenantId: string, propertyId: string): Promise<NotificationSettingsResponse> {
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const topics: NotificationTopicSettings[] = [];
      for (const topic of Object.keys(NOTIFICATION_TOPICS) as NotificationTopic[])
        topics.push(await this.topicSettings(tx, tenantId, propertyId, topic));
      const roleTemplates = await tx.$queryRaw<Array<{ id: string; name: string }>>`
        SELECT id::text, name FROM property_role_templates
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        ORDER BY kind, name
      `;
      const staff = await tx.$queryRaw<NotificationSettingsResponse['options']['staff']>`
        SELECT tm.user_id::text AS "userId", u.email, tm.role::text AS role,
          COALESCE(NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email) AS name
        FROM tenant_memberships tm
        JOIN users u ON u.id = tm.user_id
        WHERE tm.tenant_id = ${tenantId}::uuid
          AND (tm.role IN ('OWNER', 'ADMIN') OR EXISTS (
            SELECT 1 FROM property_staff_assignments psa
            WHERE psa.tenant_id = tm.tenant_id AND psa.property_id = ${propertyId}::uuid
              AND psa.user_id = tm.user_id AND psa.suspended_at IS NULL
          ))
        ORDER BY tm.role, u.email
      `;
      return { topics, options: { roleTemplates, staff } };
    });
  }

  /** Read-only resolution of an unsaved draft, using the production sending resolver. */
  preview(tenantId: string, propertyId: string, topicParam: string, body: unknown) {
    if (!isNotificationTopic(topicParam)) throw new NotFoundException('Unknown notification.');
    const input = this.input(topicParam, body);
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await this.requireTargetsBelongHere(tx, tenantId, propertyId, input.rules);
      const recipients = NOTIFICATION_TOPICS[topicParam].staff
        ? await staffRecipients(tx, { tenantId, propertyId }, topicParam, input)
        : [];
      const suppressions = recipients.length
        ? await tx.$queryRaw<Array<{ email: string; reason: string }>>`
        SELECT recipient AS email, reason FROM email_suppressions
        WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND active
          AND recipient = ANY(${recipients.map(({ email }) => email.toLowerCase())}::text[])
      `
        : [];
      const blocked = new Set(suppressions.map((row) => row.email.toLowerCase()));
      return {
        guest: NOTIFICATION_TOPICS[topicParam].guest && input.guestEnabled,
        staff: recipients
          .filter(({ email }) => !blocked.has(email.toLowerCase()))
          .map(({ email, channel }) => ({ email, ...(channel ? { channel } : {}) })),
        suppressed: suppressions,
      };
    });
  }

  async update(
    tenantId: string,
    propertyId: string,
    actorUserId: string,
    topicParam: string,
    body: unknown,
  ): Promise<NotificationTopicSettings> {
    if (!isNotificationTopic(topicParam)) throw new NotFoundException('Unknown notification.');
    if (
      body &&
      typeof body === 'object' &&
      'rules' in body &&
      Array.isArray(body.rules) &&
      body.rules.some((rule) => rule && typeof rule === 'object' && 'channel' in rule)
    )
      throw new BadRequestException(
        'Use the versioned email-configuration/topics route with an Idempotency-Key to save To/CC/BCC.',
      );
    const topic = topicParam;
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await tx.$queryRaw`SELECT id FROM properties WHERE tenant_id=${tenantId}::uuid AND id=${propertyId}::uuid FOR UPDATE`;
      const result = await this.updateInTransaction(
        tx,
        tenantId,
        propertyId,
        actorUserId,
        topic,
        body,
      );
      await tx.$executeRaw`UPDATE properties SET email_configuration_version=email_configuration_version+1 WHERE tenant_id=${tenantId}::uuid AND id=${propertyId}::uuid`;
      return result;
    });
  }

  async updateInTransaction(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    actorUserId: string,
    topicParam: string,
    body: unknown,
  ): Promise<NotificationTopicSettings> {
    if (!isNotificationTopic(topicParam)) throw new NotFoundException('Unknown notification.');
    const topic = topicParam;
    const input = this.input(topic, body);
    await this.requireTargetsBelongHere(tx, tenantId, propertyId, input.rules);
    if (input.customStaffRecipients && input.staffEnabled && input.rules.length) {
      const resolved = await staffRecipients(tx, { tenantId, propertyId }, topic, input);
      if (resolved.length) {
        try {
          recipientEnvelope(resolved);
        } catch (error) {
          throw new BadRequestException(
            error instanceof Error ? error.message : 'Invalid staff routing.',
          );
        }
      }
    }
    await tx.$executeRaw`
        INSERT INTO notification_topic_settings
          (tenant_id, property_id, topic, guest_enabled, staff_enabled, custom_staff_recipients, days_offset)
        VALUES (${tenantId}::uuid, ${propertyId}::uuid, ${topic}, ${input.guestEnabled},
          ${input.staffEnabled ?? true}, ${input.customStaffRecipients}, ${input.daysOffset ?? null}::smallint)
        ON CONFLICT (tenant_id, property_id, topic) DO UPDATE
        SET guest_enabled = EXCLUDED.guest_enabled,
          staff_enabled = EXCLUDED.staff_enabled,
          custom_staff_recipients = EXCLUDED.custom_staff_recipients,
          days_offset = EXCLUDED.days_offset,
          updated_at = CURRENT_TIMESTAMP
      `;
    await tx.$executeRaw`
        DELETE FROM notification_recipient_rules
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND topic = ${topic}
      `;
    for (const rule of input.rules) {
      await tx.$executeRaw`
          INSERT INTO notification_recipient_rules
            (tenant_id, property_id, topic, target, membership_role, role_template_id, user_id, email, channel)
          VALUES (${tenantId}::uuid, ${propertyId}::uuid, ${topic}, ${rule.target}::"NotificationRecipientTarget",
            ${rule.target === 'MEMBERSHIP_ROLE' ? rule.membershipRole : null}::"TenantMembershipRole",
            ${rule.target === 'ROLE_TEMPLATE' ? rule.roleTemplateId : null}::uuid,
            ${rule.target === 'STAFF_USER' ? rule.userId : null}::uuid,
            ${rule.target === 'EMAIL' ? rule.email : null}, ${rule.channel ?? null})
        `;
    }
    await this.audit.recordInTransaction(tx, {
      tenantId,
      propertyId,
      actorUserId,
      action: 'notification_settings.updated',
      targetType: 'notification_topic',
      targetId: topic,
      details: { ...input },
    });
    return this.topicSettings(tx, tenantId, propertyId, topic);
  }

  private async topicSettings(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    topic: NotificationTopic,
  ): Promise<NotificationTopicSettings> {
    const definition = NOTIFICATION_TOPICS[topic];
    const days = topicDaysOffset(topic);
    const settings = await tx.$queryRaw<
      Array<{
        guestEnabled: boolean;
        staffEnabled: boolean;
        custom: boolean;
        daysOffset: number | null;
      }>
    >`
      SELECT guest_enabled AS "guestEnabled", staff_enabled AS "staffEnabled",
        custom_staff_recipients AS custom, days_offset AS "daysOffset"
      FROM notification_topic_settings
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND topic = ${topic}
    `;
    const rows = await tx.$queryRaw<RuleRow[]>`
      SELECT topic, target::text AS target, membership_role::text AS "membershipRole",
        role_template_id::text AS "roleTemplateId", user_id::text AS "userId", email, channel
      FROM notification_recipient_rules
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND topic = ${topic}
      ORDER BY created_at, id
    `;
    return {
      topic,
      label: definition.label,
      hasGuestEmail: definition.guest,
      hasStaffEmail: definition.staff,
      guestEnabled: definition.guest && (settings[0]?.guestEnabled ?? true),
      staffEnabled: definition.staff && (settings[0]?.staffEnabled ?? true),
      customStaffRecipients: settings[0]?.custom ?? false,
      staffDeliveryMode:
        settings[0]?.custom && rows.some((row) => row.channel) ? 'HEADERS' : 'PRIVATE',
      daysOffset: days
        ? {
            value: settings[0]?.daysOffset ?? days.default,
            min: days.min,
            max: days.max,
            label: days.label,
          }
        : null,
      rules: rows.map((row) => ({ ...this.rule(row), channel: row.channel ?? 'TO' })),
      staffRecipients: definition.staff
        ? (await staffRecipients(tx, { tenantId, propertyId }, topic)).map(
            ({ email, channel }) => ({ email, ...(channel ? { channel } : {}) }),
          )
        : [],
    };
  }

  private rule(row: RuleRow): NotificationRecipientRule {
    switch (row.target) {
      case 'MEMBERSHIP_ROLE':
        return { target: row.target, membershipRole: row.membershipRole! };
      case 'ROLE_TEMPLATE':
        return { target: row.target, roleTemplateId: row.roleTemplateId! };
      case 'STAFF_USER':
        return { target: row.target, userId: row.userId! };
      case 'EMAIL':
        return { target: row.target, email: row.email! };
    }
  }

  private input(topic: NotificationTopic, body: unknown): UpdateNotificationTopicCommand {
    if (!body || typeof body !== 'object') throw new BadRequestException('Invalid settings.');
    const value = body as Record<string, unknown>;
    if (typeof value.guestEnabled !== 'boolean' || typeof value.customStaffRecipients !== 'boolean')
      throw new BadRequestException(
        'guestEnabled and customStaffRecipients must be true or false.',
      );
    if (!Array.isArray(value.rules)) throw new BadRequestException('rules must be a list.');
    if (value.rules.length > MAX_RULES)
      throw new BadRequestException(`At most ${MAX_RULES} recipients per notification.`);
    const definition = NOTIFICATION_TOPICS[topic];
    if (!definition.staff && (value.customStaffRecipients || value.rules.length))
      throw new BadRequestException('This notification has no staff email.');
    if (value.staffEnabled !== undefined && typeof value.staffEnabled !== 'boolean')
      throw new BadRequestException('staffEnabled must be true or false.');
    if (!definition.staff && value.staffEnabled === false)
      throw new BadRequestException('This notification has no staff email.');
    const days = topicDaysOffset(topic);
    let daysOffset: number | null = null;
    if (value.daysOffset !== undefined && value.daysOffset !== null) {
      if (!days) throw new BadRequestException('This notification has no timing to set.');
      if (
        typeof value.daysOffset !== 'number' ||
        !Number.isInteger(value.daysOffset) ||
        value.daysOffset < days.min ||
        value.daysOffset > days.max
      )
        throw new BadRequestException(
          `${days.label} must be a whole number from ${days.min} to ${days.max}.`,
        );
      daysOffset = value.daysOffset;
    }
    if (!value.customStaffRecipients && value.rules.length)
      throw new BadRequestException('Turn on custom recipients to choose who gets this email.');
    const seen = new Set<string>();
    const rules: NotificationRecipientRule[] = [];
    for (const raw of value.rules) {
      const channel = raw && typeof raw === 'object' && 'channel' in raw ? raw.channel : undefined;
      if (
        channel !== undefined &&
        (typeof channel !== 'string' || !['TO', 'CC', 'BCC'].includes(channel))
      )
        throw new BadRequestException('Recipient channel must be TO, CC or BCC.');
      const rule = {
        ...this.parseRule(raw),
        ...(channel ? { channel: channel as 'TO' | 'CC' | 'BCC' } : {}),
      };
      const key = JSON.stringify(rule);
      if (seen.has(key)) continue;
      seen.add(key);
      rules.push(rule);
    }
    return {
      // A topic with no guest email ignores the guest switch.
      guestEnabled: definition.guest ? value.guestEnabled : true,
      staffEnabled: definition.staff ? ((value.staffEnabled as boolean | undefined) ?? true) : true,
      customStaffRecipients: value.customStaffRecipients,
      rules,
      daysOffset,
    };
  }

  private parseRule(raw: unknown): NotificationRecipientRule {
    const rule = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    switch (rule.target) {
      case 'MEMBERSHIP_ROLE':
        if (rule.membershipRole === 'OWNER' || rule.membershipRole === 'ADMIN')
          return { target: 'MEMBERSHIP_ROLE', membershipRole: rule.membershipRole };
        break;
      case 'ROLE_TEMPLATE':
        if (typeof rule.roleTemplateId === 'string' && UUID.test(rule.roleTemplateId))
          return { target: 'ROLE_TEMPLATE', roleTemplateId: rule.roleTemplateId.toLowerCase() };
        break;
      case 'STAFF_USER':
        if (typeof rule.userId === 'string' && UUID.test(rule.userId))
          return { target: 'STAFF_USER', userId: rule.userId.toLowerCase() };
        break;
      case 'EMAIL': {
        const email = typeof rule.email === 'string' ? rule.email.trim().toLowerCase() : '';
        if (email.length <= 320 && EMAIL.test(email)) return { target: 'EMAIL', email };
        throw new BadRequestException(
          `"${String(rule.email ?? '')}" is not a valid email address.`,
        );
      }
    }
    throw new BadRequestException('A recipient is not valid.');
  }

  /** Role templates must belong to this property and staff to this hotel account. */
  private async requireTargetsBelongHere(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    rules: NotificationRecipientRule[],
  ): Promise<void> {
    for (const rule of rules) {
      if (rule.target === 'ROLE_TEMPLATE') {
        const found = await tx.$queryRaw<unknown[]>`
          SELECT 1 FROM property_role_templates
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
            AND id = ${rule.roleTemplateId}::uuid
        `;
        if (!found.length)
          throw new BadRequestException('That role does not exist at this property.');
      }
      if (rule.target === 'STAFF_USER') {
        const found = await tx.$queryRaw<unknown[]>`
          SELECT 1 FROM tenant_memberships tm
          WHERE tm.tenant_id = ${tenantId}::uuid AND tm.user_id = ${rule.userId}::uuid AND (tm.role IN ('OWNER','ADMIN') OR EXISTS(SELECT 1 FROM property_staff_assignments psa WHERE psa.tenant_id=${tenantId}::uuid AND psa.property_id=${propertyId}::uuid AND psa.user_id=tm.user_id AND psa.suspended_at IS NULL))
        `;
        if (!found.length)
          throw new BadRequestException('That person is not on this hotel account.');
      }
    }
  }
}
