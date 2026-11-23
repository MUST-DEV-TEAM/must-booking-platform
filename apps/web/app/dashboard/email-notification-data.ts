import type {
  NotificationRecipientRule,
  NotificationSettingsResponse,
  NotificationTopicSettings,
} from '@must/domain-contracts';
import { useQuery } from '@tanstack/react-query';

import { emailRequest } from '../../lib/email-workspace';

/** The notification settings and the version they are saved against; the same saved answer for every Emails tab. */
export type NotificationConfigVersion = { version: number };

export function useNotificationSettings(base: string) {
  const config = useQuery({
    queryKey: ['emails', base, 'configuration'],
    queryFn: () => emailRequest<NotificationConfigVersion>(`${base}/email-configuration`),
  });
  const topics = useQuery({
    queryKey: ['emails', base, 'topics'],
    queryFn: () => emailRequest<NotificationSettingsResponse>(`${base}/notification-settings`),
  });
  const refresh = async () => {
    await Promise.all([config.refetch(), topics.refetch()]);
  };
  return { config, topics, refresh };
}

export type TopicPatch = {
  guestEnabled?: boolean;
  staffEnabled?: boolean;
  customStaffRecipients?: boolean;
  rules?: NotificationRecipientRule[];
  daysOffset?: number;
};

/** The whole saved setting of one notification with a change applied: the server saves a notification as one piece. */
export function topicBody(topic: NotificationTopicSettings, patch: TopicPatch = {}) {
  const custom = patch.customStaffRecipients ?? topic.customStaffRecipients;
  return {
    guestEnabled: patch.guestEnabled ?? topic.guestEnabled,
    ...(topic.hasStaffEmail ? { staffEnabled: patch.staffEnabled ?? topic.staffEnabled } : {}),
    customStaffRecipients: custom,
    rules: custom ? (patch.rules ?? topic.rules) : [],
    ...(topic.daysOffset ? { daysOffset: patch.daysOffset ?? topic.daysOffset.value } : {}),
  };
}

export function ruleKey(rule: NotificationRecipientRule): string {
  switch (rule.target) {
    case 'MEMBERSHIP_ROLE':
      return 'role:' + rule.membershipRole;
    case 'ROLE_TEMPLATE':
      return 'template:' + rule.roleTemplateId;
    case 'STAFF_USER':
      return 'user:' + rule.userId;
    case 'EMAIL':
      return 'email:' + rule.email;
  }
}
export function fromRuleKey(value: string): NotificationRecipientRule {
  if (value === 'role:OWNER' || value === 'role:ADMIN')
    return {
      target: 'MEMBERSHIP_ROLE',
      membershipRole: value === 'role:OWNER' ? 'OWNER' : 'ADMIN',
    };
  if (value.startsWith('template:'))
    return { target: 'ROLE_TEMPLATE', roleTemplateId: value.slice(9) };
  if (value.startsWith('user:')) return { target: 'STAFF_USER', userId: value.slice(5) };
  return { target: 'EMAIL', email: value.slice(6) };
}
