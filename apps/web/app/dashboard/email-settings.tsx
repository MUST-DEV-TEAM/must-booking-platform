'use client';
import { EmailsWorkspace } from './emails';
/** Compatibility for saved Settings email links; all rendering belongs to the Emails workspace. */
export const emailTabs = [
  { key: 'recipients', label: 'Recipients' },
  { key: 'templates', label: 'Templates' },
  { key: 'sender', label: 'Sender' },
  { key: 'activity', label: 'Activity' },
] as const;
export type EmailTab = (typeof emailTabs)[number]['key'];
export function isEmailTab(value: string | null): value is EmailTab {
  return emailTabs.some((tab) => tab.key === value);
}
export function EmailSettings({
  tenantId,
  propertyId,
  initialTab,
  canWrite = false,
}: {
  tenantId: string;
  propertyId: string;
  initialTab?: EmailTab;
  canWrite?: boolean;
}) {
  return (
    <EmailsWorkspace
      tenantId={tenantId}
      propertyId={propertyId}
      canWrite={canWrite}
      initialTab={
        initialTab === 'templates'
          ? 'templates'
          : initialTab === 'activity'
            ? 'delivery'
            : 'configuration'
      }
    />
  );
}
