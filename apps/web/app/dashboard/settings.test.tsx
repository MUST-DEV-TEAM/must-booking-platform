// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DashboardSettings } from './settings';
import { DashboardQueryProvider } from './query-provider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let property = {
  id: 'p',
  name: 'Grand Hotel',
  address: '1 Main Street',
  timezone: 'Europe/Tirane',
  minStayNights: 2,
  maxStayNights: 7,
  checkInTime: '15:00',
  checkOutTime: '11:00',
  advanceBookingDays: 90,
  freeCancellationDaysBeforeArrival: 21,
  bookingMode: 'ROOM_TYPE_ONLY' as 'ROOM_TYPE_ONLY' | 'INDIVIDUAL_ROOM_ONLY' | 'MIXED',
  paymentGateways: { stripe: false, pokpay: false, payAtHotel: true },
  wordpressConnectedAt: null as string | null,
};

afterEach(() => vi.unstubAllGlobals());

describe('DashboardSettings', () => {
  it('shows a retry control when the initial settings lookup fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 500 })),
    );
    const { container, root } = await mount();
    expect(container.textContent).toContain('Unable to load property settings.');
    expect(
      Array.from(container.querySelectorAll('button')).some(
        (button) => button.textContent === 'Retry',
      ),
    ).toBe(true);
    await act(async () => root.unmount());
  });

  it('round-trips identity, booking rules, and booking mode with only changed fields', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && url.endsWith('/wordpress-pairing'))
        return new Response(JSON.stringify({ code: 'MUST-GRANDHOTEL-ABCD-1234' }), { status: 201 });
      if (init?.method === 'PATCH') {
        property = {
          ...property,
          ...(JSON.parse(init.body as string) as Partial<typeof property>),
        };
        return new Response(JSON.stringify(property));
      }
      if (url.endsWith('/properties')) return new Response(JSON.stringify([property]));
      if (url.endsWith('/plan-usage'))
        return new Response(
          JSON.stringify({ plan: { name: 'Free', maxProperties: 3 }, usage: { properties: 1 } }),
        );
      if (url.endsWith('/integration-connections')) return new Response(JSON.stringify([]));
      return new Response(JSON.stringify({ ok: true }));
    });
    vi.stubGlobal('fetch', fetch);
    const { container, root } = await mount();

    expect(container.textContent).toContain('Current plan: Free');
    expect(container.textContent).toContain('do not validate or block bookings');
    expect(container.textContent).toContain('Manage properties');
    expect(container.textContent).toContain('Add property');
    expect(container.querySelector('button[disabled]')?.textContent).toContain('Milestone 13');

    await value(container.querySelector('[aria-label="Hotel name"]')!, 'Grand Hotel Tirana');
    await submit(container, 'Save hotel identity');
    const identityRequest = fetch.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(JSON.parse(identityRequest[1]!.body as string)).toEqual({ name: 'Grand Hotel Tirana' });
    expect((container.querySelector('[aria-label="Hotel name"]') as HTMLInputElement).value).toBe(
      'Grand Hotel Tirana',
    );

    await value(container.querySelector('[aria-label="Minimum stay (nights)"]')!, '3');
    await submit(container, 'Save booking rules');
    const patchCalls = fetch.mock.calls.filter(([, init]) => init?.method === 'PATCH');
    expect(JSON.parse(patchCalls[1][1]!.body as string)).toEqual({ minStayNights: 3 });

    await select(container.querySelector('[aria-label="Booking mode"]')!, 'INDIVIDUAL_ROOM_ONLY');
    await submit(container, 'Save booking mode');
    const bookingModeRequest = fetch.mock.calls.filter(([, init]) => init?.method === 'PATCH')[2];
    expect(JSON.parse(bookingModeRequest[1]!.body as string)).toEqual({
      bookingMode: 'INDIVIDUAL_ROOM_ONLY',
    });

    const pokpayCheckbox = Array.from(container.querySelectorAll('input[type="checkbox"]')).find(
      (input) => input.closest('label')?.textContent?.includes('PokPay'),
    ) as HTMLInputElement;
    await act(async () => {
      pokpayCheckbox.click();
      await Promise.resolve();
    });
    await submit(container, 'Save payment methods');
    const paymentGatewaysRequest = fetch.mock.calls.find(
      ([url, init]) => init?.method === 'PATCH' && url.endsWith('/payment-gateways'),
    )!;
    expect(JSON.parse(paymentGatewaysRequest[1]!.body as string)).toEqual({
      stripe: false,
      pokpay: true,
      payAtHotel: true,
    });

    const generateCodeButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Generate connection code',
    )!;
    await act(async () => {
      generateCodeButton.click();
      for (let iteration = 0; iteration < 4; iteration += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 20));
        await Promise.resolve();
      }
    });
    expect(fetch.mock.calls.some(([url, init]) => init?.method === 'POST' && url.endsWith('/wordpress-pairing'))).toBe(true);
    expect(
      (container.querySelector('[aria-label="Connection code"]') as HTMLInputElement).value,
    ).toBe('MUST-GRANDHOTEL-ABCD-1234');
    expect(container.textContent).toContain('Expires in 30 minutes');

    await act(async () => root.unmount());
  });
});

async function mount() {
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(DashboardSettings, { tenantId: 't', propertyId: 'p' }),
      ),
    );
  });
  for (let iteration = 0; iteration < 8; iteration += 1) {
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
      await Promise.resolve();
    });
  }
  return { container, root };
}

async function value(element: Element, next: string) {
  await act(async () => {
    const input = element as HTMLInputElement;
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!.call(input, next);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
  });
}

async function submit(container: HTMLElement, text: string) {
  await act(async () => {
    Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === text)!
      .closest('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    for (let iteration = 0; iteration < 4; iteration += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
      await Promise.resolve();
    }
  });
}

async function select(element: Element, next: string) {
  await act(async () => {
    const input = element as HTMLSelectElement;
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!.call(input, next);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
  });
}
