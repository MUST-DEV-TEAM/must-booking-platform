'use client';

import { useState } from 'react';
import { usePmsSource } from './use-pms-source';
import { Button } from '../../components/ui/button';

import { SegmentedControl } from '../../components/ui/segmented-control';
import { DashboardCalendar } from './calendar';
import { CalendarBoard } from './calendar-board';

type BookingMode = 'ROOM_TYPE_ONLY' | 'INDIVIDUAL_ROOM_ONLY' | 'MIXED';

/**
 * The Calendar section: the reservations timeline first, and the selling-availability grid (with
 * blocking dates) one switch away. Both read the same hotel; they answer different questions.
 */
export function CalendarPage({
  tenantId,
  propertyId,
  bookingMode,
  canManageAvailability,
  canCreateBooking,
}: {
  tenantId: string;
  propertyId: string;
  bookingMode?: BookingMode;
  canManageAvailability: boolean;
  canCreateBooking: boolean;
}) {
  const source = usePmsSource(tenantId, propertyId);
  const clock = source.data === 'CLOCK_PMS';
  const [view, setView] = useState<'reservations' | 'availability'>('reservations');
  return (
    <div className="space-y-4">
      {clock ? (
        <div className="flex justify-end">
          <Button asChild variant="outline">
            <a href={`/dashboard/${tenantId}?propertyId=${propertyId}&section=inventory`}>
              View availability and restrictions
            </a>
          </Button>
        </div>
      ) : (
        <SegmentedControl<'reservations' | 'availability'>
          label="Calendar view"
          value={view}
          onChange={setView}
          options={[
            { value: 'reservations', label: 'Reservations' },
            { value: 'availability', label: 'Availability and blocks' },
          ]}
        />
      )}
      {clock || view === 'reservations' ? (
        <CalendarBoard
          tenantId={tenantId}
          propertyId={propertyId}
          bookingMode={bookingMode}
          canManageAvailability={canManageAvailability}
          canCreateBooking={canCreateBooking}
        />
      ) : (
        <DashboardCalendar
          tenantId={tenantId}
          propertyId={propertyId}
          bookingMode={bookingMode}
          canManageAvailability={canManageAvailability}
        />
      )}
    </div>
  );
}
