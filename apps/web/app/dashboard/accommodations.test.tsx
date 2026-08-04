// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DashboardShell } from './dashboard-shell';
import { DashboardQueryProvider } from './query-provider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.unstubAllGlobals());

describe('Accommodations dashboard route', () => {
  it('renders room management from the owner Accommodations navigation target', async () => {
    window.history.pushState({}, '', '/dashboard/t?propertyId=p&section=accommodations');
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
    });

    await vi.waitFor(() => {
      if (!container.textContent?.includes('Rooms and room types'))
        throw new Error('Room management has not finished loading yet.');
    });

    expect(container.textContent).toContain('Rooms and room types');
    expect(
      container.querySelector('a[href="/dashboard/t?propertyId=p&section=accommodations"]'),
    ).not.toBeNull();
    await act(async () => root.unmount());
  });
});
