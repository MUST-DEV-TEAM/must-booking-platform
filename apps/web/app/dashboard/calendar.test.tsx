// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { bookingsForDay, DashboardCalendar, type CalendarAvailability } from './calendar';
import type { Reservation } from './reservations';

const roomTypes = [
  { id: 'deluxe', name: 'Deluxe King' },
  { id: 'standard', name: 'Standard Double' },
];
const availability: CalendarAvailability[] = [
  {
    roomTypeId: 'deluxe',
    startsOn: '2026-08-10',
    endsOn: '2026-08-11',
    isAvailable: true,
    availableUnits: 2,
  },
  {
    roomTypeId: 'standard',
    startsOn: '2026-08-10',
    endsOn: '2026-08-11',
    isAvailable: true,
    availableUnits: 1,
  },
  {
    roomTypeId: 'deluxe',
    startsOn: '2026-08-11',
    endsOn: '2026-08-12',
    isAvailable: false,
    availableUnits: 0,
  },
  {
    roomTypeId: 'standard',
    startsOn: '2026-08-11',
    endsOn: '2026-08-12',
    isAvailable: true,
    availableUnits: 2,
  },
];
const reservation = (
  id: string,
  startsOn: string,
  endsOn: string,
  firstName: string,
  status = 'CONFIRMED',
): Reservation => ({
  id,
  guestId: `guest-${id}`,
  guestFirstName: firstName,
  guestLastName: 'Guest',
  guestEmail: `${id}@example.test`,
  guestPhone: null,
  guestStreetAddress: null,
  guestAddressLine2: null,
  guestCity: null,
  guestCounty: null,
  guestPostcode: null,
  roomTypeId: 'deluxe',
  roomTypeName: 'Deluxe King',
  ratePlanId: 'flex',
  ratePlanName: 'Flexible',
  startsOn,
  endsOn,
  status,
  paymentMethod: 'PAY_AT_HOTEL',
  total: { amount: '120.00', currency: 'EUR' },
  externalReference: id,
  version: 1,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
});
const bookings = [
  reservation('arrival', '2026-08-10', '2026-08-12', 'Ada'),
  reservation('departure', '2026-08-08', '2026-08-10', 'Grace'),
  reservation('in-house', '2026-08-09', '2026-08-11', 'Lin'),
  reservation('payment-failed', '2026-08-10', '2026-08-12', 'Failed', 'PAYMENT_FAILED'),
];

describe('Dashboard calendar', () => {
  const props = {
    tenantId: 'tenant-1',
    propertyId: 'property-1',
    initialMonth: '2026-08',
    initialRoomTypes: roomTypes,
    initialAvailability: availability,
    initialBookings: bookings,
  };

  it('renders a month grid with per-room-type remaining inventory', () => {
    const markup = renderToStaticMarkup(createElement(DashboardCalendar, props));
    expect(markup).toContain('August 2026');
    expect(markup).toContain('Deluxe King');
    expect(markup).toContain('Standard Double');
    expect(markup).toContain('Sold out');
  });

  it('classifies arrivals, departures, and in-house bookings for a selected day', () => {
    const day = bookingsForDay(bookings, '2026-08-10');
    expect(day.arrivals).toEqual([bookings[0]]);
    expect(day.departures).toEqual([bookings[1]]);
    expect(day.inHouse).toEqual([bookings[2]]);
    expect([...day.arrivals, ...day.departures, ...day.inHouse]).not.toContain(bookings[3]);
  });

  it('opens a read-only day drill-in from the month grid', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement(DashboardCalendar, props)));
    await act(async () => container.querySelector('button[aria-label="Open 2026-08-10"]')!.click());
    const drillIn = container.querySelector('[aria-label="Day bookings"]');
    expect(drillIn?.textContent).toContain('Arrivals (1)');
    expect(drillIn?.textContent).toContain('Departures (1)');
    expect(drillIn?.textContent).toContain('In house (1)');
    expect(drillIn?.textContent).not.toContain('Failed Guest');
    expect(drillIn?.textContent).toContain('Read-only operational view');
    await act(async () => root.unmount());
    container.remove();
  });
});
