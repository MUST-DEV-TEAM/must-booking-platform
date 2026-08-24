// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HotelsSection } from './dashboard-shell';
import { DashboardQueryProvider } from './query-provider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.unstubAllGlobals());

describe('Hotels dashboard section', () => {
  it('renders aggregate KPIs, attention badges, and links for every property', async () => {
    const properties = [
      { id: 'property-1', name: 'Grand Hotel' },
      { id: 'property-2', name: 'Coast Hotel' },
    ];
    const fetch = vi.fn((url: string) => {
      if (url.endsWith('/properties')) {
        return Promise.resolve(new Response(JSON.stringify(properties)));
      }
      if (url.endsWith('/plan-usage')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              plan: { maxProperties: 3 },
              usage: { properties: properties.length },
            }),
          ),
        );
      }
      if (url.includes('/integration-connections')) {
        return Promise.resolve(new Response(JSON.stringify([])));
      }
      const propertyId = url.includes('property-1') ? 'property-1' : 'property-2';
      const overview =
        propertyId === 'property-1'
          ? {
              kpis: {
                arrivals: 5,
                departures: 2,
                inHouse: 3,
                bookedRoomNights: 5,
                availableRoomNights: 10,
                occupancyRate: 50,
              },
              needsAttention: [{ id: 'attention-1' }, { id: 'attention-2' }],
            }
          : {
              kpis: {
                arrivals: 1,
                departures: 1,
                inHouse: 4,
                bookedRoomNights: 5,
                availableRoomNights: 10,
                occupancyRate: 50,
              },
              needsAttention: [],
            };
      return Promise.resolve(new Response(JSON.stringify(overview)));
    });
    vi.stubGlobal('fetch', fetch);

    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(
          DashboardQueryProvider,
          undefined,
          createElement(HotelsSection, { tenantId: 'tenant-1', properties }),
        ),
      );
    });
    for (let iteration = 0; iteration < 8; iteration += 1) {
      const textContent = container.textContent ?? '';
      if (textContent.includes('All properties') && textContent.includes('Add property')) break;
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 25));
      });
    }

    expect(container.textContent).toContain('All properties');
    expect(container.textContent).toContain('Manage properties');
    expect(container.textContent).toContain('Integrations');
    expect(container.textContent).toContain('Add a connection');
    expect(
      Array.from(container.querySelectorAll('h2')).filter(
        (heading) => heading.textContent === 'Manage properties',
      ),
    ).toHaveLength(1);
    expect(container.textContent).toContain('Add property');
    expect(container.textContent).toContain(
      '7 guests in-house · 6 arrivals today · 3 departures today · 50% occupancy',
    );
    expect(container.textContent).toContain('2 need attention');
    expect(container.textContent).toContain('0 need attention');
    expect(container.querySelector('[data-domain="booking"][data-state="pending"]')).not.toBeNull();
    expect(
      container.querySelector('[data-domain="booking"][data-state="confirmed"]'),
    ).not.toBeNull();
    expect(container.querySelectorAll('.must-badge')).toHaveLength(0);
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
    expect(fetch).toHaveBeenCalledWith('/api/tenants/tenant-1/properties/property-1/overview', {
      credentials: 'include',
    });
    expect(fetch).toHaveBeenCalledWith('/api/tenants/tenant-1/properties/property-2/overview', {
      credentials: 'include',
    });

    await act(async () => root.unmount());
  });

  it('keeps Integrations reachable for a single-property tenant', async () => {
    const properties = [{ id: 'property-single', name: 'Solo Hotel' }];
    const fetch = vi.fn((url: string) => {
      if (url.endsWith('/properties')) {
        return Promise.resolve(new Response(JSON.stringify(properties)));
      }
      if (url.endsWith('/plan-usage')) {
        return Promise.resolve(
          new Response(JSON.stringify({ plan: { maxProperties: 3 }, usage: { properties: 1 } })),
        );
      }
      if (url.includes('/integration-connections')) {
        return Promise.resolve(new Response(JSON.stringify([])));
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            kpis: {
              arrivals: 1,
              departures: 0,
              inHouse: 2,
              bookedRoomNights: 2,
              availableRoomNights: 4,
              occupancyRate: 50,
            },
            needsAttention: [],
          }),
        ),
      );
    });
    vi.stubGlobal('fetch', fetch);

    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(
          DashboardQueryProvider,
          undefined,
          createElement(HotelsSection, {
            tenantId: 'tenant-single',
            properties,
          }),
        ),
      );
    });
    for (let iteration = 0; iteration < 8; iteration += 1) {
      const textContent = container.textContent ?? '';
      if (textContent.includes('Add a connection') && textContent.includes('Add property')) break;
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 25));
      });
    }

    expect(container.textContent).toContain('Integrations');
    expect(container.textContent).toContain('Add a connection');
    expect(container.textContent).toContain('Manage properties');
    expect(container.textContent).toContain('Add property');
    expect(fetch).toHaveBeenCalledWith(
      '/api/tenants/tenant-single/properties/property-single/overview',
      { credentials: 'include' },
    );

    await act(async () => root.unmount());
  });
});
