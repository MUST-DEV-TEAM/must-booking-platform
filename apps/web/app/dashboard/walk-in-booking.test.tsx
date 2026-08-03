// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { WalkInBooking } from './walk-in-booking';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const base = '/api/tenants/tenant-1/properties/property-1';
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('WalkInBooking', () => {
  it('searches, creates a walk-in booking, and settles it with the selected manual method', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === `${base}/room-types`)
        return Promise.resolve(response([{ id: 'room-1', name: 'Deluxe' }]));
      if (url === `${base}/rate-plans`)
        return Promise.resolve(response([{ id: 'rate-1', name: 'Flexible', currency: 'EUR' }]));
      if (url === `${base}/quotes`)
        return Promise.resolve(response({ total: { amount: '120.00', currency: 'EUR' } }));
      if (url.startsWith(`${base}/availability?`))
        return Promise.resolve(response({ isAvailable: true, availableUnits: 1 }));
      if (url === `${base}/staff-bookings`)
        return Promise.resolve(response({ ok: true, value: { id: 'booking-1' } }));
      if (url === `${base}/bookings/booking-1/manual-payment`)
        return Promise.resolve(response({ ok: true }));
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container, root } = await mount();
    await setValue(container.querySelector('select')!, 'room-1');
    await setValue(container.querySelectorAll('select')[1], 'rate-1');
    await setValue(container.querySelector('input[type="date"]')!, '2026-08-10');
    await setValue(container.querySelectorAll('input[type="date"]')[1], '2026-08-12');
    await click(container, 'Search availability');
    await setValue(container.querySelectorAll('input')[2], 'Ada');
    await setValue(container.querySelectorAll('input')[3], 'Lovelace');
    await setValue(container.querySelector('input[type="email"]')!, 'ada@example.test');
    await setValue(container.querySelectorAll('select')[2], 'cash');
    await click(container, 'Create booking');
    expect(fetchMock).toHaveBeenCalledWith(
      `${base}/staff-bookings`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `${base}/bookings/booking-1/manual-payment`,
      expect.objectContaining({ method: 'POST' }),
    );
    const paymentCall = fetchMock.mock.calls.find(
      ([url]) => url === `${base}/bookings/booking-1/manual-payment`,
    )!;
    expect(JSON.parse(paymentCall[1].body)).toEqual({ method: 'cash' });
    expect(toast.success).toHaveBeenCalledWith('Booking created and payment recorded.');
    await act(async () => root.unmount());
    container.remove();
  });

  it('shows the exact booking-rule validation message from the quote API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === `${base}/room-types`)
          return Promise.resolve(response([{ id: 'room-1', name: 'Deluxe' }]));
        if (url === `${base}/rate-plans`)
          return Promise.resolve(response([{ id: 'rate-1', name: 'Flexible' }]));
        if (url === `${base}/quotes`)
          return Promise.resolve(response({ message: 'The minimum stay is 3 nights.' }, 400));
        if (url.startsWith(`${base}/availability?`))
          return Promise.resolve(response({ isAvailable: true }));
        throw new Error(`Unexpected fetch ${url}`);
      }),
    );
    const { container, root } = await mount();
    await setValue(container.querySelector('select')!, 'room-1');
    await setValue(container.querySelectorAll('select')[1], 'rate-1');
    await setValue(container.querySelector('input[type="date"]')!, '2026-08-10');
    await setValue(container.querySelectorAll('input[type="date"]')[1], '2026-08-11');
    await click(container, 'Search availability');
    expect(toast.error).toHaveBeenCalledWith('The minimum stay is 3 nights.');
    await act(async () => root.unmount());
    container.remove();
  });
});

async function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(WalkInBooking, { tenantId: 'tenant-1', propertyId: 'property-1' }));
    await Promise.resolve();
    await Promise.resolve();
  });
  return { container, root };
}
async function setValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!;
    setter.call(element, value);
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function click(container: HTMLElement, text: string) {
  await act(async () => {
    Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === text)!
      .click();
    await Promise.resolve();
    await Promise.resolve();
  });
}
