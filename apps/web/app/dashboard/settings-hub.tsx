'use client';

import { useQuery } from '@tanstack/react-query';

import { ChecklistPanel, type ChecklistItem } from '../../components/ui/checklist-panel';
import { ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';
import {
  areaHealth,
  bookingReadinessAreas,
  type Property,
  type SettingsArea,
} from './settings-areas';
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
      const base = `/api/tenants/${tenantId}`;
      const [properties, plan, connections, assignments] = await Promise.all([
        fetch(`${base}/properties`, { credentials: 'include' }),
        fetch(`${base}/plan-usage`, { credentials: 'include' }),
        fetch(`${base}/integration-connections`, { credentials: 'include' }),
        fetch(`${base}/properties/${propertyId}/integration-connections`, {
          credentials: 'include',
        }),
      ]);
      if (!properties.ok) throw new Error('Unable to load the hotel settings.');
      const property = ((await properties.json()) as Property[]).find(
        (item) => item.id === propertyId,
      );
      if (!property) throw new Error('The hotel settings were not found.');
      const planName = plan.ok
        ? (((await plan.json()) as { plan?: { name?: string } }).plan?.name ?? null)
        : null;
      const assigned = assignments.ok
        ? ((await assignments.json()) as Array<{ connectionId: string; enabled: boolean }>)
        : [];
      const providers = connections.ok
        ? ((await connections.json()) as Array<{ id: string; provider: string; status: string }>)
        : [];
      const connectedProviders = new Set(
        providers
          .filter(
            (c) =>
              c.status === 'CONNECTED' &&
              assigned.some((a) => a.connectionId === c.id && a.enabled),
          )
          .map((c) => c.provider),
      );
      return { property, planName, connectedProviders };
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

  const health = areaHealth(
    query.data.property,
    query.data.planName,
    query.data.connectedProviders,
  );
  const link = (area: SettingsArea) => settingsAreaHref(tenantId, propertyId, area);
  const step = (key: SettingsArea, label: string): ChecklistItem => ({
    key,
    label,
    detail: health[key].note,
    status: health[key].status === 'none' ? 'todo' : health[key].status,
    href: link(key),
  });
  const items: ChecklistItem[] = bookingReadinessAreas.map(({ key, label }) => step(key, label));

  return (
    <ChecklistPanel
      title="Ready to take bookings"
      description="A quick check of the settings guests depend on."
      items={items}
    />
  );
}
