// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReservationDetail } from './reservation-detail';
import { DashboardQueryProvider } from './query-provider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.unstubAllGlobals());

describe('ReservationDetail permissions', () => {
  it.each(['CONFIRMED', 'AVAILABILITY_FAILED'])(
    'keeps actions and balances correct for %s without capabilities',
    async (status) => {
      const booking = {
        id: 'booking-1',
        externalReference: 'MB-1',
        status,
        detailsManagedInClock: status === 'CONFIRMED',
        paymentMethod: 'PAY_AT_HOTEL',
        source: null,
        startsOn: '2026-11-01',
        endsOn: '2026-11-03',
        createdAt: '2026-10-01T10:00:00.000Z',
        adults: 2,
        children: 0,
        specialRequests: null,
        roomName: null,
        roomTypeName: 'Double',
        ratePlanName: 'Flexible',
        guestId: 'guest-1',
        guestFirstName: 'Ada',
        guestLastName: 'Lovelace',
        guestEmail: 'ada@example.test',
        guestPhone: null,
        total: { amount: '100.00', currency: 'EUR' },
        paidAmount: status === 'CONFIRMED' ? '100.00' : '0.00',
        refundedAmount: '0.00',
        version: 1,
        updatedAt: '2026-10-01T10:00:00.000Z',
        externalBookingId: null,
        nightlyRates: null,
        cancellation: { isFree: false, freeUntilHours: null, cutoffAt: null },
        guestAddress: {
          street: null,
          line2: null,
          city: null,
          county: null,
          postcode: null,
        },
        clockFolios: [],
        activity: [],
      };
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) =>
          Promise.resolve(
            new Response(
              JSON.stringify(
                url.endsWith('/payments/bookings/booking-1')
                  ? { entries: [] }
                  : url.endsWith('/bookings/unseen')
                    ? { count: 0, ids: [] }
                    : booking,
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
          if (!container.textContent?.includes('MB-1'))
            throw new Error('Reservation details have not finished loading yet.');
        });
      });

      if (status === 'AVAILABILITY_FAILED')
        expect(container.textContent).toContain('No balance - booking was not created');
      if (status === 'CONFIRMED') {
        expect(container.textContent).toContain('Cancellation terms are managed in Clock');
        expect(container.textContent).not.toContain('Non-refundable');
      }
      expect(container.textContent).not.toContain('Cancel reservation');
      expect(container.textContent).not.toContain('Refund');
      expect(container.textContent).not.toContain('Edit reservation');
      await act(async () => root.unmount());
    },
  );
});
