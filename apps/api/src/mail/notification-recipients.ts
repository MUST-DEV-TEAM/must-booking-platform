import { Logger } from '@nestjs/common';

import type { TenantTransaction } from '../tenancy/tenant-database.service';
import {
  NOTIFICATION_TOPICS,
  topicDaysOffset,
  type NotificationTopic,
} from './notification-topics';

/** `staffUserId` is the user id, or `email:<address>` for an extra address that has no account. */
export type StaffRecipient = { staffUserId: string; email: string };

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
): Promise<StaffRecipient[]> {
  const settings = await tx.$queryRaw<Array<{ custom: boolean; enabled: boolean }>>`
    SELECT custom_staff_recipients AS custom, staff_enabled AS enabled FROM notification_topic_settings
    WHERE tenant_id = ${context.tenantId}::uuid AND property_id = ${context.propertyId}::uuid
      AND topic = ${topic}
  `;
  if (settings[0] && !settings[0].enabled) return [];
  const definition = NOTIFICATION_TOPICS[topic];
  const ownersOnly = 'defaultStaff' in definition && definition.defaultStaff === 'owners';
  const rows = settings[0]?.custom
    ? await tx.$queryRaw<StaffRecipient[]>`
        SELECT tm.user_id::text AS "staffUserId", u.email
        FROM notification_recipient_rules nr
        JOIN tenant_memberships tm ON tm.tenant_id = nr.tenant_id AND tm.role = nr.membership_role
        JOIN users u ON u.id = tm.user_id
        WHERE nr.tenant_id = ${context.tenantId}::uuid AND nr.property_id = ${context.propertyId}::uuid
          AND nr.topic = ${topic} AND nr.target = 'MEMBERSHIP_ROLE'
        UNION ALL
        SELECT psa.user_id::text, u.email
        FROM notification_recipient_rules nr
        JOIN property_staff_assignments psa ON psa.tenant_id = nr.tenant_id
          AND psa.property_id = nr.property_id AND psa.role_template_id = nr.role_template_id
        JOIN users u ON u.id = psa.user_id
        WHERE nr.tenant_id = ${context.tenantId}::uuid AND nr.property_id = ${context.propertyId}::uuid
          AND nr.topic = ${topic} AND nr.target = 'ROLE_TEMPLATE'
        UNION ALL
        SELECT nr.user_id::text, u.email
        FROM notification_recipient_rules nr
        JOIN users u ON u.id = nr.user_id
        WHERE nr.tenant_id = ${context.tenantId}::uuid AND nr.property_id = ${context.propertyId}::uuid
          AND nr.topic = ${topic} AND nr.target = 'STAFF_USER'
        UNION ALL
        SELECT 'email:' || lower(nr.email), lower(nr.email)
        FROM notification_recipient_rules nr
        WHERE nr.tenant_id = ${context.tenantId}::uuid AND nr.property_id = ${context.propertyId}::uuid
          AND nr.topic = ${topic} AND nr.target = 'EMAIL'
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
            AND psa.property_id = ${context.propertyId}::uuid
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
  // The same person can match several rules (e.g. an owner who is also assigned):
  // they get the email once.
  const seen = new Set<string>();
  const recipients = rows.filter((row) => {
    const key = row.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!recipients.length)
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
