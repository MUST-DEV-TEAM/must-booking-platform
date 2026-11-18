'use client';

import type { ReactNode } from 'react';

import { SettingsLayout, type SettingsNavGroup } from '../../components/ui/settings-layout';
import {
  settingsGroups,
  settingsTab,
  settingsTabHref,
  settingsTabs,
  type SettingsTab,
} from './settings-registry';

/** The hotel's Settings page: the side menu from the registry around the current tab. */
export function SettingsFrame({
  tenantId,
  propertyId,
  tab,
  onNavigate,
  children,
}: {
  tenantId: string;
  propertyId: string;
  tab: SettingsTab;
  onNavigate?: (tab: SettingsTab) => void;
  children: ReactNode;
}) {
  const groups: SettingsNavGroup[] = settingsGroups
    .map((group) => ({
      key: group.key,
      label: group.label,
      note: 'note' in group ? group.note : undefined,
      items: settingsTabs
        .filter((entry) => entry.group === group.key && entry.available)
        .map((entry) => ({
          key: entry.key,
          label: entry.label,
          href: settingsTabHref(tenantId, propertyId, entry.key),
        })),
    }))
    .filter((group) => group.items.length > 0);
  const current = settingsTab(tab);
  return (
    <SettingsLayout
      title="Settings"
      groups={groups}
      current={tab}
      pageTitle={current.label}
      pageDescription={current.description}
      onNavigate={onNavigate ? (key) => onNavigate(key as SettingsTab) : undefined}
    >
      {children}
    </SettingsLayout>
  );
}
