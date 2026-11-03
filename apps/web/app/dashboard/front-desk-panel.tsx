'use client';

import { useQuery } from '@tanstack/react-query';

import { Badge } from '../../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { StayStatusActions } from './stay-status-actions';

type DeskItem = {
  id: string;
  status: string;
  startsOn: string;
  endsOn: string;
  pmsStayStatus: string | null;
  externalBookingId: string | null;
  guestFirstName: string | null;
  guestLastName: string | null;
  roomName: string | null;
  roomTypeName: string;
  externalReference: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
};

type FrontDeskDay = {
  date: string;
  arrivals: DeskItem[];
  departures: DeskItem[];
  inHouse: DeskItem[];
  lateArrivals: DeskItem[];
  overdueDepartures: DeskItem[];
};

const STAGE_LABEL: Record<string, string> = {
  expected: 'Expected',
  checked_in: 'In house',
  checked_out: 'Departed',
  no_show: 'No-show',
};

const time = (value: string | null) =>
  value ? new Date(value).toLocaleTimeString('en-GB', { timeStyle: 'short' }) : null;

function Group({
  title,
  tone,
  items,
  tenantId,
  propertyId,
  canEdit,
}: {
  title: string;
  tone?: 'warning';
  items: DeskItem[];
  tenantId: string;
  propertyId: string;
  canEdit: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <section aria-label={title} className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        {title}
        <Badge variant={tone === 'warning' ? 'warning' : 'secondary'}>{items.length}</Badge>
      </h3>
      <ul className="m-0 list-none divide-y rounded-lg border p-0 px-3 text-sm">
        {items.map((item) => {
          const stage = item.pmsStayStatus ?? 'expected';
          const real =
            stage === 'checked_out'
              ? `Left ${time(item.checkedOutAt) ?? ''}`
              : stage === 'checked_in'
                ? `Arrived ${time(item.checkedInAt) ?? ''}`
                : null;
          return (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <a
                  className="font-medium underline-offset-2 hover:underline"
                  href={`/dashboard/${tenantId}?propertyId=${propertyId}&section=reservations&reservation=${item.id}`}
                >
                  {[item.guestFirstName, item.guestLastName].filter(Boolean).join(' ') ||
                    item.externalReference}
                </a>
                <p className="text-xs text-muted-foreground">
                  {item.roomName ?? item.roomTypeName} · {item.startsOn} to {item.endsOn}
                  {real ? ` · ${real}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{STAGE_LABEL[stage] ?? stage}</Badge>
                {canEdit ? (
                  <StayStatusActions tenantId={tenantId} propertyId={propertyId} booking={item} />
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Today's arrivals and departures with one-tap check-in and check-out, and anyone overdue. */
export function FrontDeskPanel({
  tenantId,
  propertyId,
  canEdit,
}: {
  tenantId: string;
  propertyId: string;
  canEdit: boolean;
}) {
  const query = useQuery({
    queryKey: ['dashboard', 'front-desk', tenantId, propertyId],
    refetchInterval: 60_000,
    queryFn: async () => {
      const response = await fetch(`/api/tenants/${tenantId}/properties/${propertyId}/front-desk`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('The front desk could not be loaded.');
      return (await response.json()) as FrontDeskDay;
    },
  });
  const day = query.data;
  if (!day) return null;
  const empty =
    day.arrivals.length +
      day.departures.length +
      day.lateArrivals.length +
      day.overdueDepartures.length ===
    0;
  if (empty) return null;
  const common = { tenantId, propertyId, canEdit };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Front desk today</CardTitle>
        <p className="text-xs text-muted-foreground">
          Hotels that keep their stays in a hotel system (Clock) show its arrival status; it is
          recorded there.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Group
          title="Overdue departures"
          tone="warning"
          items={day.overdueDepartures}
          {...common}
        />
        <Group title="Late arrivals" tone="warning" items={day.lateArrivals} {...common} />
        <Group title="Arriving today" items={day.arrivals} {...common} />
        <Group title="Departing today" items={day.departures} {...common} />
      </CardContent>
    </Card>
  );
}
