// @vitest-environment jsdom
import { act, createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardNotifications, NotificationsInbox } from './notifications';
import { DashboardQueryProvider } from './query-provider';
import type { InboxNotification, InboxPage } from '../../lib/notification-inbox';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
class Observer {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= Observer as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
const row: InboxNotification = {
  id: 'n-1',
  type: 'BOOKING_NEEDS_ATTENTION',
  title: 'Booking needs attention',
  description: 'Review the linked reservation.',
  category: 'Reservations',
  priority: 'High',
  capability: 'bookings.view',
  readAt: null,
  createdAt: '2026-10-19T09:00:00Z',
  needsAction: true,
  href: '/dashboard/t?propertyId=p&section=reservations&reservation=b-1',
  limitedContext: null,
  booking: {
    id: 'b-1',
    externalReference: 'MUST-123',
    status: 'MANUAL_REVIEW',
    guestName: 'Guest Example',
    startsOn: '2026-10-20',
    endsOn: '2026-10-22',
  },
};
const page = (overrides: Partial<InboxPage> = {}): InboxPage => ({
  items: [row],
  total: 1,
  page: 1,
  pageSize: 20,
  unreadTotal: 7,
  version: 3,
  through: '2026-10-19T10:00:00.000Z',
  canMarkRead: true,
  counts: { critical: 0, today: 1, needsAction: 1 },
  registry: [
    {
      type: row.type,
      title: row.title,
      category: row.category,
      priority: row.priority,
      capability: row.capability,
    },
  ],
  ...overrides,
});
const roots: Root[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  localStorage.clear();
  history.replaceState({}, '', '/');
});
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 15));
};
async function mount(bell = false) {
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(bell ? DashboardNotifications : NotificationsInbox, {
          tenantId: 't',
          propertyId: 'p',
        }),
      ),
    );
    await settle();
  });
  await act(settle);
  return root;
}
function button(text: string) {
  const result = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) =>
      b.textContent?.trim() === text || (text === row.title && b.textContent?.startsWith(text)),
  );
  if (!result) throw new Error(`Missing button ${text}`);
  return result;
}
async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
    await settle();
  });
}
function fixture(overrides: Partial<InboxPage> = {}) {
  let current = page(overrides);
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      current = {
        ...current,
        version: 4,
        unreadTotal: 6,
        items: current.items.map((r) => ({ ...r, readAt: '2026-10-19T10:01:00Z' })),
      };
      return Response.json({ updated: 1, version: 4 });
    }
    return Response.json(url.endsWith('/n-1') ? current.items[0] : current);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
describe('personal notification workspace', () => {
  it('uses real bell count and links to the permission-aware inbox detail without marking everyone read', async () => {
    const fetch = fixture();
    await mount(true);
    const bell = document.querySelector<HTMLButtonElement>(
      '[aria-label="Notifications (7 unread)"]',
    )!;
    expect(bell).not.toBeNull();
    await act(async () => {
      bell.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
      );
      await settle();
    });
    expect(
      document.querySelector(
        'a[href="/dashboard/t?propertyId=p&section=notifications&notification=n-1"]',
      ),
    ).not.toBeNull();
    expect(document.querySelector('a[href*="section=reservations"]')).toBeNull();
    expect(fetch.mock.calls.every(([, init]) => !init?.method)).toBe(true);
  });
  it('shows registry, counters and a rich detail side panel with authorized action', async () => {
    fixture();
    await mount();
    expect(document.body.textContent).toContain('Categories and routing');
    expect(document.body.textContent).toContain('bookings.view');
    expect(document.querySelector('[aria-label="Columns"]')).toBeTruthy();
    await click(button(row.title));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain('Guest Example');
    expect(document.body.textContent).toContain('Needs action - reading does not resolve it');
    expect(document.querySelector('a[href="' + row.href + '"]')?.textContent).toBe(
      'Open reservation',
    );
  });
  it('marks only actually visible rows with version/key and keeps needs-action after read', async () => {
    const fetch = fixture();
    await mount();
    await click(button('Mark visible as read'));
    const write = fetch.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(write[0]).toBe('/api/tenants/t/properties/p/notifications/mark-visible-read');
    expect(JSON.parse(write[1]!.body as string)).toEqual({ version: 3, ids: ['n-1'] });
    expect((write[1]!.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy();
    expect(document.body.textContent).toContain('Needs action');
    expect(document.body.textContent).not.toContain('Unread7');
  });
  it('mark all uses the observed cutoff and personal version', async () => {
    const fetch = fixture();
    await mount();
    await click(button('Mark all as read'));
    const write = fetch.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(JSON.parse(write[1]!.body as string)).toEqual({
      version: 3,
      through: '2026-10-19T10:00:00.000Z',
    });
  });
  it('filters unread and needs-action on the server and sends global search/date inputs', async () => {
    const fetch = fixture();
    await mount();
    await click(button('Unread7'));
    expect(fetch.mock.calls.some(([url]) => url.includes('unread=1'))).toBe(true);
    const needs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) =>
      b.textContent?.startsWith('Needs action'),
    )!;
    await click(needs);
    expect(fetch.mock.calls.some(([url]) => url.includes('needsAction=1'))).toBe(true);
    const input = document.querySelector<HTMLInputElement>('[aria-label="Search inbox"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        'MUST-123',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await settle();
    });
    expect(fetch.mock.calls.some(([url]) => url.includes('search=MUST-123'))).toBe(true);
  });
  it('bell lists up to 10, marks one item read and marks all read', async () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      ...row,
      id: `n-${i + 1}`,
      title: `Alert ${i + 1}`,
      readAt: i === 1 ? '2026-10-19T09:30:00Z' : null,
    }));
    const fetch = fixture({ items, pageSize: 10 });
    await mount(true);
    await act(async () => {
      document
        .querySelector('[aria-label="Notifications (7 unread)"]')!
        .dispatchEvent(
          new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
        );
      await settle();
    });
    expect(document.querySelectorAll('a[href*="&notification="]').length).toBe(10);
    expect(document.querySelector(`[aria-label='Mark "Alert 2" as read']`)).toBeNull();
    await click(
      document.querySelector<HTMLButtonElement>(`[aria-label='Mark "Alert 1" as read']`)!,
    );
    const single = fetch.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(single[0]).toBe('/api/tenants/t/properties/p/notifications/n-1');
    expect(JSON.parse(single[1]!.body as string)).toEqual({ version: 3 });
  });
  it('resolves an action item with a note and reopens a manual resolution', async () => {
    let item: InboxNotification = {
      ...row,
      actionable: true,
      resolution: { state: 'open' },
      readBy: [{ name: 'Front Desk', readAt: '2026-10-19T09:10:00Z' }],
    };
    const calls: Array<[string, RequestInit | undefined]> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push([url, init]);
        if (init?.method === 'PATCH' && url.endsWith('/resolve'))
          item = {
            ...item,
            needsAction: false,
            resolution: {
              state: 'resolved',
              source: 'manual',
              by: 'Ana Owner',
              at: '2026-10-19T11:00:00Z',
              note: JSON.parse(String(init.body)).note ?? null,
            },
          };
        if (init?.method === 'PATCH' && url.endsWith('/reopen'))
          item = { ...item, needsAction: true, resolution: { state: 'open' } };
        if (init?.method === 'PATCH') return Response.json({ changed: true });
        return Response.json(url.endsWith('/n-1') ? item : page({ items: [item] }));
      }),
    );
    await mount();
    await click(button(row.title));
    expect(document.body.textContent).toContain('Front Desk');
    await click(button('Mark as resolved'));
    const confirm = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .filter((b) => b.textContent?.trim() === 'Mark as resolved')
      .at(-1)!;
    const note = document.querySelector<HTMLTextAreaElement>('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        note,
        'Called the guest.',
      );
      note.dispatchEvent(new Event('input', { bubbles: true }));
      await settle();
    });
    await click(confirm);
    const resolveCall = calls.find(([url]) => url.endsWith('/n-1/resolve'))!;
    expect(JSON.parse(String(resolveCall[1]!.body))).toEqual({ note: 'Called the guest.' });
    expect(document.body.textContent).toContain('Ana Owner');
    expect(document.body.textContent).toContain('Called the guest.');
    await click(button('Reopen'));
    await click(
      [...document.querySelectorAll<HTMLButtonElement>('button')]
        .filter((b) => b.textContent?.trim() === 'Reopen')
        .at(-1)!,
    );
    expect(calls.some(([url]) => url.endsWith('/n-1/reopen'))).toBe(true);
  });
  it('read-only and limited context hide unauthorized links and disable read writes', async () => {
    fixture({
      canMarkRead: false,
      items: [{ ...row, href: null, booking: null, limitedContext: 'bookings.view' }],
    });
    await mount();
    expect(button('Mark all as read').disabled).toBe(true);
    expect(button('Mark visible as read').disabled).toBe(true);
    await click(button(row.title));
    expect(document.body.textContent).toContain('Limited context: bookings.view');
    expect(document.body.textContent).not.toContain('Guest Example');
    expect(document.querySelector('a[href*="section=reservations"]')).toBeNull();
    expect(button('Mark as read').disabled).toBe(true);
  });
  it('shows truthful empty, failed and permission-denied states with request references', async () => {
    fixture({ items: [], total: 0, unreadTotal: 0 });
    const root = await mount();
    expect(document.body.textContent).toContain('No notifications');
    await act(async () => root.unmount());
    roots.splice(roots.indexOf(root), 1);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: 'Missing inbox access' }), {
            status: 403,
            headers: { 'x-request-id': 'notify-ref' },
          }),
      ),
    );
    await mount();
    expect(document.body.textContent).toContain('Notifications access denied');
    expect(document.body.textContent).toContain('notify-ref');
    expect(document.querySelector('table')).toBeNull();
  });
  it('opens a notification deep link and rejects an external destination defensively', async () => {
    history.replaceState({}, '', '/?notification=n-1');
    fixture({ items: [{ ...row, href: 'https://evil.invalid' }] });
    await mount();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('a[href="https://evil.invalid"]')).toBeNull();
  });
});

it('removes cached detail and navigation after inbox permission is revoked', async () => {
  let denied = false;
  vi.stubGlobal('fetch', async (url: string) =>
    denied && !url.endsWith('/n-1')
      ? new Response('{"message":"Access revoked"}', { status: 403 })
      : Response.json(url.endsWith('/n-1') ? row : page()),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    root = createRoot(document.body.appendChild(document.createElement('div')));
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(NotificationsInbox, { tenantId: 't', propertyId: 'p' }),
      ),
    );
    await settle();
  });
  await act(settle);
  await click(button(row.title));
  expect(document.querySelector('a[href="' + row.href + '"]')).not.toBeNull();
  denied = true;
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['dashboard', 'notifications'] });
    await settle();
  });
  expect(document.body.textContent).toContain('Notifications access denied');
  expect(document.querySelector('a[href="' + row.href + '"]')).toBeNull();
  expect(document.body.textContent).not.toContain('Guest Example');
  expect(button('Mark all as read').disabled).toBe(true);
  client.clear();
});
