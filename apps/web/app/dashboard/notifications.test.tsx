// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DashboardNotifications } from './notifications';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const notifications = [
  { id: 'booking', type: 'BOOKING_CREATED', payload: {}, readAt: null, createdAt: '2026-08-03' },
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

afterEach(() => vi.unstubAllGlobals());

describe('DashboardNotifications', () => {
  it('uses fetched unread rows for the badge and updates it after marking one read', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH')
        return new Response(
          JSON.stringify({ ...notifications[0], readAt: '2026-08-03T11:00:00.000Z' }),
        );
      expect(url).toBe('/api/tenants/t/properties/p/notifications?page=1&pageSize=20');
      return new Response(JSON.stringify({ items: notifications }));
    });
    vi.stubGlobal('fetch', fetch);
    const { container, root } = await mount();

    const bell = container.querySelector('[aria-label="Notifications (3 unread)"]')!;
    expect(bell.textContent).toBe('3');
    await click(bell);
    for (const label of [
      'Booking created',
      'Booking needs attention',
      'Payment refunded',
      'Staff seat cap reached',
    ])
      expect(container.textContent).toContain(label);

    await click(
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === 'Mark as read',
      )!,
    );
    expect(container.querySelector('[aria-label="Notifications (2 unread)"]')?.textContent).toBe(
      '2',
    );
    expect(fetch.mock.calls.filter(([, init]) => !init?.method)).toHaveLength(1);
    expect(fetch.mock.calls.find(([, init]) => init?.method === 'PATCH')?.[0]).toBe(
      '/api/tenants/t/properties/p/notifications/booking',
    );
    await act(async () => root.unmount());
  });
});

async function mount() {
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(DashboardNotifications, { tenantId: 't', propertyId: 'p' }));
    await Promise.resolve();
    await Promise.resolve();
  });
  return { container, root };
}

async function click(element: Element) {
  await act(async () => {
    (element as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();
  });
}
