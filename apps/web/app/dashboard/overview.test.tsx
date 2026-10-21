// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DashboardOverview, type Overview } from './overview';
import { DashboardQueryProvider } from './query-provider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const overview = {
  kpis: {
    date: '2026-08-02',
    arrivals: 2,
    departures: 1,
    inHouse: 4,
    bookedRoomNights: 5,
    availableRoomNights: 7,
    occupancyRate: 71,
  },
  revenue: { today: { amount: '350.00', currency: 'EUR' } },
  balanceDueAtDesk: { amount: '120.00', currency: 'EUR' },
  newBookingsSinceYesterday: 3,
  needsAttentionCount: 1,
  todaysArrivals: [
    {
      id: 'arrival-1',
      externalReference: 'MB-1001',
      guestName: 'Ana Arrival',
      guestEmail: 'ana@example.test',
      roomTypeName: 'Double room',
      adults: 2,
      children: 0,
      hasSpecialRequests: true,
      paymentMethod: 'PAY_AT_HOTEL',
      totalAmount: '120.00',
      currency: 'EUR',
    },
  ],
  todaysDepartures: [],
  upcomingArrivals: [
    {
      id: 'upcoming-1',
      externalReference: 'MB-1002',
      guestName: 'Uma Upcoming',
      guestEmail: 'uma@example.test',
      roomTypeName: 'Suite',
      adults: 1,
      children: 1,
      hasSpecialRequests: false,
      paymentMethod: 'PAY_AT_HOTEL',
      totalAmount: '200.00',
      currency: 'EUR',
      startsOn: '2026-08-05',
    },
  ],
  soldOutRooms: [
    { roomId: 'room-1', roomName: '102', roomTypeName: 'Double room', reason: 'blocked' as const },
  ],
  recentCancellations: [
    {
      id: 'cancelled-1',
      externalReference: 'MB-1003',
      guestName: 'Cara Cancelme',
      guestEmail: 'cara@example.test',
      roomTypeName: 'Double room',
      startsOn: '2026-08-06',
      endsOn: '2026-08-07',
      cancelledAt: '2026-08-02T09:00:00.000Z',
    },
  ],
  recentActivity: [
    {
      id: 'audit-1',
      action: 'booking.created',
      createdAt: '2026-08-02T10:00:00.000Z',
      summary: 'Ana Arrival booked — Double room, 2026-08-02 to 2026-08-04',
    },
  ],
  needsAttention: [
    {
      id: 'booking-1',
      status: 'PAYMENT_FAILED',
      startsOn: '2026-08-02',
      endsOn: '2026-08-04',
      guestName: 'Ada Guest',
      guestEmail: 'ada@example.test',
      roomTypeName: 'Double room',
    },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe('DashboardOverview', () => {
  it('renders an accessible skeleton before overview data is available', async () => {
    let resolveFetch!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((resolve) => (resolveFetch = resolve))),
    );
    const { container, root } = await mount();

    expect(container.querySelector('[aria-busy="true"]')?.textContent).toContain(
      'Loading overview…',
    );

    await act(async () => {
      resolveFetch(new Response(JSON.stringify(overview)));
      await Promise.resolve();
    });
    await act(async () => root.unmount());
  });

  it('shows an error and reloads the overview when Retry succeeds', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(overview)));
    vi.stubGlobal('fetch', fetch);
    const { container, root } = await mount();

    await act(async () => {
      await settle();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Unable to load the property overview.',
    );

    await click(
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === 'Try again',
      )!,
    );

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('71.0%');
    await act(async () => root.unmount());
  });

  it('uses supplied overview data without an additional request', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { container, root } = await mount({
      initialOverview: overview,
      canManageQuickBooking: true,
    });

    expect(container.textContent).toContain('Ada Guest');
    expect(container.textContent).toContain('Ana Arrival booked');
    expect(container.textContent).toContain('New booking');
    expect(container.textContent).toContain('Add staff');
    expect(container.querySelector('a[href*="section=walk-in"]')).toBeNull();
    expect(
      container.querySelector(
        'a[href="/dashboard/tenant-1?propertyId=property-1&section=overview&tab=quick-booking"]',
      ),
    ).not.toBeNull();

    // New sections: today's arrivals/departures, upcoming arrivals, revenue,
    // balance due, sold-out rooms, and recent cancellations.
    expect(container.textContent).toContain('Today’s arrivals');
    expect(container.textContent).toContain('Ana Arrival');
    expect(container.textContent).toContain('2 adults');
    expect(container.textContent).toContain('Special request');
    expect(container.textContent).toContain('MB-1001');
    expect(container.textContent).toContain('EUR 350.00');
    expect(container.textContent).toContain('EUR 120.00');
    expect(container.textContent).toContain('Uma Upcoming');
    expect(container.textContent).toContain('1 adult, 1 child');
    expect(container.textContent).toContain('Sold out tonight');
    expect(container.textContent).toContain('Double room — 102');
    expect(container.textContent).toContain('Cara Cancelme');

    const attentionLink = container.querySelector(
      'a[href="/dashboard/tenant-1?propertyId=property-1&section=overview&tab=needs-attention"]',
    );
    expect(attentionLink?.textContent).toContain('Needs attention');
    expect(attentionLink?.textContent).toContain('1');

    expect(fetch).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it('shows only the widgets the server lists for this person and always offers My tasks', async () => {
    const fetch = vi.fn(async () => Response.json({ items: [] }));
    vi.stubGlobal('fetch', fetch);
    const { container, root } = await mount({
      initialOverview: {
        ...overview,
        view: {
          type: 'finance',
          widgets: ['tile.collectedToday', 'tile.needsAttention', 'panel.myTasks'],
        },
      },
    });
    const text = container.textContent ?? '';
    expect(text).toContain('Collected today');
    expect(text).toContain('My tasks');
    expect(text).toContain('Your tasks and the parts of the hotel you work with.');
    for (const hidden of [
      'Arrivals',
      'Departures',
      'In house',
      'Occupancy',
      'Due at the desk',
      'New bookings',
      'Today’s arrivals',
      'Upcoming arrivals',
      'Sold out tonight',
      'Recent activity',
    ])
      expect(text).not.toContain(hidden);
    await act(async () => root.unmount());
  });
  it('hides the calendar shortcut when the role cannot open calendar', async () => {
    const { container, root } = await mount({ initialOverview: overview, canOpen: () => false });
    expect(container.textContent).not.toContain('Open calendar');
    await act(async () => root.unmount());
  });

  it('hides booking creation when the capability prop is omitted', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const { container, root } = await mount({ initialOverview: overview });
    expect(container.querySelector('a[href*="tab=quick-booking"]')).toBeNull();
    await act(async () => root.unmount());
  });
  it('keeps multi-currency cash separate and Clock capacity Unknown', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const { container, root } = await mount({
      initialOverview: {
        ...overview,
        kpis: { ...overview.kpis, availableRoomNights: null, occupancyRate: null },
        revenue: {
          today: null,
          byCurrency: [
            { currency: 'EUR', amount: '1.01' },
            { currency: 'USD', amount: '2.02' },
          ],
        },
        balancesDueAtDesk: [
          { currency: 'EUR', amount: '3.00' },
          { currency: 'USD', amount: '4.00' },
        ],
        metricBasis: { source: 'CLOCK', timezone: 'UTC', moneyVisible: true },
        soldOutRooms: [],
      },
    });
    expect(container.textContent).toContain('EUR 1.01 / USD 2.02');
    expect(container.textContent).not.toContain('3.03');
    expect(container.textContent).toContain('Unknown gross room-nights');
    expect(container.textContent).toContain('synced from Clock');
    await act(async () => root.unmount());
  });
  it('hides financial headline cards when the server denies money access', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const { container, root } = await mount({
      initialOverview: {
        ...overview,
        metricBasis: { source: 'LOCAL', timezone: 'Europe/Tirane', moneyVisible: false },
      },
    });
    expect(container.textContent).not.toContain('Collected today');
    expect(container.textContent).not.toContain('Due at the desk');
    expect(container.textContent).not.toContain('EUR 350.00');
    await act(async () => root.unmount());
  });
});

async function mount({
  initialOverview,
  canManageQuickBooking,
  canOpen,
}: {
  initialOverview?: Overview;
  canManageQuickBooking?: boolean;
  canOpen?: (section: string) => boolean;
} = {}) {
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(DashboardOverview, {
          tenantId: 'tenant-1',
          propertyId: 'property-1',
          role: 'OWNER',
          initialOverview,
          canOpen,
          ...(canManageQuickBooking === undefined ? {} : { canManageQuickBooking }),
        }),
      ),
    );
  });
  await act(async () => {
    await settle();
  });
  return { container, root };
}

async function click(element: Element) {
  await act(async () => {
    (element as HTMLButtonElement).click();
    await settle();
  });
}

async function settle() {
  for (let iteration = 0; iteration < 4; iteration += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    await Promise.resolve();
  }
}
