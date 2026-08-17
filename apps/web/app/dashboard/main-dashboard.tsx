'use client';

import { AppShell, Badge, Card, Heading, Stack, Text } from '@must/ui';
import { useQuery } from '@tanstack/react-query';
import { LayoutDashboard, Layers } from 'lucide-react';
import { useEffect, useState } from 'react';

import { fetchSessionUser, type SessionUser } from '../auth-routing';
import { IntegrationsManagement } from './[tenantId]/integrations-management';
import styles from './dashboard-shell.module.css';
import { DashboardLoadingSkeleton } from './loading-skeleton';
import mainDashboardStyles from './main-dashboard.module.css';
import { Stat } from './overview';

type Property = { id: string; name: string };
type Overview = {
  kpis: {
    arrivals: number;
    departures: number;
    inHouse: number;
    bookedRoomNights: number;
    availableRoomNights: number;
    occupancyRate: number | null;
  };
  needsAttention: Array<{ id: string }>;
};
type PropertySummary = { property: Property; overview: Overview | null };

function formatOccupancy(rate: number | null) {
  return rate === null ? 'occupancy n/a' : `${rate}% occupancy`;
}

// Aggregate KPI/summary view only — totals across properties, not the merged
// operational lists (Reservations/Payments/Guests stay per-property). Milestone
// 11.5 Task 10.
export function MainDashboard({
  tenantId,
  properties,
}: {
  tenantId: string;
  properties: Property[];
}) {
  const [user, setUser] = useState<SessionUser | null | undefined>();
  useEffect(() => {
    let active = true;
    void fetchSessionUser().then((value) => active && setUser(value));
    return () => {
      active = false;
    };
  }, []);

  const summaryQuery = useQuery({
    queryKey: ['dashboard', 'main-dashboard', tenantId, properties.map((p) => p.id).join(',')],
    queryFn: async (): Promise<PropertySummary[]> =>
      Promise.all(
        properties.map(async (property) => {
          const response = await fetch(
            `/api/tenants/${tenantId}/properties/${property.id}/overview`,
            { credentials: 'include' },
          );
          const overview = response.ok ? ((await response.json()) as Overview) : null;
          return { property, overview };
        }),
      ),
    enabled: properties.length > 0,
  });

  const navigation = [
    {
      href: `/dashboard/${tenantId}`,
      label: 'Main Dashboard',
      current: true,
      icon: LayoutDashboard,
    },
  ];

  return (
    <AppShell
      headerActions={
        <label className={styles.propertySwitcher}>
          <Layers aria-hidden="true" size={16} />
          <select
            aria-label="Switch property"
            onChange={(event) => {
              if (!event.target.value) return;
              window.location.href = propertyOverviewHref(tenantId, event.target.value);
            }}
            value=""
          >
            <option value="">Main Dashboard</option>
            {properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name}
              </option>
            ))}
          </select>
        </label>
      }
      homeHref="/dashboard"
      navigation={navigation}
      title="Main Dashboard"
      userEmail={user?.email}
    >
      {summaryQuery.isPending ? <DashboardLoadingSkeleton label="Loading dashboard…" /> : null}
      {summaryQuery.isError ? <Text>Unable to load the aggregate summary.</Text> : null}
      {summaryQuery.data ? (
        <Stack className={mainDashboardStyles.page} gap="lg">
          <header className={mainDashboardStyles.heading}>
            <Text className={mainDashboardStyles.eyebrow} tone="secondary">
              PORTFOLIO OVERVIEW
            </Text>
            <Heading>Main Dashboard</Heading>
            <Text tone="secondary">
              A live view of today’s arrivals, stays, and occupancy across your properties.
            </Text>
          </header>
          <AggregateKpis results={summaryQuery.data} />
          <section aria-labelledby="properties-heading" className={mainDashboardStyles.properties}>
            <Heading id="properties-heading" level={2}>
              Properties
            </Heading>
            <div className={mainDashboardStyles.propertyGrid}>
              {summaryQuery.data.map(({ property, overview }) => (
                <a
                  className={mainDashboardStyles.propertyCardLink}
                  href={propertyOverviewHref(tenantId, property.id)}
                  key={property.id}
                >
                  <Card className={mainDashboardStyles.propertyCard}>
                    <div className={mainDashboardStyles.propertyCardHeader}>
                      <Heading level={3}>{property.name}</Heading>
                      {overview && overview.needsAttention.length > 0 ? (
                        <Badge tone="warning">
                          {overview.needsAttention.length} need attention
                        </Badge>
                      ) : null}
                    </div>
                    <Text tone="secondary">
                      {overview
                        ? `${overview.kpis.inHouse} in-house · ${overview.kpis.arrivals} arrivals · ${overview.kpis.departures} departures · ${formatOccupancy(overview.kpis.occupancyRate)}`
                        : "Unable to load this property's summary."}
                    </Text>
                  </Card>
                </a>
              ))}
            </div>
          </section>
          <Stack gap="md">
            <Heading level={2}>Integrations</Heading>
            <IntegrationsManagement tenantId={tenantId} properties={properties} />
          </Stack>
        </Stack>
      ) : null}
    </AppShell>
  );
}

function AggregateKpis({ results }: { results: PropertySummary[] }) {
  const totals = results.reduce(
    (acc, { overview }) => {
      if (!overview) return acc;
      acc.arrivals += overview.kpis.arrivals;
      acc.departures += overview.kpis.departures;
      acc.inHouse += overview.kpis.inHouse;
      acc.bookedRoomNights += overview.kpis.bookedRoomNights;
      acc.availableRoomNights += overview.kpis.availableRoomNights;
      return acc;
    },
    { arrivals: 0, departures: 0, inHouse: 0, bookedRoomNights: 0, availableRoomNights: 0 },
  );
  const occupancyRate =
    totals.availableRoomNights > 0
      ? Math.round((totals.bookedRoomNights / totals.availableRoomNights) * 100)
      : null;

  return (
    <section aria-labelledby="portfolio-kpis-heading">
      <Heading id="portfolio-kpis-heading" level={2}>
        All properties
      </Heading>
      <div className={mainDashboardStyles.stats}>
        <Stat label="Arrivals" value={totals.arrivals} />
        <Stat label="Departures" value={totals.departures} />
        <Stat label="In-house" value={totals.inHouse} />
        <Stat
          detail={`${totals.bookedRoomNights} of ${totals.availableRoomNights} room-nights`}
          label="Occupancy"
          value={occupancyRate === null ? '—' : `${occupancyRate}%`}
        />
      </div>
    </section>
  );
}

function propertyOverviewHref(tenantId: string, propertyId: string) {
  return `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}&section=overview`;
}
