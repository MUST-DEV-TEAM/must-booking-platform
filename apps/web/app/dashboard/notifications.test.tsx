// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DashboardNotifications, NotificationsInbox } from './notifications';
import { DashboardQueryProvider } from './query-provider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Radix menus measure and observe elements that jsdom does not implement.
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopObserver as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};

const notifications = [
  { id: 'booking', type: 'BOOKING_CREATED', payload: { bookingId: 'b-1' }, readAt: null, createdAt: '2026-08-03' },
  {
    id: 'attention',
    type: 'BOOKING_NEEDS_ATTENTION',
    payload: {},
    readAt: null,
    createdAt: '2026-08-03',
  },
  {
    id: 'refund',
    type: 'PAYMENT_REFUNDED',
    payload: {},
    readAt: '2026-08-03T10:00:00.000Z',
    createdAt: '2026-08-03',
  },
  {
    id: 'seat-cap',
    type: 'STAFF_SEAT_CAP_REACHED',
    payload: {},
    readAt: null,
    createdAt: '2026-08-03',
  },
] as const;

const bell = (label = 'Notifications') =>
  document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const menuText = () => document.body.textContent ?? '';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('DashboardNotifications', () => {
  it('shows a loading line in the menu while notifications load', async () => {
    let resolveFetch!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((resolve) => (resolveFetch = resolve))),
    );
    const { root } = await mount({ settle: false });

    await openMenu(bell());
    expect(menuText()).toContain('Loading notifications…');

    await act(async () => {
      resolveFetch(new Response(JSON.stringify({ items: [] })));
      await Promise.resolve();
    });
    await act(async () => root.unmount());
  });

  it('lists only unread rows, counts the unread total, links each row and drops it once read', async () => {
    const unread = notifications.filter((notification) => notification.readAt === null);
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH')
        return new Response(
          JSON.stringify({ ...notifications[0], readAt: '2026-08-03T11:00:00.000Z' }),
        );
      expect(url).toBe('/api/tenants/t/properties/p/notifications?page=1&pageSize=10&unread=1');
      return new Response(JSON.stringify({ items: unread, total: 3, unreadTotal: 3 }));
    });
    vi.stubGlobal('fetch', fetch);
    const { root } = await mount();

    expect(bell('Notifications (3 unread)').textContent).toBe('3');
    await openMenu(bell('Notifications (3 unread)'));
    for (const label of ['Booking created', 'Booking needs attention', 'Staff seat cap reached'])
      expect(menuText()).toContain(label);
    expect(menuText()).not.toContain('Payment refunded');

    expect(
      Array.from(
        document.querySelectorAll('a[href="/dashboard/t?propertyId=p&section=notifications"]'),
      ).some((link) => link.textContent === 'View all notifications'),
    ).toBe(true);
    const bookingRow = document.querySelector<HTMLAnchorElement>(
      'a[href="/dashboard/t?propertyId=p&section=reservations&reservation=b-1"]',
    )!;
    expect(bookingRow).not.toBeNull();

    // Prevent the real navigation; the click still marks the row read.
    bookingRow.addEventListener('click', (event) => event.preventDefault());
    await click(bookingRow);
    expect(fetch.mock.calls.find(([, init]) => init?.method === 'PATCH')?.[0]).toBe(
      '/api/tenants/t/properties/p/notifications/booking',
    );
    expect(bell('Notifications (2 unread)').textContent).toBe('2');
    expect(
      document.querySelector('a[href="/dashboard/t?propertyId=p&section=reservations&reservation=b-1"]'),
    ).toBeNull();
    await act(async () => root.unmount());
  });

  it('shows the unread total, not the page length, and empties the menu after Mark all as read', async () => {
    const tenUnread = Array.from({ length: 10 }, (_, index) => ({
      ...notifications[0],
      id: `booking-${index}`,
    }));
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH' && url.endsWith('/mark-all-read')) {
        return new Response(null, { status: 200 });
      }
      return new Response(JSON.stringify({ items: tenUnread, total: 18, unreadTotal: 18 }));
    });
    vi.stubGlobal('fetch', fetch);
    const { root } = await mount();

    expect(bell('Notifications (18 unread)').textContent).toBe('18');
    await openMenu(bell('Notifications (18 unread)'));
    expect(document.querySelectorAll('[role="menuitem"][href*="reservation="]')).toHaveLength(10);

    await click(
      Array.from(document.querySelectorAll('button')).find(
        (button) => button.textContent === 'Mark all as read',
      )!,
    );
    expect(fetch.mock.calls.find(([, init]) => init?.method === 'PATCH')?.[0]).toBe(
      '/api/tenants/t/properties/p/notifications/mark-all-read',
    );
    expect(bell().textContent).toBe('');
    expect(menuText()).toContain('You are all caught up.');
    await act(async () => root.unmount());
  });

  it('caps a very large unread count at 99+', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ items: [], total: 250, unreadTotal: 250 }))),
    );
    const { root } = await mount();

    expect(bell('Notifications (99+ unread)').textContent).toBe('99+');
    await act(async () => root.unmount());
  });

  it('keeps the empty state and the inbox link in the menu', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ items: [], page: 1, pageSize: 10, total: 0, unreadTotal: 0 })),
      ),
    );
    const { root } = await mount();

    await openMenu(bell());
    expect(menuText()).toContain('You are all caught up.');
    expect(
      document.querySelector('a[href="/dashboard/t?propertyId=p&section=notifications"]'),
    ).not.toBeNull();
    await act(async () => root.unmount());
  });

  it('shows the query error and loads notifications after Retry succeeds', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [notifications[0]], total: 1, unreadTotal: 1 })),
      );
    vi.stubGlobal('fetch', fetch);
    const { root } = await mount();

    await openMenu(bell());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      'Unable to load notifications.',
    );

    await click(
      Array.from(document.querySelectorAll('button')).find(
        (button) => button.textContent === 'Retry',
      )!,
    );

    expect(menuText()).toContain('Booking created');
    expect(fetch).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount());
  });
});

describe('NotificationsInbox', () => {
  it('paginates and exposes text-bearing unread status', async () => {
    const firstPage = { items: [notifications[0]], page: 1, pageSize: 20, total: 21 };
    const secondPage = {
      items: [{ ...notifications[2], id: 'refund-page-2' }],
      page: 2,
      pageSize: 20,
      total: 21,
    };
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH')
        return new Response(
          JSON.stringify({ ...notifications[0], readAt: '2026-08-03T11:00:00.000Z' }),
        );
      if (url.endsWith('page=1&pageSize=20')) return new Response(JSON.stringify(firstPage));
      if (url.endsWith('page=2&pageSize=20')) return new Response(JSON.stringify(secondPage));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetch);
    const { container, root } = await mountInbox();

    expect(container.textContent).toContain('Booking created');
    expect(container.textContent).toContain('Unread');
    expect(container.textContent).toContain('Showing 1–20 of 21 notifications');
    expect(container.textContent).not.toContain('Mark all as read');

    await click(
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === 'Mark as read',
      )!,
    );
    expect(container.textContent).not.toContain('Unread');
    expect(fetch.mock.calls.find(([, init]) => init?.method === 'PATCH')?.[0]).toBe(
      '/api/tenants/t/properties/p/notifications/booking',
    );

    await click(container.querySelector('button[aria-label="Next page"]')!);
    expect(container.textContent).toContain('Payment refunded');
    expect(container.textContent).toContain('Showing 21–21 of 21 notifications');
    expect(container.textContent).toContain('Rows per page');
    expect(fetch.mock.calls.some(([url]) => url.endsWith('page=2&pageSize=20'))).toBe(true);

    await act(async () => root.unmount());
  });
});

async function mount({ settle = true }: { settle?: boolean } = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(DashboardNotifications, { tenantId: 't', propertyId: 'p' }),
      ),
    );
  });
  if (settle) {
    await act(async () => {
      await settleQueries();
    });
  }
  return { container, root };
}

async function mountInbox() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(NotificationsInbox, { tenantId: 't', propertyId: 'p' }),
      ),
    );
  });
  await act(async () => {
    await settleQueries();
  });
  return { container, root };
}

/** Radix opens a menu on pointerdown, not click. */
async function openMenu(trigger: Element) {
  await act(async () => {
    trigger.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
    );
    await settleQueries();
  });
}

async function click(element: Element) {
  await act(async () => {
    (element as HTMLElement).click();
    await settleQueries();
  });
}

async function settleQueries() {
  for (let iteration = 0; iteration < 4; iteration += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    await Promise.resolve();
  }
}
