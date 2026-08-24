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
      </section>

      <section className={styles.panels}>
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

  const bookings = overviewQuery.data.needsAttention;
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

function formatAction(action: string) {
  return action.replaceAll('.', ' ');
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
    new Date(value),
  );
}
