'use client';
import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { ClockSyncStatus } from './clock-sync';
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
  const [tab, setTab] = useState('overview');
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
      <Tabs value={tab} onValueChange={setTab} className="gap-5">
        <TabsList className="h-auto max-w-full flex-wrap justify-start">
          {['Overview', 'Availability', 'Restrictions', 'Blocks', 'Sync health'].map((label) => (
            <TabsTrigger key={label} value={label.toLowerCase().replace(' ', '-')}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview" className="space-y-5">
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
          <Card>
            <CardHeader>
              <CardTitle>Tonight by room type</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {snapshot.data?.data?.roomTypes.map((type) => {
                const day = type.days.find((d) => d.date === today);
                return (
                  <div
                    key={type.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-b pb-3 last:border-0"
                  >
                    <strong>{type.name}</strong>
                    <span>
                      {day?.availableUnits === undefined
                        ? 'Updating'
                        : `${day.availableUnits} available`}{' '}
                      {day?.status === 'closed' ? ' / Closed for sale' : ''}
                    </span>
                  </div>
                );
              }) ?? <p>Availability is being synchronized.</p>}
              <Button variant="outline" onClick={() => setTab('availability')}>
                View availability by date
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="availability">
          <ClockAvailabilityPanel tenantId={tenantId} propertyId={propertyId} />
        </TabsContent>
        <TabsContent value="restrictions">
          <ClockAvailabilityPanel tenantId={tenantId} propertyId={propertyId} view="restrictions" />
        </TabsContent>
        <TabsContent value="blocks">
          <Card>
            <CardHeader>
              <CardTitle>Room blocks</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p>
                Clock does not currently supply complete block records through this integration. A
                room being unavailable does not tell us whether it is booked, under maintenance or
                manually blocked.
              </p>
              <p className="text-sm text-muted-foreground">
                Saved sale closures and arrival/departure restrictions are available separately.
              </p>
              <Button variant="outline" onClick={() => setTab('restrictions')}>
                View sale closures and restrictions
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="sync-health">
          <ClockSyncStatus tenantId={tenantId} propertyId={propertyId} details inventoryOnly />
        </TabsContent>
      </Tabs>
      <p className="text-sm text-muted-foreground">
        Change stock and selling restrictions in Clock. New bookings always check the latest price
        and availability before confirmation.
      </p>
    </div>
  );
}
