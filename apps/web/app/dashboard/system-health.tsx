'use client';

import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';

import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { PageHero } from '../../components/ui/page-hero';
import { ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';

type Signal = {
  key: string;
  label: string;
  status: 'healthy' | 'attention' | 'unknown';
  headline: string;
  details: string[];
  action: { label: string; section: string } | null;
};
type Health = {
  checkedAt: string;
  overall: 'healthy' | 'attention' | 'unknown';
  signals: Signal[];
};

const statusBadge = {
  healthy: { variant: 'success', label: 'Healthy' },
  attention: { variant: 'warning', label: 'Needs attention' },
  unknown: { variant: 'secondary', label: 'Unknown' },
} as const;

async function loadHealth(url: string): Promise<Health> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
    throw new Error(
      response.status === 403
        ? 'You do not have access to the system health of this hotel.'
        : typeof body?.message === 'string'
          ? body.message
          : 'System health could not be loaded.',
    );
  }
  const body = (await response.json()) as Partial<Health> | null;
  if (!body || !Array.isArray(body.signals) || !body.overall || !(body.overall in statusBadge))
    throw new Error('System health data is incomplete. Try again.');
  return body as Health;
}

/** Live signals for this hotel only, from stored facts. Platform-level monitoring lives in the platform console. */
export function SystemHealthTab({
  tenantId,
  propertyId,
  canOpen = () => true,
}: {
  tenantId: string;
  propertyId: string;
  canOpen?: (section: string) => boolean;
}) {
  const query = useQuery({
    queryKey: ['dashboard', 'system-health', tenantId, propertyId],
    queryFn: () => loadHealth(`/api/tenants/${tenantId}/properties/${propertyId}/system-health`),
    refetchInterval: 60_000,
  });
  const href = (section: string) =>
    `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}&section=${section}`;

  if (query.isPending)
    return (
      <div className="space-y-4">
        <PageHero eyebrow="Overview" title="System health" />
        <ListSkeleton rows={3} />
      </div>
    );
  if (query.error)
    return (
      <div className="space-y-4">
        <PageHero eyebrow="Overview" title="System health" />
        <ErrorPanel
          title="System health is unavailable"
          description={query.error.message}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  const health = query.data;
  const overall = statusBadge[health.overall];
  return (
    <div className="space-y-4">
      <PageHero
        eyebrow="Overview"
        title="System health"
        description="Live signals for this hotel: reservations, the property system, payments and emails."
        chips={<Badge variant={overall.variant}>{overall.label}</Badge>}
        actions={
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw aria-hidden="true" /> Refresh
          </Button>
        }
      />
      <div className="grid gap-4 md:grid-cols-2">
        {health.signals.map((signal) => {
          const badge = statusBadge[signal.status];
          return (
            <Card key={signal.key}>
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <CardTitle className="text-lg">{signal.label}</CardTitle>
                <Badge variant={badge.variant}>{badge.label}</Badge>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <p className="m-0 font-semibold">{signal.headline}</p>
                {signal.details.map((line) => (
                  <p key={line} className="m-0 text-sm text-muted-foreground">
                    {line}
                  </p>
                ))}
                {signal.action && canOpen(signal.action.section) ? (
                  <div className="pt-1">
                    <Button asChild variant="outline" size="sm">
                      <a href={href(signal.action.section)}>{signal.action.label}</a>
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
      <p className="m-0 text-xs text-muted-foreground">
        Checked {new Date(health.checkedAt).toLocaleString()}. Readings come from stored records; no
        outside system is contacted.
      </p>
    </div>
  );
}
