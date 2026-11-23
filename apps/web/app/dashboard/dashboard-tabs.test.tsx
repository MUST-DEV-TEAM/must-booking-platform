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
        return Promise.resolve(
          new Response(
            JSON.stringify({
              items: [],
              total: 0,
              page: 1,
              pageSize: 20,
              unreadTotal: 0,
              version: 0,
              through: '2026-10-19T10:00:00Z',
              canMarkRead: true,
              counts: { critical: 0, today: 0, needsAction: 0 },
              registry: [],
            }),
          ),
        );
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
        return Promise.resolve(
          new Response(
            JSON.stringify({
              items: [],
              total: 0,
              page: 1,
              pageSize: 20,
              unreadTotal: 0,
              version: 0,
              through: '2026-10-19T10:00:00Z',
              canMarkRead: true,
              counts: { critical: 0, today: 0, needsAction: 0 },
              registry: [],
            }),
          ),
        );
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

  it('renders the Inventory workspace from its direct URL', async () => {
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
        return Promise.resolve(
          new Response(
            JSON.stringify({
              items: [],
              total: 0,
              page: 1,
              pageSize: 20,
              unreadTotal: 0,
              version: 0,
              through: '2026-10-19T10:00:00Z',
              canMarkRead: true,
              counts: { critical: 0, today: 0, needsAction: 0 },
              registry: [],
            }),
          ),
        );
      if (url.endsWith('/capabilities/mine'))
        return Promise.resolve(new Response(JSON.stringify(['calendar.view', 'calendar.block'])));
      if (url.endsWith('/inventory/restrictions') || url.endsWith('/inventory/blocks'))
        return Promise.resolve(
          new Response(
            JSON.stringify({
              source: 'LOCAL',
              readOnly: false,
              today: '2026-10-18',
              timezone: 'UTC',
              items: [],
              baseRestrictions: [],
            }),
          ),
        );
      if (url.endsWith('/inventory/overview'))
        return Promise.resolve(
          new Response(
            JSON.stringify({
              source: 'LOCAL',
              today: '2026-10-18',
              timezone: 'UTC',
              activeRestrictions: 0,
              activeBlocks: 0,
              countsByType: {},
              needsAttention: [],
              totalNights: 0,
              sellableNights: 0,
              sellablePercentage: null,
              coverage: [],
            }),
          ),
        );
      if (url.endsWith('/room-types') || url.endsWith('/rooms') || url.endsWith('/room-categories'))
        return Promise.resolve(new Response(JSON.stringify([])));
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
        if (!container.textContent?.includes('Available room nights'))
          throw new Error('Inventory section has not finished loading yet.');
      });
    });

    const navigation = container.querySelector('nav[aria-label="Main navigation"]');
    const inventoryLink = Array.from(navigation?.querySelectorAll('a') ?? []).find(
      (link) => link.textContent === 'Inventory',
    );
    expect(inventoryLink?.getAttribute('href')).toBe('/dashboard/t?propertyId=p&section=inventory');
    expect(container.textContent).toContain('Booking effect preview');
    expect(container.textContent).not.toContain('Inventory unavailable');

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
                  title: 'Booking created',
                  description: 'A new reservation was made.',
                  category: 'Reservations',
                  priority: 'Low',
                  capability: 'bookings.view',
                  needsAction: false,
                  href: null,
                  booking: null,
                  limitedContext: 'Related reservation is unavailable',
                  readAt: null,
                  createdAt: '2026-08-03T10:00:00.000Z',
                },
              ],
              page: 1,
              pageSize: 20,
              total: 1,
              unreadTotal: 1,
              version: 0,
              through: '2026-10-19T10:00:00Z',
              canMarkRead: true,
              counts: { critical: 0, today: 0, needsAction: 0 },
              registry: [],
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

  // Old area names come from saved links; each lands on its new tab in the settings menu.
  it.each([
    ['general', 'Profile', 'Hotel identity', 'Stay limits'],
    ['booking-rules', 'Booking rules', 'How guests choose rooms', 'Hotel identity'],
    ['managed-pages', 'Integrations', 'Need another integration?', 'Hotel identity'],
    ['billing', 'Plan and usage', 'Your plan', 'Hotel identity'],
  ] as const)(
    'restores the %s Settings link on its tab with the settings menu',
    async (settingsArea, activeTab, visiblePanel, hiddenPanel) => {
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
          return Promise.resolve(
            new Response(
              JSON.stringify({
                items: [],
                total: 0,
                page: 1,
                pageSize: 20,
                unreadTotal: 0,
                version: 0,
                through: '2026-10-19T10:00:00Z',
                canMarkRead: true,
                counts: { critical: 0, today: 0, needsAction: 0 },
                registry: [],
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
      const menu = container.querySelector('nav[aria-label="Settings menu"]');
      expect(menu).not.toBeNull();
      expect(menu!.querySelector('a[aria-current="page"]')?.textContent).toBe(activeTab);
      expect(
        menu!.querySelector('a[href="/dashboard/t?propertyId=p&section=settings"]'),
      ).not.toBeNull();
      const content = (container.textContent ?? '').replace(menu!.textContent ?? '', '');
      expect(content).toContain(visiblePanel);
      expect(content).not.toContain(hiddenPanel);
      expect(content).not.toContain('Email branding');
      if (settingsArea === 'billing') {
        expect(content).toContain('invoices are not available yet');
        expect(content).not.toContain('Milestone 13');
      }

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
