// @vitest-environment jsdom
import { mountMoneyScreen, expectHotelAmount } from '../../lib/money-test-utils';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReservationsPage } from './reservations-page';
import { DashboardQueryProvider } from './query-provider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.unstubAllGlobals());

describe('ReservationsPage permissions', () => {
  it('hides both add-reservation entry points without bookings.create', async () => {
    const result = {
      items: [],
      total: 0,
      page: 1,
      pageSize: 10,
      counts: {
        all: 0,
        arriving_today: 0,
        in_house: 0,
        departing_today: 0,
        upcoming: 0,
        needs_attention: 0,
        unpaid: 0,
        cancelled: 0,
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          new Response(JSON.stringify(url.endsWith('/unseen') ? { count: 0, ids: [] } : result)),
        ),
      ),
    );
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(
          DashboardQueryProvider,
          undefined,
          createElement(ReservationsPage, {
            tenantId: 't',
            propertyId: 'p',
            canCreateBooking: false,
          }),
        ),
      );
    });
    await act(async () => {
      await vi.waitFor(() => {
        if (!container.textContent?.includes('No reservations yet'))
          throw new Error('Reservations have not finished loading yet.');
      });
    });

    expect(container.textContent).not.toContain('Add reservation');
    expect(container.textContent).not.toContain('Add the first reservation');
    await act(async () => root.unmount());
  });
});

it.each(['EUR', 'ALL'])('reservations table and quick peek preserve %s', async (currency) => {
  const booking = {
    id: 'one',
    externalReference: 'TEST-1',
    status: 'CONFIRMED',
    paymentMethod: 'PAY_AT_HOTEL',
    paymentState: 'UNPAID',
    source: 'DIRECT',
    startsOn: '2026-11-01',
    endsOn: '2026-11-03',
    createdAt: '2026-10-28T12:00:00Z',
    adults: 2,
    children: 0,
    specialRequests: null,
    pmsStayStatus: null,
    roomId: null,
    roomName: null,
    roomTypeId: 'rt',
    roomTypeName: 'Suite',
    ratePlanName: 'Flexible',
    guestId: 'guest',
    guestFirstName: 'Ada',
    guestLastName: 'Guest',
    guestEmail: 'ada@test',
    guestPhone: null,
    total: { amount: '5000.00', currency },
    paidAmount: '0.00',
    refundedAmount: '0.00',
  };
  const view = await mountMoneyScreen(
    createElement(ReservationsPage, { tenantId: 't', propertyId: 'p' }),
    (url) =>
      url.endsWith('/unseen')
        ? { count: 0, ids: [] }
        : {
            items: [booking],
            total: 1,
            page: 1,
            pageSize: 10,
            counts: {
              all: 1,
              arriving_today: 0,
              in_house: 0,
              departing_today: 0,
              upcoming: 1,
              needs_attention: 0,
              unpaid: 1,
              cancelled: 0,
            },
          },
  );
  await expectHotelAmount(view, currency, '5000.00');
  const row = view.host.querySelector('tbody tr');
  if (!row) throw Error('Reservation row missing');
  await act(async () => (row as HTMLElement).click());
  await view.settle();
  await expectHotelAmount(view, currency, '5000.00');
  await act(async () => view.root.unmount());
});
