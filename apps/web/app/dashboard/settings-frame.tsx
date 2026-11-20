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
  overviewBadge,
  children,
}: {
  tenantId: string;
  propertyId: string;
  tab: SettingsTab;
  onNavigate?: (tab: SettingsTab) => void;
  /** Shown next to "Overview" in the menu, e.g. how many things need attention. */
  overviewBadge?: ReactNode;
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
          ...(entry.key === 'overview' && overviewBadge ? { badge: overviewBadge } : {}),
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
