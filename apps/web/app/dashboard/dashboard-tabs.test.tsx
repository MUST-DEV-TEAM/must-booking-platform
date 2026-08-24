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

    const tabs = container.querySelector('nav[aria-label="Dashboard tabs"]');
    expect(tabs).not.toBeNull();
    expect(tabs?.querySelector('a[aria-current="page"]')?.textContent).toBe('Needs Attention');
    expect(tabs?.querySelector('a[aria-current="page"]')?.getAttribute('href')).toBe(
      '/dashboard/t?propertyId=p&section=overview&tab=needs-attention',
    );
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
    expect(container.querySelector('nav[aria-label="Dashboard tabs"]')).toBeNull();

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

  it.each([
    [
      'approvals',
      'Approvals unavailable',
      'Approvals will coordinate review and sign-off for bookings and other workflows',
    ],
    [
      'system-health',
      'System Health unavailable',
      'System Health will summarize operational checks across booking, payments, PMS, notifications, processing, and security',
    ],
  ] as const)('renders the %s placeholder from its direct URL', async (tab, title, body) => {
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
        if (!container.textContent?.includes(title))
          throw new Error(`${tab} placeholder has not finished loading yet.`);
      });
    });

    const tabs = container.querySelector('nav[aria-label="Dashboard tabs"]');
    const activeTab = tabs?.querySelector('a[aria-current="page"]');
    expect(activeTab?.textContent).toBe(title.replace(' unavailable', ''));
    expect(activeTab?.getAttribute('href')).toBe(
      `/dashboard/t?propertyId=p&section=overview&tab=${tab}`,
    );
    expect(activeTab?.tagName).toBe('A');
    expect(
      Array.from(tabs?.querySelectorAll('a') ?? []).every((link) => link.hasAttribute('href')),
    ).toBe(true);
    expect(container.querySelector('.must-state-panel--not-available')).not.toBeNull();
    expect(container.textContent).toContain(body);

    await act(async () => root.unmount());
  });
});
