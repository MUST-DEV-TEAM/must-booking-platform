'use client';

import { AppShell, Card, Heading, Stack, Text } from '@must/ui';
import { useQuery } from '@tanstack/react-query';
import { LayoutDashboard, Layers } from 'lucide-react';
import { useEffect, useState } from 'react';

import { fetchSessionUser, type SessionUser } from '../auth-routing';
import { IntegrationsManagement } from './[tenantId]/integrations-management';
import styles from './dashboard-shell.module.css';
import { DashboardLoadingSkeleton } from './loading-skeleton';

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
};
type PropertySummary = { property: Property; overview: Overview | null };

function formatOccupancy(rate: number | null) {
  return rate === null ? 'occupancy n/a' : `${Math.round(rate * 100)}% occupancy`;
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
      homeHref="/dashboard"
      navigation={navigation}
      title="Main Dashboard"
      userEmail={user?.email}
      headerActions={
        <label className={styles.propertySwitcher}>
          <Layers aria-hidden="true" size={16} />
          <select
            aria-label="Switch property"
            value=""
            onChange={(event) => {
              if (!event.target.value) return;
              window.location.href = `/dashboard/${tenantId}?propertyId=${encodeURIComponent(event.target.value)}&section=overview`;
            }}
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
    >
      {summaryQuery.isPending ? <DashboardLoadingSkeleton label="Loading dashboard…" /> : null}
      {summaryQuery.isError ? <Text>Unable to load the aggregate summary.</Text> : null}
      {summaryQuery.data ? (
        <Stack gap="lg">
          <AggregateKpis results={summaryQuery.data} />
          <Stack gap="md">
            <Heading level={2}>Properties</Heading>
            {summaryQuery.data.map(({ property, overview }) => (
              <Card key={property.id}>
                <Stack gap="sm">
                  <Heading level={3}>{property.name}</Heading>
                  <Text tone="secondary">
                    {overview
                      ? `${overview.kpis.inHouse} in-house · ${overview.kpis.arrivals} arrivals · ${overview.kpis.departures} departures · ${formatOccupancy(overview.kpis.occupancyRate)}`
                      : "Unable to load this property's summary."}
                  </Text>
                </Stack>
              </Card>
            ))}
          </Stack>
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
    totals.availableRoomNights > 0 ? totals.bookedRoomNights / totals.availableRoomNights : null;
  return (
    <Card>
      <Stack gap="sm">
        <Heading level={2}>All properties</Heading>
        <Text tone="secondary">
          {totals.inHouse} guests in-house · {totals.arrivals} arrivals today · {totals.departures}{' '}
          departures today · {formatOccupancy(occupancyRate)}
        </Text>
      </Stack>
    </Card>
  );
}
