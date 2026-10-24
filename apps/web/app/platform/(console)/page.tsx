'use client';

import { useQuery } from '@tanstack/react-query';

import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { PageHeader } from '../../../components/ui/page-header';
import { Skeleton } from '../../../components/ui/skeleton';
import { ErrorPanel } from '../../../components/ui/state-panel';
import { StatTile } from '../../../components/ui/stat-tile';
import {
  type AuditRow,
  ConsoleApiError,
  consoleGet,
  type HotelDirectory,
  type SupportSession,
} from '../../../lib/platform-api';
import { actionLabel, formatDateTime } from '../../../lib/platform-format';
import { LifecycleBadge } from '../lifecycle-badge';
import { useConsoleSession } from './console-frame';

export default function PlatformOverviewPage() {
  const { me, can } = useConsoleSession();
  const hotels = useQuery({
    queryKey: ['platform-console', 'hotels', 'overview'],
    enabled: can('platform.hotels.view'),
    queryFn: () => consoleGet<HotelDirectory>('/hotels?pageSize=100&sort=created&direction=desc'),
  });
  const approvals = useQuery({
    queryKey: ['platform-console', 'support-sessions'],
    enabled: can('platform.support.approve'),
    queryFn: () => consoleGet<{ sessions: SupportSession[] }>('/support-sessions'),
  });
  const activity = useQuery({
    queryKey: ['platform-console', 'audit', 'overview'],
    enabled: can('platform.audit.view'),
    queryFn: () => consoleGet<{ items: AuditRow[] }>('/audit?pageSize=8'),
  });

  const counts = hotels.data?.lifecycleCounts;
  const onboarding =
    hotels.data?.items.filter((hotel) => hotel.lifecycleState === 'TRIAL').slice(0, 5) ?? [];
  const attention = counts ? counts.PAST_DUE + counts.SUSPENDED : 0;
  const waiting =
    approvals.data?.sessions.filter(
      (session) => session.status === 'PENDING_APPROVAL' && session.requestedBy.accountId !== me.id,
    ).length ?? 0;

  return (
    <>
      <PageHeader
        title={`Welcome${me.name ? `, ${me.name.split(' ')[0]}` : ''}`}
        description="What needs attention across the hotels MUST Group runs."
      />

      {can('platform.hotels.view') ? (
        hotels.isError ? (
          <ErrorPanel
            title="We couldn’t load the hotels"
            reference={
              hotels.error instanceof ConsoleApiError
                ? (hotels.error.reference ?? undefined)
                : undefined
            }
            onRetry={() => void hotels.refetch()}
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="Hotels"
              value={hotels.isLoading ? '–' : (hotels.data?.total ?? 0)}
              href="/platform/hotels"
            />
            <StatTile label="Active" value={counts ? counts.ACTIVE : '–'} tone="success" />
            <StatTile
              label="In trial"
              value={counts ? counts.TRIAL : '–'}
              note="Still onboarding"
            />
            <StatTile
              label="Need attention"
              value={counts ? attention : '–'}
              tone={attention > 0 ? 'warning' : 'default'}
              note="Past due or suspended"
            />
          </div>
        )
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {can('platform.hotels.view') ? (
          <Card>
            <CardHeader>
              <CardTitle>Hotels in trial</CardTitle>
            </CardHeader>
            <CardContent>
              {hotels.isLoading ? (
                <Skeleton className="h-24 w-full" role="status" aria-label="Loading hotels" />
              ) : onboarding.length === 0 ? (
                <p className="m-0 text-sm text-muted-foreground">No hotel is waiting to go live.</p>
              ) : (
                <ul className="m-0 list-none divide-y p-0">
                  {onboarding.map((hotel) => (
                    <li
                      key={hotel.id}
                      className="flex items-center justify-between gap-3 py-2 text-sm"
                    >
                      <a
                        href={`/platform/hotels/${hotel.id}`}
                        className="font-semibold text-foreground hover:underline"
                      >
                        {hotel.name}
                      </a>
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        {hotel.ownerPending ? <Badge variant="warning">Owner invited</Badge> : null}
                        <LifecycleBadge state={hotel.lifecycleState} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : null}

        {can('platform.support.approve') ? (
          <Card>
            <CardHeader>
              <CardTitle>Support requests</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-3">
              <p className="m-0 text-sm text-muted-foreground">
                {waiting === 0
                  ? 'No act-as requests are waiting for approval.'
                  : `${waiting} act-as request${waiting === 1 ? ' is' : 's are'} waiting for approval.`}
              </p>
              <Button variant="outline" size="sm" asChild>
                <a href="/platform/support">Open</a>
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {can('platform.billing.view') ? (
          <Card>
            <CardHeader>
              <CardTitle>Plans and billing</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="m-0 text-sm text-muted-foreground">
                Plan catalog, invoices and usage limits arrive with Milestone 15. Until then each
                hotel’s plan is a read-only placeholder on its page.
              </p>
            </CardContent>
          </Card>
        ) : null}

        {can('platform.audit.view') ? (
          <Card>
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
            </CardHeader>
            <CardContent>
              {activity.isLoading ? (
                <Skeleton className="h-32 w-full" role="status" aria-label="Loading activity" />
              ) : activity.isError ? (
                <ErrorPanel
                  title="We couldn’t load activity"
                  reference={
                    activity.error instanceof ConsoleApiError
                      ? (activity.error.reference ?? undefined)
                      : undefined
                  }
                  onRetry={() => void activity.refetch()}
                />
              ) : (
                <ul className="m-0 list-none divide-y p-0">
                  {activity.data?.items.map((row) => (
                    <li
                      key={row.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                    >
                      <span>
                        <span className="font-medium">{actionLabel(row.action)}</span>
                        <span className="text-muted-foreground">
                          {' '}
                          · {row.actorEmail ?? 'Unknown'}
                        </span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(row.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <Button variant="link" size="sm" asChild className="mt-2 h-auto p-0">
                <a href="/platform/audit">See the full audit log</a>
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
