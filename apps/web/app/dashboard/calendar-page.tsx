'use client';

import { useState } from 'react';

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
  const [view, setView] = useState<'reservations' | 'availability'>('reservations');
  return (
    <div className="space-y-4">
      <SegmentedControl<'reservations' | 'availability'>
        label="Calendar view"
        value={view}
        onChange={setView}
        options={[
          { value: 'reservations', label: 'Reservations' },
          { value: 'availability', label: 'Availability and blocks' },
        ]}
      />
      {view === 'reservations' ? (
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
