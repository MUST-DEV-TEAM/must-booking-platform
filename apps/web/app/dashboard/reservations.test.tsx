// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DashboardReservations, filterReservations, type Reservation } from './reservations';
import { DashboardQueryProvider } from './query-provider';

const bookings: Reservation[] = [
  {
    id: 'booking-ada',
    guestId: 'guest-ada',
    guestFirstName: 'Ada',
    guestLastName: 'Lovelace',
    guestEmail: 'ada@example.test',
    guestPhone: '+355 69 111 2222',
    guestStreetAddress: null,
    guestAddressLine2: null,
    guestCity: null,
    guestCounty: null,
    guestPostcode: null,
    specialRequests: 'Late arrival after 22:00.\nPlease prepare a baby cot.',
    roomTypeId: 'room-deluxe',
    roomTypeName: 'Deluxe King',
    ratePlanId: 'rate-flex',
    ratePlanName: 'Flexible',
    startsOn: '2026-08-10',
    endsOn: '2026-08-13',
    status: 'CONFIRMED',
    paymentMethod: 'PAY_AT_HOTEL',
    total: { amount: '360.00', currency: 'EUR' },
    externalReference: 'MUST-ADA',
    version: 1,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
  },
  {
    id: 'booking-grace',
    guestId: 'guest-grace',
    guestFirstName: 'Grace',
    guestLastName: 'Hopper',
    guestEmail: 'grace@example.test',
    guestPhone: null,
    guestStreetAddress: null,
    guestAddressLine2: null,
    guestCity: null,
    guestCounty: null,
    guestPostcode: null,
    roomTypeId: 'room-standard',
    roomTypeName: 'Standard Double',
    ratePlanId: 'rate-nonref',
    ratePlanName: 'Non-refundable',
    startsOn: '2026-08-20',
    endsOn: '2026-08-22',
    status: 'CANCELLED',
    paymentMethod: 'STRIPE',
    total: { amount: '180.00', currency: 'EUR' },
    externalReference: 'MUST-GRACE',
    version: 2,
    createdAt: '2026-08-02T10:00:00.000Z',
    updatedAt: '2026-08-03T10:00:00.000Z',
  },
];

describe('Dashboard reservations', () => {
  it('renders booking guest, room, rate, status, and payment data from the bookings projection', () => {
    const markup = renderToStaticMarkup(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(DashboardReservations, {
          tenantId: 'tenant-1',
          propertyId: 'property-1',
          initialBookings: bookings,
        }),
      ),
    );
    expect(markup).toContain('Ada Lovelace');
    expect(markup).toContain('Deluxe King');
    expect(markup).toContain('Flexible');
    expect(markup).toContain('data-domain="booking"');
    expect(markup).toContain('data-state="confirmed"');
    expect(markup).toContain('>Confirmed</span>');
    expect(markup).toContain('pay at hotel');
    expect(markup).toContain('€360.00');
  });

  it('filters by guest name, status, and overlapping stay date range', () => {
    expect(
      filterReservations(bookings, { search: 'lovelace', status: '', from: '', to: '' }),
    ).toEqual([bookings[0]]);
    expect(
      filterReservations(bookings, { search: '', status: 'CANCELLED', from: '', to: '' }),
    ).toEqual([bookings[1]]);
    expect(
      filterReservations(bookings, {
        search: '',
        status: '',
        from: '2026-08-11',
        to: '2026-08-12',
      }),
    ).toEqual([bookings[0]]);
    expect(
      filterReservations(bookings, {
        search: '',
        status: '',
        from: '2026-08-14',
        to: '2026-08-19',
      }),
    ).toEqual([]);
  });

  it('opens and closes the client-side detail panel for the selected booking', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(
          DashboardQueryProvider,
          undefined,
          createElement(DashboardReservations, {
            tenantId: 'tenant-1',
            propertyId: 'property-1',
            initialBookings: bookings,
          }),
        ),
      );
    });
    const detailButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'View details',
    )!;
    await act(async () => detailButton.click());
    expect(container.querySelector('[aria-label="Reservation details"]')?.textContent).toContain(
      'MUST-ADA',
    );
    expect(container.textContent).toContain('Ada Lovelace');
    expect(container.textContent).toContain('Late arrival after 22:00.');
    const closeButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Close details',
    )!;
    await act(async () => closeButton.click());
    expect(container.querySelector('[aria-label="Reservation details"]')).toBeNull();
    await act(async () => root.unmount());
    container.remove();
  });
});
