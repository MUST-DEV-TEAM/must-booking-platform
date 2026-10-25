// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AwaitingPayment } from './awaiting-payment';
import { DashboardQueryProvider } from './query-provider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.unstubAllGlobals());

async function mount({ canCheckPayment = true, canViewBooking = true } = {}) {
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(AwaitingPayment, {
          tenantId: 't',
          propertyId: 'p',
          bookingId: 'b',
          reference: 'MB-1',
          checkoutUrl: 'https://pay.example.test/checkout',
          checkoutOrderId: 'initial-order',
          providerName: 'PokPay',
          reservationHref: '/dashboard/t?propertyId=p&section=reservations&reservation=b',
          canCheckPayment,
          canViewBooking,
          onStartOver: () => undefined,
        }),
      ),
    );
  });
  return { container, root };
}

const settle = () => act(async () => new Promise((resolve) => window.setTimeout(resolve, 60)));

describe('AwaitingPayment', () => {
  it('stays unconfirmed while the provider has not reported the payment', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ status: 'PAYMENT_PENDING' }))),
    );
    const { container, root } = await mount();
    await settle();

    expect(container.textContent).toContain('Waiting for the payment');
    expect(container.textContent).not.toContain('Payment received');
    expect(
      Array.from(container.querySelectorAll('button')).some((button) =>
        button.textContent?.includes('Pay with PokPay'),
      ),
    ).toBe(true);
    await act(async () => root.unmount());
  });

  it('confirms only after the reservation itself is confirmed, and asks the server to re-check', async () => {
    let status = 'PAYMENT_PENDING';
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        status = 'CONFIRMED';
        return new Response(JSON.stringify({ ok: true }));
      }
      return new Response(JSON.stringify({ status }));
    });
    vi.stubGlobal('fetch', fetch);
    const { container, root } = await mount();
    await settle();

    const checkNow = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Check payment now'),
    )!;
    await act(async () => checkNow.click());
    await settle();
    await settle();

    expect(
      fetch.mock.calls.some(([url]) => String(url).endsWith('/bookings/b/check-payment')),
    ).toBe(true);
    expect(container.textContent).toContain('Payment received');
    await act(async () => root.unmount());
  });

  it('explains a failed payment and offers the reservation or a fresh start', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ status: 'PAYMENT_FAILED' }))),
    );
    const { container, root } = await mount();
    await settle();

    expect(container.textContent).toContain('The payment did not complete');
    expect(container.textContent).toContain('Start a new reservation');
    await act(async () => root.unmount());
  });

  it('does not offer or poll the check-payment action without bookings.edit', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ status: 'PAYMENT_PENDING' })));
    vi.stubGlobal('fetch', fetch);
    const { container, root } = await mount({ canCheckPayment: false });
    await settle();
    expect(container.textContent).not.toContain('Check payment now');
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    await act(async () => root.unmount());
  });
});

it('signals verified money receipt while Clock confirmation is still pending', async () => {
  const postMessage = vi.fn();
  vi.stubGlobal(
    'BroadcastChannel',
    class {
      postMessage = postMessage;
      close() {}
      onmessage: unknown;
    },
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ status: 'PMS_CONFIRMATION_PENDING', paidAmount: '100.00' })),
  );
  const { root } = await mount();
  await settle();
  expect(postMessage).toHaveBeenCalledWith({
    bookingId: 'b',
    orderId: 'initial-order',
    state: 'PAID',
  });
  await act(async () => root.unmount());
});
