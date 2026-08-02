// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DashboardSettings } from './settings';

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
};

afterEach(() => vi.unstubAllGlobals());

describe('DashboardSettings', () => {
  it('round-trips identity and sends only the booking-rule field the form changed', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
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
      return new Response(JSON.stringify({ ok: true }));
    });
    vi.stubGlobal('fetch', fetch);
    const { container, root } = await mount();

    expect(container.textContent).toContain('Current plan: Free');
    expect(container.textContent).toContain('do not validate or block bookings');
    expect(container.textContent).toContain('Manage properties');
    expect(container.textContent).toContain('Add property');
    expect(container.querySelector('button[disabled]')?.textContent).toContain('Milestone 11');

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
    await act(async () => root.unmount());
  });
});

async function mount() {
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(DashboardSettings, { tenantId: 't', propertyId: 'p' }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
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
    await Promise.resolve();
    await Promise.resolve();
  });
}
