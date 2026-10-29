// @vitest-environment jsdom
import { mountMoneyScreen, expectHotelAmount } from '../../lib/money-test-utils';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DashboardQueryProvider } from './query-provider';
import { ReservationDetail } from './reservation-detail';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.unstubAllGlobals());

const booking = (promo: unknown) => ({
  id: 'booking-1',
  externalReference: 'MB-PROMO',
  status: 'CONFIRMED',
  detailsManagedInClock: true,
  paymentMethod: 'PAY_AT_HOTEL',
  source: null,
  startsOn: '2027-05-10',
  endsOn: '2027-05-12',
  createdAt: '2026-10-26T10:00:00.000Z',
  adults: 2,
  children: 0,
  specialRequests: null,
  roomName: null,
  roomTypeName: 'APP',
  ratePlanName: 'Flexible',
  guestId: 'guest-1',
  guestFirstName: 'John',
  guestLastName: 'Doe',
  guestEmail: 'john.doe@example.test',
  guestPhone: null,
  total: { amount: '270.00', currency: 'EUR' },
  paidAmount: '0.00',
  refundedAmount: '0.00',
  version: 1,
  updatedAt: '2026-10-26T10:00:00.000Z',
  externalBookingId: '39048664',
  nightlyRates: null,
  promo,
  cancellation: { isFree: true, freeUntilHours: null, cutoffAt: null },
  guestAddress: { street: null, line2: null, city: null, county: null, postcode: null },
  clockFolios: [],
  activity: [],
});

async function open(detail: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            url.endsWith('/capabilities/mine')
              ? []
              : url.endsWith('/payments/bookings/booking-1')
                ? { entries: [] }
                : url.endsWith('/bookings/unseen')
                  ? { count: 0, ids: [] }
                  : detail,
          ),
        ),
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
        createElement(ReservationDetail, {
          tenantId: 't',
          propertyId: 'p',
          bookingId: 'booking-1',
        }),
      ),
    );
  });
  await act(async () => {
    await vi.waitFor(() => {
      if (!container.textContent?.includes('MB-PROMO')) throw new Error('Not loaded yet.');
    });
  });
  const text = container.textContent ?? '';
  await act(async () => root.unmount());
  return text;
}

describe('ReservationDetail promo code', () => {
  it('shows the code, the price before it, the discount and what the guest pays', async () => {
    const text = await open(
      booking({
        code: 'WELCOME10',
        discount: { amount: '30.00', currency: 'EUR' },
        originalTotal: { amount: '300.00', currency: 'EUR' },
      }),
    );

    expect(text).toContain('Promo code');
    expect(text).toContain('WELCOME10');
    expect(text).toContain('Price before the code');
    expect(text).toContain('Guest pays');
  });

  it('shows nothing about promo codes when none was used', async () => {
    const text = await open(booking(null));

    expect(text).not.toContain('Price before the code');
  });
});

it.each(['EUR', 'ALL'])('reservation promo and nightly amounts preserve %s', async (currency) => {
  const detail = {
    ...booking({
      code: 'TEST',
      discount: { amount: '5000.00', currency },
      originalTotal: { amount: '10000.00', currency },
    }),
    total: { amount: '5000.00', currency },
    nightlyRates: [{ date: '2027-05-10', amount: '5000.00' }],
  };
  const view = await mountMoneyScreen(
    createElement(ReservationDetail, {
      tenantId: 't',
      propertyId: 'p',
      bookingId: 'booking-1',
    }),
    (url) =>
      url.endsWith('/capabilities/mine')
        ? []
        : url.includes('/payments/bookings/')
          ? { entries: [] }
          : url.endsWith('/bookings/unseen')
            ? { count: 0, ids: [] }
            : url.includes('/clock-sync/financial/')
              ? { status: 'NOT_CONNECTED' }
              : detail,
  );
  await expectHotelAmount(view, currency, '5000.00');
  expect(view.host.textContent).toContain('Nightly rates');
  expect(view.host.textContent).not.toContain('[object Object]');
  if (currency === 'ALL')
    expect(view.host.textContent).toContain('(\u2248 \u2212\u20ac50.00, estimate)');
  await act(async () => view.root.unmount());
});
