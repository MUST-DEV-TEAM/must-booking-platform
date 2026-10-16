// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DashboardShell } from './dashboard-shell';
import { DashboardQueryProvider } from './query-provider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('Dashboard section tabs', () => {
  it('restores the selected tab from the URL and shows the interim state', async () => {
    window.history.pushState(
      {},
      '',
      '/dashboard/t?propertyId=p&section=overview&tab=needs-attention',
    );
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
      return Promise.resolve(
        new Response(
          JSON.stringify({
            kpis: {
              date: '2026-08-24',
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

    await act(async () => {
      await vi.waitFor(() => {
        if (!container.textContent?.includes('No bookings need attention'))
          throw new Error('Dashboard tab has not finished loading yet.');
      });
    });

    const tabs = container.querySelector('[role="tablist"]');
    expect(tabs).not.toBeNull();
    expect(tabs?.querySelector('[aria-selected="true"]')?.textContent).toContain('Needs attention');
    expect(container.textContent).toContain('No bookings need attention');
    expect(container.textContent).not.toContain('Recent activity');

    await act(async () => root.unmount());
  });

  it('does not resolve the legacy walk-in URL to a hidden booking page', async () => {
    window.history.pushState({}, '', '/dashboard/t?propertyId=p&section=walk-in');
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
      return Promise.resolve(
        new Response(
          JSON.stringify({
            kpis: {
              date: '2026-08-24',
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

    await act(async () => {
      await vi.waitFor(() => {
        if (!container.textContent?.includes('Grand Hotel'))
          throw new Error('Dashboard has not finished loading yet.');
      });
    });

    expect(container.textContent).not.toContain('New walk-in booking');
    expect(container.querySelector('[role="tablist"]')).toBeNull();

    await act(async () => root.unmount());
  });

  it('renders Inventory as an unavailable owner section from its direct URL', async () => {
    window.history.pushState({}, '', '/dashboard/t?propertyId=p&section=inventory');
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
      return Promise.resolve(new Response(JSON.stringify({})));
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

    await act(async () => {
      await vi.waitFor(() => {
        if (!container.textContent?.includes('Inventory unavailable'))
          throw new Error('Inventory section has not finished loading yet.');
      });
    });

    const navigation = container.querySelector('nav[aria-label="Main navigation"]');
    const inventoryLink = Array.from(navigation?.querySelectorAll('a') ?? []).find(
      (link) => link.textContent === 'Inventory',
    );
    expect(inventoryLink?.getAttribute('href')).toBe('/dashboard/t?propertyId=p&section=inventory');
    expect(container.querySelector('.must-state-panel--not-available')).not.toBeNull();
    expect(container.textContent).toContain(
      'availability restrictions and manual blocks are planned for a future dashboard update',
    );

    await act(async () => root.unmount());
  });

  it('renders the notifications inbox from its direct URL without adding sidebar navigation', async () => {
    window.history.pushState({}, '', '/dashboard/t?propertyId=p&section=notifications');
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
        return Promise.resolve(
          new Response(
            JSON.stringify({
              items: [
                {
                  id: 'booking',
                  type: 'BOOKING_CREATED',
                  payload: {},
                  readAt: null,
                  createdAt: '2026-08-03T10:00:00.000Z',
                },
              ],
              page: 1,
              pageSize: 20,
              total: 1,
            }),
          ),
        );
      return Promise.resolve(new Response(JSON.stringify({})));
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

    for (let iteration = 0; iteration < 8; iteration += 1) {
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 20));
        await Promise.resolve();
      });
    }

    expect(container.textContent).toContain('Notifications');
    expect(container.textContent).toContain('Booking created');
    expect(container.textContent).toContain('Unread');
    const navigation = container.querySelector('nav[aria-label="Main navigation"]');
    expect(
      Array.from(navigation?.querySelectorAll('a') ?? []).some(
        (link) => link.textContent === 'Notifications',
      ),
    ).toBe(false);

    await act(async () => root.unmount());
  });

  it.each([
    ['general', 'Hotel identity', 'Booking rules'],
    ['booking-rules', 'Booking rules', 'Hotel identity'],
    ['managed-pages', 'Connect WordPress site', 'Hotel identity'],
    ['billing', 'Billing account', 'Hotel identity'],
  ] as const)(
    'restores the %s Settings sub-view from the direct URL and supports back navigation',
    async (settingsArea, visiblePanel, hiddenPanel) => {
      window.history.pushState(
        {},
        '',
        `/dashboard/t?propertyId=p&section=settings&settingsArea=${settingsArea}`,
      );
      const property = {
        id: 'p',
        name: 'Grand Hotel',
        address: '1 Main Street',
        timezone: 'Europe/Tirane',
        logoUrl: null,
        phone: null,
        supportEmail: null,
        minStayNights: 2,
        maxStayNights: 7,
        checkInTime: '15:00',
        checkOutTime: '11:00',
        rules: 'No smoking.',
        advanceBookingDays: 90,
        freeCancellationDaysBeforeArrival: 21,
        bookingMode: 'ROOM_TYPE_ONLY',
        paymentGateways: { stripe: false, pokpay: false, payAtHotel: true },
        wordpressConnectedAt: null,
        publicWebsiteOrigin: null,
      };
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
          return Promise.resolve(new Response(JSON.stringify([property])));
        if (url === '/api/tenants/t/plan-usage')
          return Promise.resolve(new Response(JSON.stringify({ plan: { name: 'Free' } })));
        if (
          url === '/api/tenants/t/integration-connections' ||
          url === '/api/tenants/t/properties/p/integration-connections'
        )
          return Promise.resolve(new Response(JSON.stringify([])));
        if (url === '/api/tenants/t/properties/p/notifications?page=1&pageSize=20')
          return Promise.resolve(new Response(JSON.stringify({ items: [] })));
        return Promise.resolve(new Response(JSON.stringify({})));
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

      for (let iteration = 0; iteration < 8; iteration += 1) {
        await act(async () => {
          await new Promise((resolve) => window.setTimeout(resolve, 20));
          await Promise.resolve();
        });
      }
      expect(container.textContent).toContain(visiblePanel);

      expect(container.textContent).toContain('Back to Settings overview');
      expect(
        container.querySelector('a[href="/dashboard/t?propertyId=p&section=settings"]'),
      ).not.toBeNull();
      expect(container.textContent).not.toContain(hiddenPanel);
      expect(container.textContent).not.toContain('Email branding');
      expect(container.textContent).not.toContain('Payment methods');
      if (settingsArea === 'booking-rules') expect(container.textContent).toContain('Booking mode');
      if (settingsArea === 'managed-pages')
        expect(container.textContent).toContain('Generate connection code');
      if (settingsArea === 'billing') {
        expect(container.textContent).toContain('Platform billing is not available yet');
        expect(container.textContent).not.toContain('Milestone 13');
      }

      await act(async () => root.unmount());
    },
  );

  it.each(['approvals', 'system-health'] as const)(
    'does not offer the planned %s tab and falls back to Overview from its direct URL',
    async (tab) => {
    window.history.pushState({}, '', `/dashboard/t?propertyId=p&section=overview&tab=${tab}`);
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
      return Promise.resolve(
        new Response(
          JSON.stringify({
            kpis: {
              date: '2026-08-24',
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

    await act(async () => {
      await vi.waitFor(() => {
        if (!container.textContent?.includes('Today at a glance'))
          throw new Error('Overview has not finished loading yet.');
      });
    });

    const labels = Array.from(container.querySelectorAll('[role="tab"]')).map((item) => item.textContent);
    expect(labels.some((label) => label?.includes('Approvals'))).toBe(false);
    expect(labels.some((label) => label?.includes('System health'))).toBe(false);
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain('Overview');

    await act(async () => root.unmount());
    },
  );
});

describe('Dashboard tabs switch in place', () => {
  function stubDashboardApi() {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));
        if (url === '/api/auth/session')
          return json({
            user: {
              id: 'u',
              email: 'owner@example.test',
              emailVerified: true,
              isPlatformAdmin: false,
            },
          });
        if (url === '/api/auth/memberships')
          return json({ memberships: [{ tenantId: 't', role: 'OWNER' }] });
        if (url === '/api/tenants/t/properties') return json([{ id: 'p', name: 'Grand Hotel' }]);
        if (url.includes('/notifications')) return json({ items: [] });
        return json({
          kpis: {
            date: '2026-08-24',
            arrivals: 0,
            departures: 0,
            inHouse: 0,
            bookedRoomNights: 0,
            availableRoomNights: 0,
            occupancyRate: null,
          },
          revenue: { today: null },
          balanceDueAtDesk: null,
          newBookingsSinceYesterday: 0,
          needsAttentionCount: 0,
          needsAttention: [],
          todaysArrivals: [],
          todaysDepartures: [],
          upcomingArrivals: [],
          soldOutRooms: [],
          recentCancellations: [],
          recentActivity: [],
        });
      }),
    );
  }

  async function mountShell() {
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
    await act(async () => {
      await vi.waitFor(() => {
        if (!container.querySelector('[role="tablist"]'))
          throw new Error('Dashboard has not finished loading yet.');
      });
    });
    return { container, unmount: () => act(async () => root.unmount()) };
  }

  const tab = (container: HTMLElement, label: string) =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((item) =>
      item.textContent?.startsWith(label),
    )!;

  it('shows another tab and updates the address without loading a new page', async () => {
    window.history.pushState({}, '', '/dashboard/t?propertyId=p&section=overview&tab=overview');
    stubDashboardApi();
    const { container, unmount } = await mountShell();
    const tabBar = container.querySelector('[role="tablist"]');
    const pushes = vi.spyOn(window.history, 'pushState');

    await act(async () => {
      tab(container, 'Needs attention').dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
      );
    });
    await act(async () => {
      await vi.waitFor(() => {
        if (!container.textContent?.includes('No bookings need attention'))
          throw new Error('Needs Attention has not rendered yet.');
      });
    });

    expect(pushes).toHaveBeenCalledWith(
      null,
      '',
      '/dashboard/t?propertyId=p&section=overview&tab=needs-attention',
    );
    expect(window.location.search).toContain('tab=needs-attention');
    // The same tab bar element is still there: the page was not replaced.
    expect(container.querySelector('[role="tablist"]')).toBe(tabBar);
    expect(tab(container, 'Needs attention').getAttribute('aria-selected')).toBe('true');
    pushes.mockRestore();
    await unmount();
  });

  it('follows the browser back button to the previous tab', async () => {
    window.history.pushState({}, '', '/dashboard/t?propertyId=p&section=overview&tab=overview');
    stubDashboardApi();
    const { container, unmount } = await mountShell();
    await act(async () => {
      tab(container, 'Quick booking').dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
      );
    });
    expect(tab(container, 'Quick booking').getAttribute('aria-selected')).toBe('true');

    await act(async () => {
      window.history.replaceState(
        {},
        '',
        '/dashboard/t?propertyId=p&section=overview&tab=overview',
      );
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(tab(container, 'Overview').getAttribute('aria-selected')).toBe('true');
    await unmount();
  });
});
