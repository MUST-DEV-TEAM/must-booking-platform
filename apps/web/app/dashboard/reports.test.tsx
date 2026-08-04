// @vitest-environment jsdom
import 'vitest-canvas-mock';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dashboardNavigation } from './dashboard-shell';
import { DashboardReports } from './reports';
import { DashboardQueryProvider } from './query-provider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => vi.stubGlobal('ResizeObserver', ResizeObserver));

const report = {
  from: '2026-08-01',
  to: '2026-08-02',
  occupancy: [
    { date: '2026-08-01', bookedRoomNights: 3, availableRoomNights: 4, rate: 75.1234 },
    { date: '2026-08-02', bookedRoomNights: 0, availableRoomNights: 0, rate: null },
  ],
  bookingsCreated: [
    { date: '2026-08-01', count: 2 },
    { date: '2026-08-02', count: 1 },
  ],
  revenue: [
    { date: '2026-08-01', currency: 'EUR', amount: '125.50' },
    { date: '2026-08-01', currency: 'USD', amount: '10.00' },
    { date: '2026-08-02', currency: 'EUR', amount: '0' },
    { date: '2026-08-02', currency: 'USD', amount: '15.25' },
  ],
  cancellationRate: { createdBookings: 3, cancelledBookings: 1, rate: 33.3333 },
};

afterEach(() => vi.unstubAllGlobals());

describe('DashboardReports', () => {
  it('keeps Reports available to owners and admins, not property staff', () => {
    expect(dashboardNavigation('t', 'p', 'OWNER').some((item) => item.label === 'Reports')).toBe(
      true,
    );
    expect(dashboardNavigation('t', 'p', 'ADMIN').some((item) => item.label === 'Reports')).toBe(
      true,
    );
    expect(dashboardNavigation('t', 'p', 'STAFF').some((item) => item.label === 'Reports')).toBe(
      false,
    );
  });

  it('renders fetched report data and refetches with the selected date range', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(report)));
    vi.stubGlobal('fetch', fetch);
    const { container, root } = await mount();

    expect(fetch).toHaveBeenCalledWith('/api/tenants/t/properties/p/reports', {
      credentials: 'include',
    });
    expect(container.textContent).toContain('75.1%');
    expect(container.textContent).toContain('33.3%');
    expect(container.textContent).toContain('EUR 125.50');
    expect(container.textContent).toContain('USD 15.25');
    expect(container.querySelectorAll('.echart')).toHaveLength(4);

    await value(container.querySelector('[aria-label="Report start date"]')!, '2026-07-01');
    await value(container.querySelector('[aria-label="Report end date"]')!, '2026-07-31');
    await submit(container);

    expect(fetch).toHaveBeenLastCalledWith(
      '/api/tenants/t/properties/p/reports?from=2026-07-01&to=2026-07-31',
      { credentials: 'include' },
    );
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
        createElement(DashboardReports, { tenantId: 't', propertyId: 'p' }),
      ),
    );
  });
  await act(async () => {
    await settleQueries();
  });
  return { container, root };
}

async function value(element: Element, next: string) {
  await act(async () => {
    const input = element as HTMLInputElement;
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!.call(input, next);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
  });
}

async function submit(container: HTMLElement) {
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settleQueries();
  });
}

async function settleQueries() {
  for (let iteration = 0; iteration < 4; iteration += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    await Promise.resolve();
  }
}
