// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DashboardShell } from './dashboard-shell';
import { DashboardQueryProvider } from './query-provider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.unstubAllGlobals());

describe('Rates & Pricing dashboard route', () => {
  it('renders rate management from the owner Rates & Pricing navigation target', async () => {
    window.history.pushState({}, '', '/dashboard/t?propertyId=p&section=rates-pricing');
    const fetch = vi.fn((url: string) => {
      if (url === '/api/auth/session')
        return Promise.resolve(
          new Response(
            JSON.stringify({
              user: {
                id: 'u',
                email: 'owner@example.test',
                emailVerified: true,
                isPlatformAdmin: false,
              },
            }),
          ),
        );
      if (url === '/api/auth/memberships')
        return Promise.resolve(
          new Response(JSON.stringify({ memberships: [{ tenantId: 't', role: 'OWNER' }] })),
        );
      if (url === '/api/tenants/t/properties')
        return Promise.resolve(new Response(JSON.stringify([{ id: 'p', name: 'Grand Hotel' }])));
      if (url.endsWith('/capabilities/mine'))
        return Promise.resolve(Response.json(['rates.manage']));
      if (url.endsWith('/pricing'))
        return Promise.resolve(
          Response.json({
            source: 'LOCAL',
            readOnly: false,
            today: '2035-03-01',
            timezone: 'UTC',
            bookingMode: 'ROOM_TYPE_ONLY',
            pricingVersion: 1,
            roomTypes: [],
            rooms: [],
            plans: [],
            rules: [],
            charges: [],
            base: [],
            roomOverrides: [],
            issues: [],
            coverage: null,
          }),
        );
      if (url === '/api/tenants/t/properties/p/notifications?page=1&pageSize=20')
        return Promise.resolve(new Response(JSON.stringify({ items: [] })));
      return Promise.resolve(new Response(JSON.stringify([])));
    });
    vi.stubGlobal('fetch', fetch);
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(
          DashboardQueryProvider,
          undefined,
          createElement(DashboardShell, { tenantId: 't' }),
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    for (
      let attempt = 0;
      attempt < 10 && !container.textContent?.includes('Pricing setup required');
      attempt++
    )
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    expect(container.textContent).toContain('Rates & Pricing');
    expect(container.textContent).toContain('Pricing setup required');
    expect(container.textContent).not.toContain('Managed in Clock');
    expect(
      container.querySelector('a[href="/dashboard/t?propertyId=p&section=rates-pricing"]'),
    ).not.toBeNull();
    await act(async () => root.unmount());
  });
});
