// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PropertyEntry } from './property-entry';
import { DashboardQueryProvider } from './query-provider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.unstubAllGlobals());

describe('PropertyEntry', () => {
  it('opens the operational shell for an owner with multiple accessible properties', async () => {
    const { container, root, fetch } = await mount(
      [
        { id: 'property-1', name: 'Grand Hotel' },
        { id: 'property-2', name: 'Coast Hotel' },
      ],
      'OWNER',
    );

    expect(container.textContent).toContain('Overview');
    expect(container.textContent).toContain('Grand Hotel');
    expect(container.textContent).toContain('Coast Hotel');
    expect(fetch).toHaveBeenCalledWith('/api/tenants/tenant-1/properties/property-1/overview', {
      credentials: 'include',
    });
    await act(async () => root.unmount());
  });

  it('opens the shell directly for a staff member with one accessible property', async () => {
    const { container, root } = await mount([{ id: 'property-1', name: 'Grand Hotel' }]);

    expect(container.textContent).not.toContain('Choose a property');
    expect(container.textContent).toContain('Grand Hotel');
    expect(container.textContent).toContain('Overview');
    await act(async () => root.unmount());
  });
});

async function mount(
  properties: Array<{ id: string; name: string }>,
  role: 'OWNER' | 'STAFF' = 'STAFF',
) {
  const fetch = vi.fn((url: string) => {
    if (url === '/api/auth/session')
      return Promise.resolve(
        new Response(
          JSON.stringify({
            user: {
              id: 'staff-1',
              email: 'staff@example.test',
              emailVerified: true,
              isPlatformAdmin: false,
            },
          }),
        ),
      );
    if (url === '/api/auth/memberships')
      return Promise.resolve(
        new Response(JSON.stringify({ memberships: [{ tenantId: 'tenant-1', role }] })),
      );
    if (url.endsWith('/overview'))
      return Promise.resolve(
        new Response(
          JSON.stringify({
            kpis: {
              date: '2026-08-03',
              arrivals: 0,
              departures: 0,
              inHouse: 0,
              bookedRoomNights: 0,
              availableRoomNights: 0,
              occupancyRate: null,
            },
            needsAttention: [],
            recentActivity: [],
          }),
        ),
      );
    if (url.endsWith('/notifications?page=1&pageSize=20'))
      return Promise.resolve(new Response(JSON.stringify({ items: [] })));
    return Promise.resolve(new Response(JSON.stringify(properties)));
  });
  vi.stubGlobal('fetch', fetch);
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(PropertyEntry, { tenantId: 'tenant-1' }),
      ),
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return { container, fetch, root };
}
