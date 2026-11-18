'use client';

import { useQuery } from '@tanstack/react-query';

import { Badge } from '../../components/ui/badge';
import type { SettingsSummary } from './settings-areas';

export const settingsSummaryKey = (tenantId: string, propertyId: string) =>
  ['dashboard', 'settings-summary', tenantId, propertyId] as const;

/** The hotel's settings summary: readiness, live problems and this person's hidden choices. */
export function useSettingsSummary(tenantId: string, propertyId: string) {
  return useQuery({
    queryKey: settingsSummaryKey(tenantId, propertyId),
    queryFn: async () => {
      const response = await fetch(
        `/api/tenants/${tenantId}/properties/${propertyId}/settings-summary`,
        { credentials: 'include' },
      );
      if (!response.ok) throw new Error('Unable to load the hotel settings.');
      return (await response.json()) as SettingsSummary;
    },
  });
}

/** How many things need a person: form problems of the tabs plus live problems. */
export function settingsAttentionCount(summary: SettingsSummary | undefined) {
  if (!summary) return 0;
  return (
    summary.steps.filter((step) => step.status === 'attention').length +
    (summary.attention?.length ?? 0)
  );
}

/** The count next to "Overview" in the Settings menu (needs a query client, as the dashboard has). */
export function SettingsAttentionBadge({
  tenantId,
  propertyId,
}: {
  tenantId: string;
  propertyId: string;
}) {
  const count = settingsAttentionCount(useSettingsSummary(tenantId, propertyId).data);
  return count ? (
    <Badge variant="warning" aria-label={`${count} need attention`}>
      {count}
    </Badge>
  ) : null;
}
