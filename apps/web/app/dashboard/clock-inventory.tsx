'use client';
import { ClockRoomsTile } from './clock-room-counts';
import { ClockAvailabilityPanel } from './clock-availability-panel';
import { availableOn, useClockSnapshot, type ClockMonth } from './clock-sync';
import { PageHeader } from '../../components/ui/page-header';
import { StatTile } from '../../components/ui/stat-tile';
export function ClockInventory({
  tenantId,
  propertyId,
  timezone = 'UTC',
}: {
  tenantId: string;
  propertyId: string;
  timezone?: string;
}) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  const today = `${part('year')}-${part('month')}-${part('day')}`;
  const snapshot = useClockSnapshot<ClockMonth>(
    tenantId,
    propertyId,
    'availability:' + today.slice(0, 7),
  );
  const days = snapshot.data?.data?.roomTypes.map((t) => t.days.find((d) => d.date === today));
  const complete = days?.length && days.every((d) => d && d.status !== 'unavailable');
  const count = (test: (day: NonNullable<NonNullable<typeof days>[number]>) => boolean) =>
    complete ? days!.filter((d) => d && test(d)).length : 'Updating';
  return (
    <div className="space-y-5">
      <PageHeader
        title="Inventory"
        description="Room availability and selling restrictions synchronized from Clock."
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ClockRoomsTile tenantId={tenantId} propertyId={propertyId} />
        <StatTile
          label="Available tonight"
          value={availableOn(snapshot.data?.data, today) ?? 'Updating'}
          note="Saved Clock availability for one adult"
        />
        <StatTile
          label="Room types closed today"
          value={count((d) => d.status === 'closed')}
          note="Closed for sale, separate from sold out"
        />
        <StatTile
          label="Room types with restrictions today"
          value={count((d) =>
            Boolean((d.minStay && d.minStay > 1) || d.closedToArrival || d.closedToDeparture),
          )}
          note="Minimum stay or arrival/departure limits"
        />
      </div>
      <ClockAvailabilityPanel tenantId={tenantId} propertyId={propertyId} />
      <p className="text-sm text-muted-foreground">
        Change stock and selling restrictions in Clock. New bookings always check the latest price
        and availability before confirmation.
      </p>
    </div>
  );
}
