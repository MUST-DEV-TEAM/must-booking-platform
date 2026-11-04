'use client';

import { useQuery } from '@tanstack/react-query';

import { Alert, AlertDescription, AlertTitle } from '../../../components/ui/alert';
import { TabBar } from '../../../components/ui/tab-bar';
import { usePlanUsage } from '../plan-access';
import { RestaurantSetupWizard } from './restaurant-setup-wizard';
import { venueApi, type Venue } from './venue-api';
import { VenueSetup } from './venue-setup';
import { useVenueStaff } from './venue-access';

type TenantRole = 'OWNER' | 'ADMIN' | 'STAFF';

/**
 * The Restaurants page of the dashboard. A restaurant is switched on in Settings -> Integrations;
 * until its first-time setup is finished this page shows the setup guide, and afterwards the
 * restaurant itself. One restaurant opens straight away; several get a tab each.
 */
export function RestaurantsSection({
  tenantId,
  role,
  venueId,
  onSelectVenue,
}: {
  tenantId: string;
  role: TenantRole;
  /** The restaurant named in the address, if any; otherwise the first one opens. */
  venueId: string | null;
  onSelectVenue: (venueId: string) => void;
}) {
  const plan = usePlanUsage(tenantId);
  const diningEnabled = plan.data?.plan.diningEnabled === true;
  const venues = useQuery({
    queryKey: ['venues', tenantId],
    queryFn: () => venueApi.listVenues(tenantId),
    enabled: diningEnabled,
  });

  if (plan.isPending) return <p className="text-sm text-muted-foreground">Loading restaurants…</p>;
  if (!diningEnabled)
    return (
      <Alert variant="info">
        <AlertTitle>Restaurants are not part of your plan</AlertTitle>
        <AlertDescription>
          Your plan does not include restaurants. Contact MUST to add table bookings.
        </AlertDescription>
      </Alert>
    );
  if (venues.isPending)
    return <p className="text-sm text-muted-foreground">Loading restaurants…</p>;
  if (venues.isError)
    return (
      <Alert variant="destructive">
        <AlertDescription>{venues.error.message}</AlertDescription>
      </Alert>
    );

  const active = venues.data.filter((venue) => venue.active);
  const selected = active.find((venue) => venue.id === venueId) ?? active[0] ?? null;
  if (!selected)
    return (
      <Alert variant="info">
        <AlertTitle>The restaurant is switched off</AlertTitle>
        <AlertDescription>
          {role === 'STAFF'
            ? 'Ask an owner or administrator to switch the restaurant on.'
            : 'Switch it on in Settings → Integrations to start taking table bookings.'}
        </AlertDescription>
      </Alert>
    );

  return (
    <div className="space-y-6">
      {active.length > 1 ? (
        <TabBar
          label="Restaurants"
          tabs={active.map((venue) => ({ id: venue.id, label: venue.name }))}
          current={selected.id}
          onSelect={onSelectVenue}
        />
      ) : null}
      {selected.setupCompletedAt ? (
        <VenueSetup key={selected.id} tenantId={tenantId} venueId={selected.id} />
      ) : (
        <FirstTimeSetup key={selected.id} tenantId={tenantId} role={role} venue={selected} />
      )}
    </div>
  );
}

/** Until the setup is finished only people who can manage the restaurant see the guide. */
function FirstTimeSetup({
  tenantId,
  role,
  venue,
}: {
  tenantId: string;
  role: TenantRole;
  venue: Venue;
}) {
  // Asking for the staff list doubles as the permission check: only managers may see it.
  const staff = useVenueStaff(tenantId, venue.id);
  const canManage = role !== 'STAFF' || staff.isSuccess;
  if (role === 'STAFF' && staff.isPending)
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!canManage)
    return (
      <Alert variant="info">
        <AlertTitle>{venue.name} is not ready yet</AlertTitle>
        <AlertDescription>
          The restaurant manager is still setting it up. It will appear here when they finish.
        </AlertDescription>
      </Alert>
    );
  return <RestaurantSetupWizard tenantId={tenantId} venueId={venue.id} />;
}
