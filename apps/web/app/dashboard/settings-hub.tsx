'use client';

import { useQuery } from '@tanstack/react-query';

import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { ChecklistPanel, type ChecklistItem } from '../../components/ui/checklist-panel';
import { PageHero } from '../../components/ui/page-hero';
import { ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';
import { areaHealth, settingsAreas, type Property, type SettingsArea } from './settings-areas';

export function settingsAreaHref(tenantId: string, propertyId: string, area?: SettingsArea) {
  const base = `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}&section=settings`;
  return area ? `${base}&settingsArea=${area}` : base;
}

const healthBadge = {
  done: { variant: 'success', label: 'Ready' },
  attention: { variant: 'warning', label: 'Needs attention' },
  todo: { variant: 'secondary', label: 'Not set' },
} as const;

/** The Settings overview: a readiness check and one card per area with its real status. */
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

  const header = (
    <PageHero
      eyebrow="Property settings"
      title="Settings"
      description="Everything that controls how this hotel takes bookings."
    />
  );
  if (query.isPending)
    return (
      <div className="space-y-4">
        {header}
        <ListSkeleton rows={4} />
      </div>
    );
  if (query.isError)
    return (
      <div className="space-y-4">
        {header}
        <ErrorPanel
          title="Settings are unavailable"
          description={query.error.message}
          onRetry={() => void query.refetch()}
        />
      </div>
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
  const items: ChecklistItem[] = [
    step('general', 'Hotel identity'),
    step('booking-rules', 'Booking rules'),
    step('check-in-out', 'Check-in and check-out times'),
    step('payments', 'Payment method'),
    step('managed-pages', 'Website connection'),
  ];

  return (
    <div className="space-y-4">
      {header}
      <ChecklistPanel
        title="Ready to take bookings"
        description="A quick check of the settings guests depend on."
        items={items}
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {settingsAreas.map((area) => {
          const status = health[area.key];
          const badge = status.status === 'none' ? null : healthBadge[status.status];
          return (
            <Card key={area.key}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2 text-lg">
                  {area.label}
                  {badge ? <Badge variant={badge.variant}>{badge.label}</Badge> : null}
                </CardTitle>
                <CardDescription>{area.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {status.note ? (
                  <p className="m-0 text-sm text-muted-foreground">{status.note}</p>
                ) : null}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">{area.scope}</span>
                  <Button asChild variant="outline" size="sm">
                    <a href={link(area.key)}>Open {area.label}</a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
