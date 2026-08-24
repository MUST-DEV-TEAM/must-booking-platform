// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./[tenantId]/integrations-management', () => ({
  IntegrationsManagement: () => <div>Integration settings</div>,
}));

import { MainDashboard } from './main-dashboard';
import { DashboardQueryProvider } from './query-provider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.unstubAllGlobals());

describe('MainDashboard', () => {
  it('renders aggregate stats and links each property card to its overview', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/api/auth/session')
          return Promise.resolve(new Response(JSON.stringify({ user: null })));
        if (url.endsWith('/property-1/overview'))
          return Promise.resolve(new Response(JSON.stringify(firstOverview)));
        return Promise.resolve(new Response(JSON.stringify(secondOverview)));
      }),
    );

    const { container, root } = await mount();

    expect(container.textContent).toContain('PORTFOLIO OVERVIEW');
    expect(container.textContent).toContain('A live view of today’s arrivals');
    expect(container.textContent).toContain('Arrivals');
    expect(container.textContent).toContain('Departures');
    expect(container.textContent).toContain('In-house');
    expect(container.textContent).toContain('Occupancy');
    expect(container.textContent).toContain('3 need attention');
    expect(
      container.querySelector(
        'a[href="/dashboard/tenant-1?propertyId=property-1&section=overview"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        'a[href="/dashboard/tenant-1?propertyId=property-2&section=overview"]',
      ),
    ).not.toBeNull();
    expect(container.textContent).toContain('60%');

    await act(async () => root.unmount());
  });
});

const firstOverview = {
  kpis: {
    arrivals: 2,
    departures: 1,
    inHouse: 4,
    bookedRoomNights: 4,
    availableRoomNights: 6,
    occupancyRate: 67,
  },
  needsAttention: [{ id: 'booking-1' }, { id: 'booking-2' }, { id: 'booking-3' }],
};

const secondOverview = {
  kpis: {
    arrivals: 1,
    departures: 3,
    inHouse: 2,
    bookedRoomNights: 2,
    availableRoomNights: 4,
    occupancyRate: 50,
  },
  needsAttention: [],
};

async function mount() {
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(MainDashboard, {
          tenantId: 'tenant-1',
          properties: [
            { id: 'property-1', name: 'Grand Hotel' },
            { id: 'property-2', name: 'Coast Hotel' },
          ],
        }),
      ),
    );
    await settle();
  });
  return { container, root };
}

async function settle() {
  for (let iteration = 0; iteration < 4; iteration += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    await Promise.resolve();
  }
}
