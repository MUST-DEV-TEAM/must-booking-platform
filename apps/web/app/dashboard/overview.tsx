'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Ban,
  BedDouble,
  CalendarDays,
  CalendarPlus,
  CircleCheck,
  CirclePlus,
  CreditCard,
  LogIn,
  LogOut,
  TriangleAlert,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

import { ActivityFeed, type ActivityEntry } from '../../components/ui/activity-feed';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { ListCard, ListRow } from '../../components/ui/list-card';
import { PageHero } from '../../components/ui/page-hero';
import { StatTile } from '../../components/ui/stat-tile';
import { EmptyPanel, ErrorPanel } from '../../components/ui/state-panel';
import { Skeleton } from '../../components/ui/skeleton';
import { bookingStatusDisplay } from '../../lib/reservation-display';

export type Overview = {
  kpis: {
    date: string;
    arrivals: number;
    departures: number;
    inHouse: number;
    bookedRoomNights: number;
    availableRoomNights: number;
    occupancyRate: number | null;
  };
  revenue: { today: { amount: string; currency: string } | null };
  balanceDueAtDesk: { amount: string; currency: string } | null;
  newBookingsSinceYesterday: number;
  needsAttentionCount: number;
  todaysArrivals: ArrivalDeparture[];
  todaysDepartures: ArrivalDeparture[];
  upcomingArrivals: UpcomingArrival[];
  soldOutRooms: SoldOutRoom[];
  recentCancellations: RecentCancellation[];
  recentActivity: ActivityItem[];
  needsAttention: Array<{
    id: string;
    status: string;
    startsOn: string;
    endsOn: string;
    guestName: string | null;
    guestEmail: string;
    roomTypeName: string;
  }>;
};

type ArrivalDeparture = {
  id: string;
  externalReference: string;
  guestName: string | null;
  guestEmail: string;
  roomTypeName: string;
  adults: number;
  children: number;
  hasSpecialRequests: boolean;
  paymentMethod: string;
  totalAmount: string;
  currency: string;
};

type UpcomingArrival = ArrivalDeparture & { startsOn: string };

type SoldOutRoom = {
  roomId: string;
  roomName: string;
  roomTypeName: string;
  reason: 'booked' | 'blocked';
};

type RecentCancellation = {
  id: string;
  externalReference: string;
  guestName: string | null;
  guestEmail: string;
  roomTypeName: string;
  startsOn: string;
  endsOn: string;
  cancelledAt: string;
};

type ActivityItem = {
  id: string;
  action: string;
  createdAt: string;
  summary: string;
};

async function fetchOverview(tenantId: string, propertyId: string): Promise<Overview> {
  const response = await fetch(`/api/tenants/${tenantId}/properties/${propertyId}/overview`, {
    credentials: 'include',
  });
  if (!response.ok) throw new Error('Unable to load the property overview.');
  return (await response.json()) as Overview;
}

export function useOverviewQuery(tenantId: string, propertyId: string, initialOverview?: Overview) {
  return useQuery({
    queryKey: ['dashboard', 'overview', tenantId, propertyId],
    queryFn: () => fetchOverview(tenantId, propertyId),
    initialData: initialOverview,
    staleTime: initialOverview ? Infinity : 0,
    refetchInterval: 60_000,
  });
}

function dashboardHref(tenantId: string, propertyId: string, section: string, extra?: string) {
  const href = `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}&section=${section}`;
  return extra ? `${href}&${extra}` : href;
}

export function DashboardOverview({
  tenantId,
  propertyId,
  role,
  canManageQuickBooking,
  initialOverview,
}: {
  tenantId: string;
  propertyId: string;
  role: 'OWNER' | 'ADMIN' | 'STAFF';
  canManageQuickBooking?: boolean;
  initialOverview?: Overview;
}) {
  const overviewQuery = useOverviewQuery(tenantId, propertyId, initialOverview);
  const canShowQuickBooking = canManageQuickBooking ?? role !== 'STAFF';
  const link = (section: string, extra?: string) => dashboardHref(tenantId, propertyId, section, extra);
  const reservation = (id: string) => link('reservations', `reservation=${id}`);

  if (overviewQuery.isPending)
    return (
      <div aria-busy="true" aria-live="polite" className="space-y-4">
        <span className="sr-only">Loading overview…</span>
        <Skeleton className="h-40 w-full" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-28 w-full" />
          ))}
        </div>
      </div>
    );
  if (overviewQuery.isError)
    return (
      <ErrorPanel
        title="Couldn't load the overview"
        description={overviewQuery.error.message}
        onRetry={() => void overviewQuery.refetch()}
      />
    );

  // Older or partial API answers may leave the lists out; treat a missing list as empty.
  const overview: Overview = {
    ...overviewQuery.data,
    todaysArrivals: overviewQuery.data.todaysArrivals ?? [],
    todaysDepartures: overviewQuery.data.todaysDepartures ?? [],
    upcomingArrivals: overviewQuery.data.upcomingArrivals ?? [],
    soldOutRooms: overviewQuery.data.soldOutRooms ?? [],
    recentCancellations: overviewQuery.data.recentCancellations ?? [],
    recentActivity: overviewQuery.data.recentActivity ?? [],
    needsAttention: overviewQuery.data.needsAttention ?? [],
  };
  const { kpis } = overview;
  const today = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${kpis.date}T00:00:00`));
  const attention = overview.needsAttentionCount ?? 0;

  const feed: ActivityEntry[] = overview.recentActivity.slice(0, 6).map((activity) => ({
    key: activity.id,
    title: activity.summary,
    at: activity.createdAt,
    ...activityLook(activity.action),
  }));

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow={`Today · ${today}`}
        title="Today at a glance"
        description={`${kpis.arrivals} arrival${kpis.arrivals === 1 ? '' : 's'} · ${kpis.departures} departure${kpis.departures === 1 ? '' : 's'} · ${kpis.inHouse} ${kpis.inHouse === 1 ? 'stay' : 'stays'} in house.${attention > 0 ? ` ${attention} need${attention === 1 ? 's' : ''} your attention.` : ' Nothing needs your attention.'}`}
        actions={
          <>
            {canShowQuickBooking ? (
              <Button asChild>
                <a href={link('overview', 'tab=quick-booking')}>
                  <CalendarPlus aria-hidden="true" /> New booking
                </a>
              </Button>
            ) : null}
            <Button variant="outline" asChild>
              <a href={link('calendar')}>
                <CalendarDays aria-hidden="true" /> Open calendar
              </a>
            </Button>
            {role !== 'STAFF' ? (
              <Button variant="outline" asChild>
                <a href={link('staff')}>
                  <UserPlus aria-hidden="true" /> Add staff
                </a>
              </Button>
            ) : null}
          </>
        }
        chips={
          <>
            <Badge variant={attention > 0 ? 'warning' : 'success'} className="rounded-full px-2.5">
              {attention > 0 ? `${attention} need attention` : 'All clear'}
            </Badge>
            {(overview.newBookingsSinceYesterday ?? 0) > 0 ? (
              <Badge variant="info" className="rounded-full px-2.5">
                {overview.newBookingsSinceYesterday} new since yesterday
              </Badge>
            ) : null}
            {overview.soldOutRooms.length > 0 ? (
              <Badge variant="secondary" className="rounded-full px-2.5">
                {overview.soldOutRooms.length} room{overview.soldOutRooms.length === 1 ? '' : 's'} sold out tonight
              </Badge>
            ) : null}
          </>
        }
      />

      <section aria-label="Today’s property statistics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Arrivals"
          icon={LogIn}
          value={kpis.arrivals}
          note="Arriving today"
          href={link('reservations', 'rv=arriving_today')}
        />
        <StatTile
          label="Departures"
          icon={LogOut}
          value={kpis.departures}
          note="Leaving today"
          href={link('reservations', 'rv=departing_today')}
        />
        <StatTile
          label="In house"
          icon={Users}
          value={kpis.inHouse}
          note="Staying tonight"
          href={link('reservations', 'rv=in_house')}
        />
        <StatTile
          label="Occupancy"
          icon={BedDouble}
          value={kpis.occupancyRate === null ? '—' : `${kpis.occupancyRate}%`}
          note={`${kpis.bookedRoomNights} of ${kpis.availableRoomNights} room-nights`}
        />
        <StatTile
          label="Needs attention"
          icon={TriangleAlert}
          tone={attention > 0 ? 'warning' : 'default'}
          value={attention}
          note={attention > 0 ? 'Open the queue' : 'Nothing to follow up'}
          href={link('overview', 'tab=needs-attention')}
        />
        <StatTile
          label="Due at the desk"
          icon={Wallet}
          value={overview.balanceDueAtDesk ? formatMoney(overview.balanceDueAtDesk) : '—'}
          note="Pay-at-hotel balances"
        />
        <StatTile
          label="Revenue today"
          icon={CreditCard}
          value={overview.revenue?.today ? formatMoney(overview.revenue.today) : '—'}
          note="Payments received today"
          href={link('payments')}
        />
        <StatTile
          label="New bookings"
          icon={CirclePlus}
          value={overview.newBookingsSinceYesterday ?? 0}
          note="Since yesterday"
          href={link('reservations')}
        />
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <ListCard
            title="Today’s arrivals"
            count={overview.todaysArrivals.length}
            action={{ label: 'View all', href: link('reservations', 'rv=arriving_today') }}
            empty="No arrivals expected today."
          >
            {overview.todaysArrivals.map((item) => (
              <GuestRow key={item.id} item={item} href={reservation(item.id)} />
            ))}
          </ListCard>
          <ListCard
            title="Today’s departures"
            count={overview.todaysDepartures.length}
            action={{ label: 'View all', href: link('reservations', 'rv=departing_today') }}
            empty="No departures expected today."
          >
            {overview.todaysDepartures.map((item) => (
              <GuestRow key={item.id} item={item} href={reservation(item.id)} />
            ))}
          </ListCard>
          <ListCard
            title="Recent activity"
            description="Latest bookings and cancellations."
            action={{ label: 'View reservations', href: link('reservations') }}
          >
            <li className="list-none">
              <ActivityFeed entries={feed} empty="No recent bookings or cancellations." />
            </li>
          </ListCard>
        </div>

        <div className="space-y-4">
          <ListCard
            title="Needs attention"
            count={attention}
            action={{ label: 'Open queue', href: link('overview', 'tab=needs-attention') }}
            empty="Nothing needs attention right now."
          >
            {overview.needsAttention.slice(0, 5).map((booking) => (
              <ListRow
                key={booking.id}
                href={reservation(booking.id)}
                title={booking.guestName ?? booking.guestEmail}
                subtitle={`${booking.roomTypeName} · ${booking.startsOn} – ${booking.endsOn}`}
                trailing={
                  <Badge variant={bookingStatusDisplay(booking.status).tone} className="rounded-full px-2 py-0 text-[10px]">
                    {bookingStatusDisplay(booking.status).label}
                  </Badge>
                }
              />
            ))}
          </ListCard>
          <ListCard
            title="Upcoming arrivals"
            description="Next 7 days"
            empty="No arrivals in the next 7 days."
          >
            {overview.upcomingArrivals.map((arrival) => (
              <ListRow
                key={arrival.id}
                href={reservation(arrival.id)}
                title={arrival.guestName ?? arrival.guestEmail}
                subtitle={`${arrival.roomTypeName} · ${partySize(arrival)}${arrival.hasSpecialRequests ? ' · Special request' : ''}`}
                trailing={formatDay(arrival.startsOn)}
              />
            ))}
          </ListCard>
          {overview.soldOutRooms.length > 0 ? (
            <ListCard title="Sold out tonight" count={overview.soldOutRooms.length}>
              {overview.soldOutRooms.map((room) => (
                <ListRow
                  key={room.roomId}
                  title={`${room.roomTypeName} — ${room.roomName}`}
                  trailing={
                    <Badge variant={room.reason === 'blocked' ? 'warning' : 'secondary'} className="rounded-full px-2 py-0 text-[10px]">
                      {room.reason === 'blocked' ? 'Blocked' : 'Booked'}
                    </Badge>
                  }
                />
              ))}
            </ListCard>
          ) : null}
          {overview.recentCancellations.length > 0 ? (
            <ListCard title="Cancelled in the last 24h" count={overview.recentCancellations.length}>
              {overview.recentCancellations.map((cancellation) => (
                <ListRow
                  key={cancellation.id}
                  href={reservation(cancellation.id)}
                  title={cancellation.guestName ?? cancellation.guestEmail}
                  subtitle={`${cancellation.roomTypeName} · ${cancellation.startsOn} – ${cancellation.endsOn}`}
                  trailing={formatTime(cancellation.cancelledAt)}
                />
              ))}
            </ListCard>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function GuestRow({ item, href }: { item: ArrivalDeparture; href: string }) {
  return (
    <ListRow
      href={href}
      title={item.guestName ?? item.guestEmail}
      subtitle={`${item.roomTypeName} · ${partySize(item)}${item.hasSpecialRequests ? ' · Special request' : ''}`}
      trailing={item.externalReference}
    />
  );
}

function activityLook(action: string): { icon: LucideIcon; tone: ActivityEntry['tone'] } {
  if (action.includes('cancel')) return { icon: Ban, tone: 'danger' };
  if (action.includes('created')) return { icon: CirclePlus, tone: 'success' };
  return { icon: CircleCheck, tone: 'default' };
}

function partySize(item: ArrivalDeparture): string {
  const children =
    item.children > 0 ? `, ${item.children} child${item.children === 1 ? '' : 'ren'}` : '';
  return `${item.adults} adult${item.adults === 1 ? '' : 's'}${children}`;
}

function formatMoney(value: { amount: string; currency: string }): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: value.currency }).format(
    Number(value.amount),
  );
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
    new Date(value),
  );
}

function formatDay(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
    new Date(`${value}T00:00:00`),
  );
}
