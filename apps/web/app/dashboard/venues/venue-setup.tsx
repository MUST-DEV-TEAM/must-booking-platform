'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { Alert, AlertDescription } from '../../../components/ui/alert';
import { PageHeader } from '../../../components/ui/page-header';
import { TabBar } from '../../../components/ui/tab-bar';
import { DepositRulesPanel } from './deposit-rules-panel';
import { LiveFloorPanel } from './live-floor-panel';
import { ReservationsPanel } from './reservations-panel';
import { TodayPanel } from './today-panel';
import { VenueLayoutPanel } from './venue-layout-panel';
import { venueApi } from './venue-api';
import { useVenueStaff } from './venue-access';

type Section = 'today' | 'reservations' | 'floor' | 'layout' | 'deposits';

/** A restaurant that has finished its first-time setup: bookings, the live floor, tables and staff. */
export function VenueSetup({ tenantId, venueId }: { tenantId: string; venueId: string }) {
  const venue = useQuery({
    queryKey: ['venue', tenantId, venueId],
    queryFn: () => venueApi.getVenue(tenantId, venueId),
  });
  const [section, setSection] = useState<Section>('today');
  // Asking for the staff list doubles as the permission check: people who may not see it get a 403.
  const canSeeStaff = useVenueStaff(tenantId, venueId).isSuccess;

  if (venue.isPending)
    return <p className="text-sm text-muted-foreground">Loading restaurant...</p>;
  if (venue.isError)
    return (
      <Alert variant="destructive">
        <AlertDescription>{venue.error.message}</AlertDescription>
      </Alert>
    );

  const timezone = venue.data.timezone ?? 'UTC';
  const current: Section = section === 'deposits' && !canSeeStaff ? 'today' : section;

  return (
    <div className="space-y-6">
      <PageHeader title={venue.data.name} description="Table bookings" />

      <TabBar
        label="Sections"
        tabs={[
          { id: 'today', label: 'Today' },
          { id: 'reservations', label: 'Reservations' },
          { id: 'floor', label: 'Floor plan' },
          { id: 'layout', label: 'Layout' },
          ...(canSeeStaff ? [{ id: 'deposits', label: 'Deposits' }] : []),
        ]}
        current={current}
        onSelect={(id) => setSection(id as Section)}
      />

      {current === 'today' ? (
        <TodayPanel tenantId={tenantId} venueId={venueId} timezone={timezone} canManage />
      ) : current === 'reservations' ? (
        <ReservationsPanel tenantId={tenantId} venueId={venueId} timezone={timezone} canManage />
      ) : current === 'floor' ? (
        <LiveFloorPanel tenantId={tenantId} venueId={venueId} timezone={timezone} />
      ) : current === 'deposits' ? (
        <DepositRulesPanel tenantId={tenantId} venueId={venueId} />
      ) : (
        <VenueLayoutPanel tenantId={tenantId} venueId={venueId} />
      )}
    </div>
  );
}
