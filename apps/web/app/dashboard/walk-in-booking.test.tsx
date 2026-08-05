// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { WalkInBooking } from './walk-in-booking';
import { DashboardQueryProvider } from './query-provider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const base = '/api/tenants/tenant-1/properties/property-1';
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('WalkInBooking', () => {
  it('local property: shows the Rate Plan field, searches by calendar dates, creates a booking, settles it', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === `${base}/pms-connection-status`)
        return Promise.resolve(response({ provider: 'LOCAL' }));
      if (url === `${base}/room-types`)
        return Promise.resolve(response([{ id: 'room-type-1', name: 'Deluxe', roomCount: 3 }]));
      if (url === `${base}/rooms`) return Promise.resolve(response([]));
      if (url === `${base}/rate-plans`)
        return Promise.resolve(response([{ id: 'rate-1', name: 'Flexible', currency: 'EUR' }]));
      if (url.startsWith(`${base}/availability-calendar?`))
        return Promise.resolve(response({ days: [] })); // nothing unavailable
      if (url === `${base}/quotes`)
        return Promise.resolve(response({ total: { amount: '120.00', currency: 'EUR' } }));
      if (url === `${base}/staff-bookings`)
        return Promise.resolve(response({ ok: true, value: { id: 'booking-1' } }));
      if (url === `${base}/bookings/booking-1/manual-payment`)
        return Promise.resolve(response({ ok: true }));
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container, root } = await mount({
      paymentGateways: { stripe: false, pokpay: false, payAtHotel: true },
    });

    await setValue(container.querySelector('select')!, 'room-type-1');
    const ratePlanSelect = Array.from(container.querySelectorAll('select')).find((select) =>
      Array.from(select.options).some((option) => option.value === 'rate-1'),
    )!;
    await setValue(ratePlanSelect, 'rate-1');
    await clickDay(container, '2026-08-10');
    await clickDay(container, '2026-08-11');
    await click(container, 'Search availability');
    expect(fetchMock).toHaveBeenCalledWith(
      `${base}/quotes`,
      expect.objectContaining({
        body: JSON.stringify({
          roomTypeId: 'room-type-1',
          roomId: undefined,
          ratePlanId: 'rate-1',
          startsOn: '2026-08-10',
          endsOn: '2026-08-12',
        }),
      }),
    );

    const [firstName, lastName] = Array.from(
      container.querySelectorAll('input:not([type="email"])'),
    );
    await setValue(firstName!, 'Ada');
    await setValue(lastName!, 'Lovelace');
    await setValue(container.querySelector('input[type="email"]')!, 'ada@example.test');
    const gatewaySelect = Array.from(container.querySelectorAll('select')).find((select) =>
      Array.from(select.options).some((option) => option.value === 'pay_at_hotel'),
    )!;
    await setValue(gatewaySelect, 'pay_at_hotel');
    const settleSelect = Array.from(container.querySelectorAll('select')).find((select) =>
      Array.from(select.options).some((option) => option.value === 'cash'),
    )!;
    await setValue(settleSelect, 'cash');
    await click(container, 'Create booking');

    const bookingCall = fetchMock.mock.calls.find(([url]) => url === `${base}/staff-bookings`)!;
    expect(JSON.parse(bookingCall[1].body).paymentMethod).toBe('pay_at_hotel');
    const paymentCall = fetchMock.mock.calls.find(
      ([url]) => url === `${base}/bookings/booking-1/manual-payment`,
    )!;
    expect(JSON.parse(paymentCall[1].body)).toEqual({ method: 'cash' });
    expect(toast.success).toHaveBeenCalledWith('Booking created and payment recorded.');
    await act(async () => root.unmount());
    container.remove();
  });

  it('Clock-connected property: hides the Rate Plan field and creates a pay-at-hotel booking without ratePlanId', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === `${base}/pms-connection-status`)
        return Promise.resolve(response({ provider: 'CLOCK_PMS' }));
      if (url === `${base}/room-types`)
        return Promise.resolve(response([{ id: 'room-type-1', name: 'DBL', roomCount: 5 }]));
      if (url === `${base}/rooms`) return Promise.resolve(response([]));
      if (url === `${base}/rate-plans`) return Promise.resolve(response([]));
      if (url.startsWith(`${base}/availability-calendar?`))
        return Promise.resolve(response({ days: [] }));
      if (url === `${base}/quotes`)
        return Promise.resolve(response({ total: { amount: '250.00', currency: 'EUR' } }));
      if (url === `${base}/staff-bookings`)
        return Promise.resolve(response({ ok: true, value: { id: 'booking-2' } }));
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container, root } = await mount({
      paymentGateways: { stripe: false, pokpay: true, payAtHotel: true },
    });

    await setValue(container.querySelector('select')!, 'room-type-1');
    // Rate Plan field must not exist at all for a Clock-connected property.
    expect(
      Array.from(container.querySelectorAll('label')).some((label) =>
        label.textContent?.includes('Rate plan'),
      ),
    ).toBe(false);

    await clickDay(container, '2026-08-10');
    await clickDay(container, '2026-08-11');
    await click(container, 'Search availability');
    expect(fetchMock).toHaveBeenCalledWith(
      `${base}/quotes`,
      expect.objectContaining({
        body: JSON.stringify({
          roomTypeId: 'room-type-1',
          roomId: undefined,
          ratePlanId: undefined,
          startsOn: '2026-08-10',
          endsOn: '2026-08-12',
        }),
      }),
    );

    const [firstName, lastName] = Array.from(
      container.querySelectorAll('input:not([type="email"])'),
    );
    await setValue(firstName!, 'Ada');
    await setValue(lastName!, 'Lovelace');
    await setValue(container.querySelector('input[type="email"]')!, 'ada@example.test');
    // Only "pay_at_hotel" and "pokpay" should be offered (stripe disabled).
    const gatewaySelect = Array.from(container.querySelectorAll('select')).find((select) =>
      Array.from(select.options).some((option) => option.value === 'pay_at_hotel'),
    )!;
    expect(Array.from(gatewaySelect.options).map((option) => option.value)).toEqual([
      '',
      'pay_at_hotel',
      'pokpay',
    ]);
    await setValue(gatewaySelect, 'pay_at_hotel');
    await click(container, 'Create booking');

    const bookingCall = fetchMock.mock.calls.find(([url]) => url === `${base}/staff-bookings`)!;
    const body = JSON.parse(bookingCall[1].body);
    expect(body.ratePlanId).toBeUndefined();
    expect(body.paymentMethod).toBe('pay_at_hotel');
    expect(toast.success).toHaveBeenCalledWith('Booking created as pay at hotel.');
    await act(async () => root.unmount());
    container.remove();
  });

  it('online payment (PokPay): opens the checkout URL in a new window instead of settling manually', async () => {
    const openSpy = vi.fn();
    vi.stubGlobal('open', openSpy);
    const fetchMock = vi.fn((url: string) => {
      if (url === `${base}/pms-connection-status`)
        return Promise.resolve(response({ provider: 'LOCAL' }));
      if (url === `${base}/room-types`)
        return Promise.resolve(response([{ id: 'room-type-1', name: 'Deluxe', roomCount: 3 }]));
      if (url === `${base}/rooms`) return Promise.resolve(response([]));
      if (url === `${base}/rate-plans`)
        return Promise.resolve(response([{ id: 'rate-1', name: 'Flexible', currency: 'EUR' }]));
      if (url.startsWith(`${base}/availability-calendar?`))
        return Promise.resolve(response({ days: [] }));
      if (url === `${base}/quotes`)
        return Promise.resolve(response({ total: { amount: '120.00', currency: 'EUR' } }));
      if (url === `${base}/staff-bookings`)
        return Promise.resolve(
          response({
            ok: true,
            value: { id: 'booking-3', checkoutUrl: 'https://pay.pokpay.test/order-1' },
          }),
        );
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container, root } = await mount({
      paymentGateways: { stripe: false, pokpay: true, payAtHotel: true },
    });

    await setValue(container.querySelector('select')!, 'room-type-1');
    const ratePlanSelect = Array.from(container.querySelectorAll('select')).find((select) =>
      Array.from(select.options).some((option) => option.value === 'rate-1'),
    )!;
    await setValue(ratePlanSelect, 'rate-1');
    await clickDay(container, '2026-08-10');
    await clickDay(container, '2026-08-11');
    await click(container, 'Search availability');

    const [firstName, lastName] = Array.from(
      container.querySelectorAll('input:not([type="email"])'),
    );
    await setValue(firstName!, 'Ada');
    await setValue(lastName!, 'Lovelace');
    await setValue(container.querySelector('input[type="email"]')!, 'ada@example.test');
    const gatewaySelect = Array.from(container.querySelectorAll('select')).find((select) =>
      Array.from(select.options).some((option) => option.value === 'pokpay'),
    )!;
    await setValue(gatewaySelect, 'pokpay');
    // Settle now must not be offered for an online gateway method.
    expect(
      Array.from(container.querySelectorAll('label')).some((label) =>
        label.textContent?.includes('Settle now'),
      ),
    ).toBe(false);
    await click(container, 'Create booking');

    const bookingCall = fetchMock.mock.calls.find(([url]) => url === `${base}/staff-bookings`)!;
    expect(JSON.parse(bookingCall[1].body).paymentMethod).toBe('pokpay');
    expect(openSpy).toHaveBeenCalledWith(
      'https://pay.pokpay.test/order-1',
      '_blank',
      'noopener,noreferrer',
    );
    expect(fetchMock.mock.calls.some(([url]) => url.includes('manual-payment'))).toBe(false);
    expect(toast.success).toHaveBeenCalledWith(
      'Booking created — complete payment in the new window. It confirms automatically once paid.',
    );
    await act(async () => root.unmount());
    container.remove();
  });

  it('shows the exact booking-rule validation message from the quote API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === `${base}/pms-connection-status`)
          return Promise.resolve(response({ provider: 'LOCAL' }));
        if (url === `${base}/room-types`)
          return Promise.resolve(response([{ id: 'room-type-1', name: 'Deluxe', roomCount: 3 }]));
        if (url === `${base}/rooms`) return Promise.resolve(response([]));
        if (url === `${base}/rate-plans`)
          return Promise.resolve(response([{ id: 'rate-1', name: 'Flexible' }]));
        if (url.startsWith(`${base}/availability-calendar?`))
          return Promise.resolve(response({ days: [] }));
        if (url === `${base}/quotes`)
          return Promise.resolve(response({ message: 'The minimum stay is 3 nights.' }, 400));
        throw new Error(`Unexpected fetch ${url}`);
      }),
    );
    const { container, root } = await mount({
      paymentGateways: { stripe: false, pokpay: false, payAtHotel: true },
    });
    await setValue(container.querySelector('select')!, 'room-type-1');
    const ratePlanSelect = Array.from(container.querySelectorAll('select')).find((select) =>
      Array.from(select.options).some((option) => option.value === 'rate-1'),
    )!;
    await setValue(ratePlanSelect, 'rate-1');
    await clickDay(container, '2026-08-10');
    await clickDay(container, '2026-08-11');
    await click(container, 'Search availability');
    expect(toast.error).toHaveBeenCalledWith('The minimum stay is 3 nights.');
    await act(async () => root.unmount());
    container.remove();
  });
});

async function mount(options?: {
  bookingMode?: 'ROOM_TYPE_ONLY' | 'INDIVIDUAL_ROOM_ONLY' | 'MIXED';
  paymentGateways?: { stripe: boolean; pokpay: boolean; payAtHotel: boolean };
}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(WalkInBooking, {
          tenantId: 'tenant-1',
          propertyId: 'property-1',
          bookingMode: options?.bookingMode,
          paymentGateways: options?.paymentGateways,
        }),
      ),
    );
  });
  await settle();
  return { container, root };
}
async function settle() {
  await act(async () => {
    for (let iteration = 0; iteration < 6; iteration += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
      await Promise.resolve();
    }
  });
}
async function setValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!;
    setter.call(element, value);
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
}
async function clickDay(container: HTMLElement, isoDay: string) {
  await act(async () => {
    const button = container.querySelector<HTMLButtonElement>(`td[data-day="${isoDay}"] button`);
    if (!button) throw new Error(`No calendar day button found for ${isoDay}`);
    button.click();
  });
  await settle();
}
async function click(container: HTMLElement, text: string) {
  await act(async () => {
    Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === text)!
      .click();
  });
  await settle();
}
