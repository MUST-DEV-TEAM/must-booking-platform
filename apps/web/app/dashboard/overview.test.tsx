// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DashboardOverview } from './overview';
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
  recentActivity: [
    {
      id: 'audit-1',
      action: 'booking.created',
      targetType: 'booking',
      targetId: 'booking-1',
      createdAt: '2026-08-02T10:00:00.000Z',
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

    expect(container.querySelector('[aria-busy="true"]')?.getAttribute('aria-label')).toBe(
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
        (button) => button.textContent === 'Retry',
      )!,
    );

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Ada Guest');
    expect(container.textContent).toContain('71%');
    await act(async () => root.unmount());
  });

  it('uses supplied overview data without an additional request', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { container, root } = await mount({ initialOverview: overview });

    expect(container.textContent).toContain('payment failed');
    expect(container.textContent).toContain('booking created');
    expect(container.textContent).toContain('New booking');
    expect(container.textContent).toContain('Add staff');
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});

async function mount({ initialOverview }: { initialOverview?: typeof overview } = {}) {
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
