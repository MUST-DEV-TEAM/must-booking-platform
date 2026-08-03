'use client';

import { Card, Heading, Stack, Text } from '@must/ui';
import { useQuery } from '@tanstack/react-query';
import { CalendarPlus, UserPlus } from 'lucide-react';

import styles from './overview.module.css';
import { DashboardLoadingSkeleton } from './loading-skeleton';

type Overview = {
  kpis: {
    date: string;
    arrivals: number;
    departures: number;
    inHouse: number;
    bookedRoomNights: number;
    availableRoomNights: number;
    occupancyRate: number | null;
  };
  needsAttention: Array<{
    id: string;
    status: string;
    startsOn: string;
    endsOn: string;
    guestName: string | null;
    guestEmail: string;
    roomTypeName: string;
  }>;
  recentActivity: Array<{
    id: string;
    action: string;
    targetType: string;
    targetId: string;
    createdAt: string;
  }>;
};

export function DashboardOverview({
  tenantId,
  propertyId,
  role,
  initialOverview,
}: {
  tenantId: string;
  propertyId: string;
  role: 'OWNER' | 'ADMIN' | 'STAFF';
  initialOverview?: Overview;
}) {
  const overviewQuery = useQuery({
    queryKey: ['dashboard', 'overview', tenantId, propertyId],
    queryFn: async () => {
      const response = await fetch(`/api/tenants/${tenantId}/properties/${propertyId}/overview`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Unable to load the property overview.');
      return (await response.json()) as Overview;
    },
    initialData: initialOverview,
    staleTime: initialOverview ? Infinity : 0,
  });

  if (overviewQuery.isPending) return <DashboardLoadingSkeleton label="Loading overview…" />;
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
        <div className={styles.quickActions} aria-label="Quick actions">
          <a href={dashboardHref(tenantId, propertyId, 'walk-in')}>
            <CalendarPlus aria-hidden="true" size={18} /> New booking
          </a>
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
      </section>

      <section className={styles.panels}>
        <Card>
          <Heading level={2}>Needs attention</Heading>
          {overview.needsAttention.length === 0 ? (
            <Text tone="secondary">No bookings need attention right now.</Text>
          ) : (
            <ul className={styles.list}>
              {overview.needsAttention.map((booking) => (
                <li key={booking.id}>
                  <div>
                    <strong>{booking.guestName ?? booking.guestEmail}</strong>
                    <Text tone="secondary">
                      {booking.roomTypeName} · {booking.startsOn} – {booking.endsOn}
                    </Text>
                  </div>
                  <span className={styles.status}>{formatStatus(booking.status)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <Heading level={2}>Recent activity</Heading>
          {overview.recentActivity.length === 0 ? (
            <Text tone="secondary">No recent property activity.</Text>
          ) : (
            <ul className={styles.list}>
              {overview.recentActivity.map((activity) => (
                <li key={activity.id}>
                  <div>
                    <strong>{formatAction(activity.action)}</strong>
                    <Text tone="secondary">{activity.targetType}</Text>
                  </div>
                  <time dateTime={activity.createdAt}>{formatTime(activity.createdAt)}</time>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
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

function dashboardHref(tenantId: string, propertyId: string, section: string) {
  return `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}&section=${section}`;
}

function formatStatus(status: string) {
  return status.toLowerCase().replaceAll('_', ' ');
}

function formatAction(action: string) {
  return action.replaceAll('.', ' ');
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
    new Date(value),
  );
}
