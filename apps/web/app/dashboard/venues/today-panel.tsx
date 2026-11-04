'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Button } from '../../../components/ui/button';
import { StatTile } from '../../../components/ui/stat-tile';
import { QuickBookingDialog } from './quick-booking-dialog';
import { reservationApi } from './reservation-api';
import { dateInZone, dayLabel } from './reservation-display';
import { ReservationTable } from './reservation-table';

/** Today at a glance: the stats, the bookings in time order, and a quick way to add one. */
export function TodayPanel({
  tenantId,
  venueId,
  timezone,
  canManage,
}: {
  tenantId: string;
  venueId: string;
  timezone: string;
  canManage: boolean;
}) {
  const today = dateInZone(timezone);
  const [booking, setBooking] = useState(false);
  const list = useQuery({
    queryKey: ['venue-reservations', tenantId, venueId, today, today, '', ''],
    queryFn: () => reservationApi.list(tenantId, venueId, { from: today }),
    refetchInterval: 30_000,
  });

  if (list.isPending) return <p className="text-sm text-muted-foreground">Loading today…</p>;
  if (list.isError)
    return (
      <Alert variant="destructive">
        <AlertDescription>{list.error.message}</AlertDescription>
      </Alert>
    );

  const active = list.data.reservations.filter((r) =>
    ['pending_payment', 'confirmed', 'seated', 'completed'].includes(r.status),
  );
  const guests = (statuses: string[]) =>
    active.filter((r) => statuses.includes(r.status)).reduce((sum, r) => sum + r.partySize, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{dayLabel(today)}</p>
        {canManage ? <Button onClick={() => setBooking(true)}>New booking</Button> : null}
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Bookings today" value={active.length} />
        <StatTile
          label="Still to arrive"
          value={guests(['pending_payment', 'confirmed'])}
          note="guests"
        />
        <StatTile label="At the tables now" value={guests(['seated'])} note="guests" />
        <StatTile label="Finished" value={guests(['completed'])} note="guests" />
      </div>
      <ReservationTable
        tenantId={tenantId}
        venueId={venueId}
        timezone={timezone}
        reservations={list.data.reservations}
        canManage={canManage}
        emptyTitle="No bookings today yet"
      />
      {booking ? (
        <QuickBookingDialog
          tenantId={tenantId}
          venueId={venueId}
          today={today}
          initialDate={today}
          onOpenChange={(open) => {
            if (!open) setBooking(false);
          }}
        />
      ) : null}
    </div>
  );
}
