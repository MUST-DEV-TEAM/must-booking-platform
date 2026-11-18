'use client';

import { useQuery } from '@tanstack/react-query';

import { ChecklistPanel, type ChecklistItem } from '../../components/ui/checklist-panel';
import { ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';
import { type SettingsArea, type SettingsReadiness } from './settings-areas';
import { resolveSettingsTab, settingsTabHref, type SettingsTab } from './settings-registry';

/** A link to a Settings tab; old area names (`general`, `payments`…) land on their new tab. */
export function settingsAreaHref(
  tenantId: string,
  propertyId: string,
  area?: SettingsArea | SettingsTab,
) {
  return settingsTabHref(tenantId, propertyId, resolveSettingsTab(area));
}

/** The Settings overview: the readiness check (the full overview comes with step S1). */
export function SettingsHub({ tenantId, propertyId }: { tenantId: string; propertyId: string }) {
  const query = useQuery({
    queryKey: ['dashboard', 'settings-hub', tenantId, propertyId],
    queryFn: async () => {
      const response = await fetch(
        `/api/tenants/${tenantId}/properties/${propertyId}/settings-summary`,
        { credentials: 'include' },
      );
      if (!response.ok) throw new Error('Unable to load the hotel settings.');
      return (await response.json()) as SettingsReadiness;
    },
  });

  if (query.isPending) return <ListSkeleton rows={4} />;
  if (query.isError)
    return (
      <ErrorPanel
        title="Settings are unavailable"
        description={query.error.message}
        onRetry={() => void query.refetch()}
      />
    );

  const items: ChecklistItem[] = query.data.steps.map((step) => ({
    key: step.key,
    label: step.label,
    detail: step.note,
    status: step.status,
    href: settingsTabHref(tenantId, propertyId, step.tab),
  }));

  return (
    <ChecklistPanel
      title="Ready to take bookings"
      description="A quick check of the settings guests depend on."
      items={items}
    />
  );
}
