// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CalendarBoard } from './calendar-board';
import { DashboardQueryProvider } from './query-provider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.unstubAllGlobals());

describe('CalendarBoard permissions', () => {
  it('hides booking and block actions when the actor lacks their capabilities', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.includes('/booking-rules/evaluate'))
        return new Response(
          JSON.stringify({
            today: '2026-10-18',
            disabledDates: [],
            minStayNights: null,
            maxStayNights: null,
            booking: { valid: false, errors: [] },
            block: { valid: false, errors: [] },
          }),
        );
      if (url.includes('/bookings/board'))
        return new Response(JSON.stringify({ items: [], truncated: false }));
      if (url.endsWith('/room-types'))
        return new Response(JSON.stringify([{ id: 'type-1', name: 'Double', roomCount: 1 }]));
      if (url.endsWith('/rooms'))
        return new Response(JSON.stringify([{ id: 'room-1', name: '101', roomTypeId: 'type-1' }]));
      return new Response(JSON.stringify([]));
    });
    vi.stubGlobal('fetch', fetch);
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(
          DashboardQueryProvider,
          undefined,
          createElement(CalendarBoard, {
            tenantId: 't',
            propertyId: 'p',
            bookingMode: 'MIXED',
            canManageAvailability: false,
            canCreateBooking: false,
          }),
        ),
      );
    });
    await act(async () => {
      await vi.waitFor(() => {
        if (!container.textContent?.includes('Reservations calendar'))
          throw new Error('Calendar has not finished loading yet.');
      });
    });

    expect(container.textContent).not.toContain('Add reservation');
    expect(fetch.mock.calls.some(([url]) => url.includes('/availability-blocks'))).toBe(true);
    await act(async () => {
      const cell = container.querySelector<HTMLElement>('.cursor-cell')!;
      cell.getBoundingClientRect = () => ({
        left: 0,
        right: 100,
        top: 0,
        bottom: 20,
        width: 100,
        height: 20,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
      cell.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 50 }));
    });
    expect(container.textContent).not.toContain('Block these nights');
    expect(container.textContent).not.toContain('Add reservation');

    await act(async () => root.unmount());
  });
});
