// @vitest-environment jsdom
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
