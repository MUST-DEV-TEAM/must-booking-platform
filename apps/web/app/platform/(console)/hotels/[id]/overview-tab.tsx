'use client';

import { useQuery } from '@tanstack/react-query';
import { CircleCheck, Circle } from 'lucide-react';

import { Badge } from '../../../../../components/ui/badge';
import { Button } from '../../../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../../components/ui/card';
import { DetailList, SectionLabel } from '../../../../../components/ui/detail-list';
import { Skeleton } from '../../../../../components/ui/skeleton';
import { ErrorPanel } from '../../../../../components/ui/state-panel';
import { StatTile } from '../../../../../components/ui/stat-tile';
import { Timeline } from '../../../../../components/ui/timeline';
import {
  ConsoleApiError,
  type ChecklistItem,
  consoleGet,
  type HotelDetail,
  LIFECYCLE_LABELS,
  MODE_LABELS,
} from '../../../../../lib/platform-api';
import { formatDate, formatDateTime } from '../../../../../lib/platform-format';

function Checklist({ hotelId }: { hotelId: string }) {
  const checklist = useQuery({
    queryKey: ['platform-console', 'onboarding', hotelId],
    queryFn: () =>
      consoleGet<{ items: ChecklistItem[]; complete: boolean }>(`/hotels/${hotelId}/onboarding`),
  });
  const done = checklist.data?.items.filter((item) => item.state === 'done').length ?? 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          Onboarding checklist
          {checklist.data ? (
            <Badge variant={checklist.data.complete ? 'success' : 'warning'}>
              {done} of {checklist.data.items.length} done
            </Badge>
          ) : null}
        </CardTitle>
        <p className="m-0 text-sm text-muted-foreground">
          Worked out from what actually exists in the system. An item is only done when there is
          evidence.
        </p>
      </CardHeader>
      <CardContent>
        {checklist.isLoading ? (
          <div className="space-y-2" role="status" aria-label="Loading checklist">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : checklist.isError ? (
          <ErrorPanel
            title="The checklist could not be worked out"
            reference={
              checklist.error instanceof ConsoleApiError
                ? (checklist.error.reference ?? undefined)
                : undefined
            }
            onRetry={() => void checklist.refetch()}
          />
        ) : (
          <ul className="m-0 list-none divide-y p-0">
            {checklist.data?.items.map((item) => (
              <li key={item.key} className="flex items-start gap-3 py-3">
                {item.state === 'done' ? (
                  <CircleCheck aria-label="Done" className="mt-0.5 size-5 shrink-0 text-success" />
                ) : (
                  <Circle
                    aria-label="Not done"
                    className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-sm font-semibold">{item.label}</p>
                  <p className="m-0 text-xs text-muted-foreground">{item.evidence}</p>
                </div>
                {item.state === 'todo' ? (
                  <Button variant="outline" size="sm" asChild>
                    <a href={item.fixHref}>Fix</a>
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function OverviewTab({
  hotel,
  onInviteOwner,
}: {
  hotel: HotelDetail;
  onInviteOwner: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Properties" value={hotel.counts.properties} />
        <StatTile
          label="Staff"
          value={hotel.counts.staff}
          note={`of ${hotel.plan.maxStaffSeats} seats`}
        />
        <StatTile
          label="Bookings"
          value={hotel.counts.bookings}
          note={`${hotel.counts.bookingsLast30Days} in the last 30 days`}
        />
        <StatTile
          label="Rooms"
          value={hotel.counts.rooms}
          note={`${hotel.counts.roomTypes} room types`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Checklist hotelId={hotel.id} />
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <DetailList
                items={[
                  { label: 'Status', value: LIFECYCLE_LABELS[hotel.lifecycle.state] },
                  { label: 'Reason', value: hotel.lifecycle.reason },
                  {
                    label: 'Changed',
                    value: formatDateTime(hotel.lifecycle.changedAt ?? hotel.createdAt),
                  },
                  {
                    label: 'Effect',
                    value:
                      hotel.lifecycle.state === 'SUSPENDED' || hotel.lifecycle.state === 'CANCELLED'
                        ? 'Hotel logins and public booking are blocked'
                        : hotel.lifecycle.state === 'ARCHIVED'
                          ? 'Read-only; public booking is closed'
                          : 'Operating normally',
                  },
                ]}
              />
              <SectionLabel>History</SectionLabel>
              <Timeline
                empty="No status changes yet."
                items={hotel.lifecycle.history.map((event) => ({
                  key: event.id,
                  title: event.from
                    ? `${LIFECYCLE_LABELS[event.from]} → ${LIFECYCLE_LABELS[event.to]}`
                    : `Created as ${LIFECYCLE_LABELS[event.to]}`,
                  meta: `${event.actorEmail ?? 'System'} · ${formatDateTime(event.createdAt)}`,
                  detail: event.reason,
                }))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Hotel</CardTitle>
            </CardHeader>
            <CardContent>
              <DetailList
                items={[
                  { label: 'Mode', value: MODE_LABELS[hotel.mode] },
                  {
                    label: 'Owner',
                    value: hotel.owner ? (
                      `${hotel.owner.name ? `${hotel.owner.name} · ` : ''}${hotel.owner.email}`
                    ) : hotel.ownerInvite ? (
                      <span className="inline-flex items-center gap-2">
                        {hotel.ownerInvite.email} <Badge variant="warning">Invited</Badge>
                      </span>
                    ) : (
                      <Button
                        variant="link"
                        size="sm"
                        onClick={onInviteOwner}
                        className="h-auto p-0"
                      >
                        Invite the owner
                      </Button>
                    ),
                  },
                  {
                    label: 'Owner since',
                    value: hotel.owner ? formatDate(hotel.owner.since) : null,
                  },
                  { label: 'Country', value: hotel.country },
                  { label: 'Time zone', value: hotel.timeZone },
                  { label: 'Currency', value: hotel.currency },
                  { label: 'Created', value: formatDate(hotel.createdAt) },
                  ...hotel.contacts.flatMap((property) => [
                    { label: `${property.name} · address`, value: property.address },
                    {
                      label: `${property.name} · contact`,
                      value: property.supportEmail ?? property.phone,
                    },
                  ]),
                  { label: 'Plan', value: `${hotel.plan.name} (placeholder)` },
                ]}
              />
              <p className="mt-3 mb-0 text-xs text-muted-foreground">{hotel.plan.note}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
