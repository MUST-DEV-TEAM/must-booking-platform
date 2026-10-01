'use client';

import { Card, Heading, Stack, StatePanel, StatusBadge, Text } from '@must/ui';
import { useQuery } from '@tanstack/react-query';
import { CalendarPlus, CircleAlert, CircleCheck, LoaderCircle, UserPlus } from 'lucide-react';

import styles from './overview.module.css';

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

type AttentionStatusBadge =
  | { domain: 'booking'; state: 'pending'; label: string }
  | { domain: 'payment'; state: 'failed'; label: string };

async function fetchOverview(tenantId: string, propertyId: string): Promise<Overview> {
  const response = await fetch(`/api/tenants/${tenantId}/properties/${propertyId}/overview`, {
    credentials: 'include',
  });
  if (!response.ok) throw new Error('Unable to load the property overview.');
  return (await response.json()) as Overview;
}

function useOverviewQuery(tenantId: string, propertyId: string, initialOverview?: Overview) {
  return useQuery({
    queryKey: ['dashboard', 'overview', tenantId, propertyId],
    queryFn: () => fetchOverview(tenantId, propertyId),
    initialData: initialOverview,
    staleTime: initialOverview ? Infinity : 0,
  });
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

  if (overviewQuery.isPending)
    return (
      <StatePanel
        body={null}
        icon={<LoaderCircle aria-hidden="true" />}
        title="Loading overview…"
        variant="loading"
      />
    );
  if (overviewQuery.isError)
    return (
      <div className={styles.error} role="alert">
        <Text>{overviewQuery.error.message}</Text>
        <button onClick={() => void overviewQuery.refetch()} type="button">
          Retry
        </button>
      </div>
    );

  const overview = overviewQuery.data;

  return (
    <Stack className={styles.page} gap="lg">
      <header className={styles.heading}>
        <div>
          <Text className={styles.eyebrow} tone="secondary">
            DAILY OPERATIONS
          </Text>
          <Heading>Overview</Heading>
          <Text tone="secondary">
            A live view of today’s arrivals, stays, and property activity.
          </Text>
        </div>
        <div aria-label="Quick actions" className={styles.quickActions} role="group">
          {canShowQuickBooking ? (
            <a href={dashboardHref(tenantId, propertyId, 'overview', 'quick-booking')}>
              <CalendarPlus aria-hidden="true" size={18} /> New booking
            </a>
          ) : null}
          {role !== 'STAFF' ? (
            <a href={dashboardHref(tenantId, propertyId, 'staff')}>
              <UserPlus aria-hidden="true" size={18} /> Add staff
            </a>
          ) : null}
        </div>
      </header>

      <section aria-label="Today’s property statistics" className={styles.stats}>
        <Stat label="Arrivals" value={overview.kpis.arrivals} />
        <Stat label="Departures" value={overview.kpis.departures} />
        <Stat label="In house" value={overview.kpis.inHouse} />
        <Stat
          label="Occupancy"
          value={overview.kpis.occupancyRate === null ? '—' : `${overview.kpis.occupancyRate}%`}
          detail={`${overview.kpis.bookedRoomNights} of ${overview.kpis.availableRoomNights} room-nights`}
        />
        <Stat
          label="Today’s revenue"
          value={overview.revenue.today ? formatMoney(overview.revenue.today) : '—'}
        />
        {overview.balanceDueAtDesk ? (
          <Stat label="Due at the desk" value={formatMoney(overview.balanceDueAtDesk)} />
        ) : null}
        <Stat
          label="New bookings"
          value={overview.newBookingsSinceYesterday}
          detail="Since yesterday"
        />
        <a
          className={styles.attentionStat}
          href={dashboardHref(tenantId, propertyId, 'overview', 'needs-attention')}
        >
          <Stat label="Needs attention" value={overview.needsAttentionCount} />
        </a>
      </section>

      <div className={styles.columns}>
        <Stack gap="lg">
          <Card>
            <Heading level={2}>Today’s arrivals ({overview.todaysArrivals.length})</Heading>
            <GuestList empty="No arrivals expected today." items={overview.todaysArrivals} />
          </Card>
          <Card>
            <Heading level={2}>Today’s departures ({overview.todaysDepartures.length})</Heading>
            <GuestList empty="No departures expected today." items={overview.todaysDepartures} />
          </Card>
          <Card>
            <Heading level={2}>Recent activity</Heading>
            {overview.recentActivity.length === 0 ? (
              <Text tone="secondary">No recent bookings or cancellations.</Text>
            ) : (
              <ul className={styles.list}>
                {overview.recentActivity.map((activity) => (
                  <li key={activity.id}>
                    <Text>{activity.summary}</Text>
                    <time dateTime={activity.createdAt}>{formatTime(activity.createdAt)}</time>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </Stack>

        <Stack gap="lg">
          <Card>
            <Heading level={2}>Upcoming arrivals (next 7 days)</Heading>
            {overview.upcomingArrivals.length === 0 ? (
              <Text tone="secondary">No arrivals in the next 7 days.</Text>
            ) : (
              <ul className={styles.list}>
                {overview.upcomingArrivals.map((arrival) => (
                  <li key={arrival.id}>
                    <div>
                      <strong>{arrival.guestName ?? arrival.guestEmail}</strong>
                      <Text tone="secondary">
                        {arrival.roomTypeName} · {partySize(arrival)}
                        {arrival.hasSpecialRequests ? ' · Special request' : ''}
                      </Text>
                    </div>
                    <time dateTime={arrival.startsOn}>{formatDay(arrival.startsOn)}</time>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {overview.soldOutRooms.length > 0 ? (
            <Card>
              <Heading level={2}>Sold out tonight ({overview.soldOutRooms.length})</Heading>
              <ul className={styles.list}>
                {overview.soldOutRooms.map((room) => (
                  <li key={room.roomId}>
                    <div>
                      <strong>
                        {room.roomTypeName} — {room.roomName}
                      </strong>
                    </div>
                    <StatusBadge
                      domain="booking"
                      label={room.reason === 'blocked' ? 'Blocked' : 'Booked'}
                      state={room.reason === 'blocked' ? 'pending' : 'confirmed'}
                    />
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {overview.recentCancellations.length > 0 ? (
            <Card>
              <Heading level={2}>Cancelled in the last 24h</Heading>
              <ul className={styles.list}>
                {overview.recentCancellations.map((cancellation) => (
                  <li key={cancellation.id}>
                    <div>
                      <strong>{cancellation.guestName ?? cancellation.guestEmail}</strong>
                      <Text tone="secondary">
                        {cancellation.roomTypeName} · {cancellation.startsOn} –{' '}
                        {cancellation.endsOn}
                      </Text>
                    </div>
                    <time dateTime={cancellation.cancelledAt}>
                      {formatTime(cancellation.cancelledAt)}
                    </time>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </Stack>
      </div>
    </Stack>
  );
}

function GuestList({ items, empty }: { items: ArrivalDeparture[]; empty: string }) {
  if (items.length === 0) return <Text tone="secondary">{empty}</Text>;
  return (
    <ul className={styles.list}>
      {items.map((item) => (
        <li key={item.id}>
          <div>
            <strong>{item.guestName ?? item.guestEmail}</strong>
            <Text tone="secondary">
              {item.roomTypeName} · {partySize(item)}
              {item.hasSpecialRequests ? ' · Special request' : ''}
            </Text>
          </div>
          <Text tone="secondary">{item.externalReference}</Text>
        </li>
      ))}
    </ul>
  );
}

function partySize(item: ArrivalDeparture): string {
  const children =
    item.children > 0 ? `, ${item.children} child${item.children === 1 ? '' : 'ren'}` : '';
  return `${item.adults} adult${item.adults === 1 ? '' : 's'}${children}`;
}

export function NeedsAttentionTab({
  tenantId,
  propertyId,
}: {
  tenantId: string;
  propertyId: string;
}) {
  const overviewQuery = useOverviewQuery(tenantId, propertyId);

  if (overviewQuery.isPending)
    return (
      <StatePanel
        body={null}
        icon={<LoaderCircle aria-hidden="true" />}
        title="Loading needs attention..."
        variant="loading"
      />
    );
  if (overviewQuery.isError)
    return (
      <StatePanel
        body={overviewQuery.error.message}
        icon={<CircleAlert aria-hidden="true" />}
        title="Needs attention unavailable"
        variant="error"
      />
    );

  // An older API answers with only the count; treat a missing list as empty, not a crash.
  const bookings = overviewQuery.data.needsAttention ?? [];
  return (
    <Stack className={styles.page} gap="lg">
      <header className={styles.heading}>
        <div>
          <Text className={styles.eyebrow} tone="secondary">
            DAILY OPERATIONS
          </Text>
          <Heading>Needs attention</Heading>
          <Text tone="secondary">Bookings requiring follow-up from the property team.</Text>
        </div>
      </header>
      {bookings.length === 0 ? (
        <StatePanel
          action={
            <a href={dashboardHref(tenantId, propertyId, 'overview', 'overview')}>
              Back to Overview
            </a>
          }
          body="No bookings need attention right now."
          icon={<CircleCheck aria-hidden="true" />}
          title="No bookings need attention"
          variant="empty"
        />
      ) : (
        <Card>
          <ul aria-label="Bookings needing attention" className={styles.list}>
            {bookings.map((booking) => (
              <li key={booking.id}>
                <div>
                  <strong>{booking.guestName ?? booking.guestEmail}</strong>
                  <Text tone="secondary">
                    {booking.roomTypeName} - {booking.startsOn} - {booking.endsOn}
                  </Text>
                </div>
                <StatusBadge {...attentionStatusBadge(booking.status)} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Stack>
  );
}

function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: number | string;
  detail?: string;
}) {
  return (
    <Card className={styles.stat}>
      <Text tone="secondary">{label}</Text>
      <strong>{value}</strong>
      {detail ? <Text tone="secondary">{detail}</Text> : null}
    </Card>
  );
}

function dashboardHref(tenantId: string, propertyId: string, section: string, tab?: string) {
  const href = `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}&section=${section}`;
  return tab ? `${href}&tab=${tab}` : href;
}

function formatStatus(status: string) {
  return status.toLowerCase().replaceAll('_', ' ');
}

function attentionStatusBadge(status: string): AttentionStatusBadge {
  if (status === 'PAYMENT_FAILED') {
    return { domain: 'payment', state: 'failed', label: formatStatus(status) };
  }
  if (status === 'MANUAL_REVIEW') {
    return { domain: 'booking', state: 'pending', label: 'Needs review' };
  }
  return { domain: 'booking', state: 'pending', label: formatStatus(status) };
}

function formatMoney(value: { amount: string; currency: string }): string {
  return `${value.amount} ${value.currency}`;
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
