import {
  deduplicateRecipients,
  recipientEnvelope,
  type RecipientChannel,
  type RecipientEnvelope,
} from './recipient-envelope';
import { Logger } from '@nestjs/common';
import type { UpdateNotificationTopicCommand } from '@must/domain-contracts';

import type { TenantTransaction } from '../tenancy/tenant-database.service';
import {
  isOptionalStaffTopic,
  NOTIFICATION_TOPICS,
  topicDaysOffset,
  type NotificationTopic,
} from './notification-topics';

/** `staffUserId` is the user id, or `email:<address>` for an extra address that has no account. */
export type StaffRecipient = { staffUserId: string; email: string; channel?: RecipientChannel };

const logger = new Logger('NotificationRecipients');

type Context = { tenantId: string; propertyId: string };

/** Whether the property sends the guest email for this topic (default: yes). */
export async function guestNotificationEnabled(
  tx: TenantTransaction,
  context: Context,
  topic: NotificationTopic,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ guestEnabled: boolean }>>`
    SELECT guest_enabled AS "guestEnabled" FROM notification_topic_settings
    WHERE tenant_id = ${context.tenantId}::uuid AND property_id = ${context.propertyId}::uuid
      AND topic = ${topic}
  `;
  return rows[0]?.guestEnabled ?? true;
}

/**
 * Who receives the staff email for a topic, one entry per address.
 *
 * Nobody when the property switched the staff email off. Until the property saves
 * its own recipients for the topic, this is the topic's built-in default: the
 * account owners for owner-only topics (e.g. the daily summary); otherwise its
 * assigned staff, or the account's owners and admins when nobody is assigned (without that fallback a property with no assignments would get no staff
 * email at all). Once saved, only the saved rules apply: owners/admins by account
 * role, everyone holding a property role, specific staff, and extra addresses.
 */
export async function staffRecipients(
  tx: TenantTransaction,
  context: Context,
  topic: NotificationTopic,
  draft?: UpdateNotificationTopicCommand,
): Promise<StaffRecipient[]> {
  const settings = draft
    ? [{ custom: draft.customStaffRecipients, enabled: draft.staffEnabled ?? true }]
    : await tx.$queryRaw<Array<{ custom: boolean; enabled: boolean }>>`
    SELECT custom_staff_recipients AS custom, staff_enabled AS enabled FROM notification_topic_settings
    WHERE tenant_id = ${context.tenantId}::uuid AND property_id = ${context.propertyId}::uuid
      AND topic = ${topic}
  `;
  if (settings[0] && !settings[0].enabled) return [];
  const definition = NOTIFICATION_TOPICS[topic];
  const ownersOnly = 'defaultStaff' in definition && definition.defaultStaff === 'owners';
  const rows = settings[0]?.custom
    ? await tx.$queryRaw<StaffRecipient[]>`
        WITH selected_rules AS (
          SELECT target::text, membership_role::text, role_template_id, user_id, email, channel
          FROM notification_recipient_rules
          WHERE tenant_id = ${context.tenantId}::uuid AND property_id = ${context.propertyId}::uuid
            AND topic = ${topic} AND ${!draft}
          UNION ALL
          SELECT target, "membershipRole", "roleTemplateId"::uuid, "userId"::uuid, email, COALESCE(channel,'TO')
          FROM jsonb_to_recordset(${JSON.stringify(draft?.rules ?? [])}::jsonb)
            AS r(target text, "membershipRole" text, "roleTemplateId" text, "userId" text, email text, channel text)
        )
        SELECT tm.user_id::text AS "staffUserId", u.email, nr.channel
        FROM selected_rules nr
        JOIN tenant_memberships tm ON tm.tenant_id = ${context.tenantId}::uuid AND tm.role::text = nr.membership_role
        JOIN users u ON u.id = tm.user_id
        WHERE nr.target = 'MEMBERSHIP_ROLE'
        UNION ALL
        SELECT psa.user_id::text, u.email, nr.channel
        FROM selected_rules nr
        JOIN property_staff_assignments psa ON psa.tenant_id = ${context.tenantId}::uuid
          AND psa.property_id = ${context.propertyId}::uuid AND psa.role_template_id = nr.role_template_id
        JOIN users u ON u.id = psa.user_id
        WHERE nr.target = 'ROLE_TEMPLATE' AND psa.suspended_at IS NULL
        UNION ALL
        SELECT nr.user_id::text, u.email, nr.channel
        FROM selected_rules nr
        JOIN users u ON u.id = nr.user_id
        JOIN tenant_memberships tm ON tm.tenant_id = ${context.tenantId}::uuid AND tm.user_id = nr.user_id
        WHERE nr.target = 'STAFF_USER' AND (tm.role IN ('OWNER','ADMIN') OR EXISTS(SELECT 1 FROM property_staff_assignments psa WHERE psa.tenant_id=${context.tenantId}::uuid AND psa.property_id=${context.propertyId}::uuid AND psa.user_id=nr.user_id AND psa.suspended_at IS NULL))
        UNION ALL
        SELECT 'email:' || lower(nr.email), lower(nr.email), nr.channel
        FROM selected_rules nr WHERE nr.target = 'EMAIL'
      `
    : ownersOnly
      ? await tx.$queryRaw<StaffRecipient[]>`
          SELECT tm.user_id::text AS "staffUserId", u.email
          FROM tenant_memberships tm
          JOIN users u ON u.id = tm.user_id
          WHERE tm.tenant_id = ${context.tenantId}::uuid AND tm.role = 'OWNER'
        `
      : await tx.$queryRaw<StaffRecipient[]>`
        WITH assigned AS (
          SELECT psa.user_id::text AS "staffUserId", u.email
          FROM property_staff_assignments psa
          JOIN users u ON u.id = psa.user_id
          WHERE psa.tenant_id = ${context.tenantId}::uuid
            AND psa.property_id = ${context.propertyId}::uuid AND psa.suspended_at IS NULL
        )
        SELECT "staffUserId", email FROM assigned
        UNION ALL
        SELECT tm.user_id::text AS "staffUserId", u.email
        FROM tenant_memberships tm
        JOIN users u ON u.id = tm.user_id
        WHERE tm.tenant_id = ${context.tenantId}::uuid
          AND tm.role IN ('OWNER', 'ADMIN')
          AND NOT EXISTS (SELECT 1 FROM assigned)
      `;
  // Staff who muted non-urgent emails don't get optional ones (extra addresses
  // have no account and can't mute).
  const muted = isOptionalStaffTopic(topic)
    ? new Set(
        (
          await tx.$queryRaw<Array<{ userId: string }>>`
            SELECT user_id::text AS "userId" FROM tenant_memberships
            WHERE tenant_id = ${context.tenantId}::uuid AND mute_optional_emails
          `
        ).map((row) => row.userId),
      )
    : new Set<string>();
  // The same person can match several rules (e.g. an owner who is also assigned):
  // they get the email once.
  const recipients = deduplicateRecipients(
    rows
      .filter((row) => !muted.has(row.staffUserId))
      .map(({ staffUserId, email, channel }) => ({
        staffUserId,
        email,
        ...(channel ? { channel } : {}),
      })),
  );
  if (!recipients.length && !draft)
    logger.warn(
      `No staff recipients for ${topic} at property ${context.propertyId}: nobody at the hotel gets this email.`,
    );
  return recipients;
}

/** Guest switch and timing of a scheduled guest email (e.g. days before arrival). */
export async function scheduledGuestSettings(
  tx: TenantTransaction,
  context: Context,
  topic: NotificationTopic,
): Promise<{ enabled: boolean; daysOffset: number }> {
  const rows = await tx.$queryRaw<Array<{ guestEnabled: boolean; daysOffset: number | null }>>`
    SELECT guest_enabled AS "guestEnabled", days_offset AS "daysOffset" FROM notification_topic_settings
    WHERE tenant_id = ${context.tenantId}::uuid AND property_id = ${context.propertyId}::uuid
      AND topic = ${topic}
  `;
  return {
    enabled: rows[0]?.guestEnabled ?? true,
    daysOffset: rows[0]?.daysOffset ?? topicDaysOffset(topic)?.default ?? 0,
  };
}

/** Default recipients retain private copies; explicitly configured headers form one staff envelope. */
export function staffDeliveryGroups(
  rows: StaffRecipient[],
): Array<StaffRecipient & { envelope?: RecipientEnvelope }> {
  if (!rows.some((row) => row.channel)) return rows;
  if (!rows.length) return [];
  let envelope: RecipientEnvelope;
  try {
    envelope = recipientEnvelope(rows);
  } catch {
    logger.warn(
      'Configured staff email has no valid To envelope or exceeds the recipient limit; core booking/payment work continues without sending this staff email.',
    );
    return [];
  }
  const anchor = rows.find((row) => row.email.toLowerCase() === envelope.to[0])!;
  return [{ ...anchor, staffUserId: 'configured-staff-envelope', envelope }];
}
