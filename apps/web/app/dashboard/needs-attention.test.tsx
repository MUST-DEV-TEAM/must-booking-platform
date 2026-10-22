// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NeedsAttentionTab } from './needs-attention';
import { DashboardQueryProvider } from './query-provider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Radix selects measure elements that jsdom does not implement.
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopObserver as unknown as typeof ResizeObserver;

const row = (overrides: Record<string, unknown>) => ({
  id: 'booking',
  externalReference: 'MB-1',
  status: 'MANUAL_REVIEW',
  paymentMethod: 'PAY_AT_HOTEL',
  startsOn: '2026-08-24',
  endsOn: '2026-08-26',
  createdAt: '2026-08-20T10:00:00.000Z',
  roomName: null,
  roomTypeName: 'Double room',
  guestFirstName: 'Ada',
  guestLastName: 'Guest',
  guestEmail: 'ada@example.test',
  total: { amount: '200.00', currency: 'EUR' },
  paidAmount: '0.00',
  refundedAmount: '0.00',
  ...overrides,
});

const items = [
  row({ id: 'booking-1', externalReference: 'MB-1', status: 'PAYMENT_FAILED' }),
  row({
    id: 'booking-2',
    externalReference: 'MB-2',
    status: 'MANUAL_REVIEW',
    guestFirstName: null,
    guestLastName: null,
    guestEmail: 'grace@example.test',
  }),
];

afterEach(() => vi.unstubAllGlobals());

describe('NeedsAttentionTab', () => {
  it('does not call an uncertain booking total a confirmed debt', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ items: [row({ status: 'PMS_UNKNOWN_RESULT' })] })),
    );
    const { container, root } = await mount();
    expect(container.textContent).toContain('Balance not confirmed');
    await act(async () => root.unmount());
  });
  it('asks the search endpoint for the attention view and lists each issue in staff words', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ items })));
    vi.stubGlobal('fetch', fetch);

    const { container, root } = await mount();

    expect(String((fetch.mock.calls[0] as unknown[])[0])).toContain('view=needs_attention');
    const table = container.querySelector('table[aria-label="Bookings needing attention"]')!;
    expect(table.textContent).toContain('Ada Guest');
    expect(table.textContent).toContain('grace@example.test');
    expect(table.textContent).toContain('Payment failed');
    expect(table.textContent).toContain('Reservation awaiting review');
    expect(table.textContent).toContain('Urgent');
    // Urgent items come first by default.
    expect(table.textContent!.indexOf('Payment failed')).toBeLessThan(
      table.textContent!.indexOf('Reservation awaiting review'),
    );

    await act(async () => root.unmount());
  });

  it('shows why the first item is flagged and links to its reservation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ items }))),
    );
    const { container, root } = await mount();

    expect(container.textContent).toContain('Why this is flagged');
    expect(container.textContent).toContain(
      'The online payment for this reservation did not go through.',
    );
    expect(
      container.querySelector(
        'a[href="/dashboard/t?propertyId=p&section=reservations&reservation=booking-1"]',
      )?.textContent,
    ).toContain('Open reservation record');

    await act(async () => root.unmount());
  });

  it('narrows the queue from a summary tile and from a search', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ items }))),
    );
    const { container, root } = await mount();

    const tile = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Booking review'),
    )!;
    await click(tile);
    const table = () => container.querySelector('table')?.textContent ?? '';
    expect(table()).toContain('Reservation awaiting review');
    expect(table()).not.toContain('Payment failed');

    await click(
      Array.from(container.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Open issues'),
      )!,
    );
    expect(table()).toContain('Payment failed');

    await act(async () => root.unmount());
  });

  it('renders an actionable empty state when there are no attention items', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ items: [] }))),
    );

    const { container, root } = await mount();

    expect(container.textContent).toContain('No bookings need attention');
    expect(
      container.querySelector('a[href="/dashboard/t?propertyId=p&section=overview&tab=overview"]'),
    ).not.toBeNull();

    await act(async () => root.unmount());
  });

  it('requires a note and removes a failed unpaid attempt through the audited action', async () => {
    let closed = false;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/review/dismiss')) {
        closed = true;
        return Response.json({ ok: true });
      }
      return Response.json({ items: closed ? [] : [items[0]] });
    });
    vi.stubGlobal('fetch', fetcher);
    const { container, root } = await mount(true);
    const button = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Close unsuccessful attempt',
    )!;
    expect(button.disabled).toBe(true);
    const input = container.querySelector('input[aria-label="Review note"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        'Reviewed failed attempt; no booking or money held.',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(button);
    for (let n = 0; n < 4; n++)
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
    const request = fetcher.mock.calls.find(([url]) => url.endsWith('/review/dismiss'))!;
    expect(JSON.parse(String(request[1]?.body))).toEqual({
      note: 'Reviewed failed attempt; no booking or money held.',
    });
    expect(container.textContent).toContain('No bookings need attention');
    await act(async () => root.unmount());
  });

  it('shows an error with a retry when the queue cannot load', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items })));
    vi.stubGlobal('fetch', fetch);

    const { container, root } = await mount();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Unable to load the queue',
    );

    await click(
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === 'Try again',
      )!,
    );
    expect(container.textContent).toContain('Payment failed');

    await act(async () => root.unmount());
  });
});

async function mount(canEdit = false) {
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(NeedsAttentionTab, { tenantId: 't', propertyId: 'p', canEdit }),
      ),
    );
  });
  await act(async () => {
    await vi.waitFor(() => {
      if (container.querySelector('[aria-busy="true"]'))
        throw new Error('Needs attention has not finished loading yet.');
    });
  });
  return { container, root };
}

async function click(element: Element) {
  await act(async () => {
    (element as HTMLButtonElement).click();
    for (let iteration = 0; iteration < 4; iteration += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
      await Promise.resolve();
    }
  });
}
