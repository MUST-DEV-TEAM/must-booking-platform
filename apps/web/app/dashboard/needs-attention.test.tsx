// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NeedsAttentionTab } from './overview';
import { DashboardQueryProvider } from './query-provider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const baseOverview = {
  kpis: {
    date: '2026-08-24',
    arrivals: 2,
    departures: 1,
    inHouse: 4,
    bookedRoomNights: 5,
    availableRoomNights: 7,
    occupancyRate: 71,
  },
  recentActivity: [],
};

afterEach(() => vi.unstubAllGlobals());

describe('NeedsAttentionTab', () => {
  it('lists the overview attention items with semantic status badges', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ...baseOverview,
            needsAttention: [
              {
                id: 'booking-1',
                status: 'PAYMENT_FAILED',
                startsOn: '2026-08-24',
                endsOn: '2026-08-26',
                guestName: 'Ada Guest',
                guestEmail: 'ada@example.test',
                roomTypeName: 'Double room',
              },
              {
                id: 'booking-2',
                status: 'MANUAL_REVIEW',
                startsOn: '2026-08-25',
                endsOn: '2026-08-27',
                guestName: null,
                guestEmail: 'grace@example.test',
                roomTypeName: 'Suite',
              },
            ],
          }),
        ),
    );
    vi.stubGlobal('fetch', fetch);

    const { container, root } = await mount();

    expect(container.textContent).toContain('Ada Guest');
    expect(container.textContent).toContain('grace@example.test');
    expect(container.textContent).toContain('payment failed');
    expect(container.textContent).toContain('Needs review');
    expect(container.querySelector('[data-domain="payment"][data-state="failed"]')).not.toBeNull();
    expect(container.querySelector('[data-domain="booking"][data-state="pending"]')).not.toBeNull();
    expect(container.querySelector('ul[aria-label="Bookings needing attention"]')).not.toBeNull();

    await act(async () => root.unmount());
  });

  it('renders an actionable empty state when there are no attention items', async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ ...baseOverview, needsAttention: [] })),
    );
    vi.stubGlobal('fetch', fetch);

    const { container, root } = await mount();

    expect(container.querySelector('.must-state-panel--empty')).not.toBeNull();
    expect(container.textContent).toContain('No bookings need attention');
    expect(
      container.querySelector('a[href="/dashboard/t?propertyId=p&section=overview&tab=overview"]'),
    ).not.toBeNull();

    await act(async () => root.unmount());
  });
});

async function mount() {
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(NeedsAttentionTab, { tenantId: 't', propertyId: 'p' }),
      ),
    );
  });
  await act(async () => {
    await vi.waitFor(() => {
      if (!container.textContent?.includes('Needs attention'))
        throw new Error('Needs attention has not finished loading yet.');
    });
  });
  return { container, root };
}
