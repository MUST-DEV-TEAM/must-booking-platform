// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DashboardSettings, SettingsHub, isSettingsArea, type SettingsArea } from './settings';
import { DashboardQueryProvider } from './query-provider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let property = {
  id: 'p',
  name: 'Grand Hotel',
  address: '1 Main Street',
  timezone: 'Europe/Tirane',
  logoUrl: null as string | null,
  phone: null as string | null,
  supportEmail: null as string | null,
  minStayNights: 2,
  maxStayNights: 7,
  checkInTime: '15:00',
  checkOutTime: '11:00',
  rules: 'No smoking.',
  advanceBookingDays: 90,
  freeCancellationDaysBeforeArrival: 21,
  bookingMode: 'ROOM_TYPE_ONLY' as 'ROOM_TYPE_ONLY' | 'INDIVIDUAL_ROOM_ONLY' | 'MIXED',
  paymentGateways: { stripe: false, pokpay: false, payAtHotel: true },
  wordpressConnectedAt: null as string | null,
  publicWebsiteOrigin: null as string | null,
};

afterEach(() => vi.unstubAllGlobals());

describe('DashboardSettings', () => {
  it('renders a hub for every implemented settings area and omits unimplemented areas', () => {
    const markup = renderToStaticMarkup(
      createElement(SettingsHub, { tenantId: 't', propertyId: 'p' }),
    );
    const areas = [
      'General',
      'Booking rules',
      'Payments',
      'Branding',
      'Managed Pages',
      'Billing account',
    ];
    for (const area of areas) expect(markup).toContain(area);
    for (const area of [
      'Check-in & Check-out',
      'Staff & Access',
      'Notifications & Emails',
      'Provider',
      'Diagnostics & Maintenance',
      'Dangerous Reset',
    ])
      expect(markup).not.toContain(area);
    expect(markup).toContain(
      'href="/dashboard/t?propertyId=p&amp;section=settings&amp;settingsArea=general"',
    );
    expect(markup).toContain(
      'href="/dashboard/t?propertyId=p&amp;section=settings&amp;settingsArea=booking-rules"',
    );
    expect(markup).toContain(
      'href="/dashboard/t?propertyId=p&amp;section=settings&amp;settingsArea=payments"',
    );
    expect(markup).toContain(
      'href="/dashboard/t?propertyId=p&amp;section=settings&amp;settingsArea=branding"',
    );
    expect(markup).toContain(
      'href="/dashboard/t?propertyId=p&amp;section=settings&amp;settingsArea=managed-pages"',
    );
    expect(markup).toContain(
      'href="/dashboard/t?propertyId=p&amp;section=settings&amp;settingsArea=billing"',
    );
    expect(markup).not.toContain('settingsArea=booking-mode');
    expect(isSettingsArea('general')).toBe(true);
    expect(isSettingsArea('booking-rules')).toBe(true);
    expect(isSettingsArea('booking-mode')).toBe(false);
    expect(isSettingsArea('dangerous-reset')).toBe(false);
  });

  it('shows only the selected area with a link back to the Settings hub', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/properties')) return new Response(JSON.stringify([property]));
        if (url.endsWith('/plan-usage'))
          return new Response(JSON.stringify({ plan: { name: 'Free' }, usage: {} }));
        if (url.endsWith('/integration-connections')) return new Response(JSON.stringify([]));
        return new Response(JSON.stringify([]));
      }),
    );
    const { container, root } = await mount('general');

    expect(container.textContent).toContain('Back to Settings overview');
    expect(
      container.querySelector('a[href="/dashboard/t?propertyId=p&section=settings"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain('Hotel identity');
    expect(container.textContent).not.toContain('Email branding');
    expect(container.textContent).not.toContain('Payment methods');
    expect(container.textContent).not.toContain('Booking rules');

    await act(async () => root.unmount());
  });

  it('renders Booking rules and Booking mode together in the booking-rules sub-view', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/properties')) return new Response(JSON.stringify([property]));
        if (url.endsWith('/plan-usage'))
          return new Response(JSON.stringify({ plan: { name: 'Free' }, usage: {} }));
        if (url.endsWith('/integration-connections')) return new Response(JSON.stringify([]));
        return new Response(JSON.stringify([]));
      }),
    );
    const { container, root } = await mount('booking-rules');

    expect(container.textContent).toContain('Booking rules');
    expect(container.textContent).toContain('Booking mode');
    expect(container.textContent).toContain('Save booking rules');
    expect(container.textContent).toContain('Save booking mode');
    expect(container.textContent).not.toContain('Hotel identity');
    expect(container.textContent).not.toContain('Payment methods');

    await act(async () => root.unmount());
  });

  it.each([
    ['payments', 'Payment methods', 'Email branding'],
    ['branding', 'Email branding', 'Payment methods'],
  ] as const)(
    'renders the %s Settings sub-view',
    async (settingsArea, visiblePanel, hiddenPanel) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (url.endsWith('/properties')) return new Response(JSON.stringify([property]));
          if (url.endsWith('/plan-usage'))
            return new Response(JSON.stringify({ plan: { name: 'Free' }, usage: {} }));
          if (url.endsWith('/integration-connections')) return new Response(JSON.stringify([]));
          return new Response(JSON.stringify([]));
        }),
      );
      const { container, root } = await mount(settingsArea);

      expect(container.textContent).toContain(visiblePanel);
      expect(container.textContent).not.toContain(hiddenPanel);
      expect(container.textContent).toContain('Back to Settings overview');
      if (settingsArea === 'payments') {
        expect(container.textContent).toContain('Open payment operations');
        expect(
          container.querySelector('a[href="/dashboard/t?propertyId=p&section=payments"]'),
        ).not.toBeNull();
      }

      await act(async () => root.unmount());
    },
  );

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

  it('keeps the WordPress connection controls in the managed-pages sub-view', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/properties')) return new Response(JSON.stringify([property]));
        if (url.endsWith('/plan-usage'))
          return new Response(JSON.stringify({ plan: { name: 'Free' }, usage: {} }));
        if (url.endsWith('/integration-connections')) return new Response(JSON.stringify([]));
        return new Response(JSON.stringify([]));
      }),
    );
    const { container, root } = await mount('managed-pages');

    expect(container.textContent).toContain('Connect WordPress site');
    expect(container.textContent).toContain('Public website origin');
    expect(container.textContent).toContain('Generate connection code');
    expect(container.textContent).not.toContain('Hotel identity');
    expect(container.textContent).not.toContain('Payment methods');
    expect(container.textContent).toContain('Back to Settings overview');

    await act(async () => root.unmount());
  });

  it('renders the billing sub-view as a future platform-billing stub', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/properties')) return new Response(JSON.stringify([property]));
        if (url.endsWith('/plan-usage'))
          return new Response(JSON.stringify({ plan: { name: 'Free' }, usage: {} }));
        if (url.endsWith('/integration-connections')) return new Response(JSON.stringify([]));
        return new Response(JSON.stringify([]));
      }),
    );
    const { container, root } = await mount('billing');

    expect(container.textContent).toContain('Billing account');
    expect(container.textContent).toContain('Current plan: Free');
    expect(container.textContent).toContain('Platform billing is not available yet');
    expect(container.textContent).not.toContain('Milestone 13');
    expect(container.textContent).not.toContain('Payment methods');
    expect(container.textContent).toContain('Back to Settings overview');

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
    expect(container.textContent).not.toContain('Manage properties');
    expect(container.textContent).not.toContain('Add property');
    expect(container.querySelector('button[disabled]')?.textContent).toContain(
      'Platform billing is not available yet',
    );

    await value(container.querySelector('[aria-label="Hotel name"]')!, 'Grand Hotel Tirana');
    await submit(container, 'Save hotel identity');
    const identityRequest = fetch.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(JSON.parse(identityRequest[1]!.body as string)).toEqual({ name: 'Grand Hotel Tirana' });
    expect((container.querySelector('[aria-label="Hotel name"]') as HTMLInputElement).value).toBe(
      'Grand Hotel Tirana',
    );

    await value(
      container.querySelector('[aria-label="Logo URL"]')!,
      'https://example.test/logo.png',
    );
    await value(container.querySelector('[aria-label="Support email"]')!, 'stay@example.test');
    await value(container.querySelector('[aria-label="Hotel phone"]')!, '+355 69 123 4567');
    await submit(container, 'Save email branding');
    const brandingRequest = fetch.mock.calls.filter(([, init]) => init?.method === 'PATCH')[1];
    expect(JSON.parse(brandingRequest[1]!.body as string)).toEqual({
      logoUrl: 'https://example.test/logo.png',
      supportEmail: 'stay@example.test',
      phone: '+355 69 123 4567',
    });

    await value(container.querySelector('[aria-label="Minimum stay (nights)"]')!, '3');
    await submit(container, 'Save booking rules');
    const patchCalls = fetch.mock.calls.filter(([, init]) => init?.method === 'PATCH');
    expect(JSON.parse(patchCalls[2][1]!.body as string)).toEqual({ minStayNights: 3 });

    await value(container.querySelector('[aria-label="Room rules"]')!, 'Adults only.');
    await submit(container, 'Save booking rules');
    const rulesRequest = fetch.mock.calls.filter(([, init]) => init?.method === 'PATCH')[3];
    expect(JSON.parse(rulesRequest[1]!.body as string)).toEqual({ rules: 'Adults only.' });

    await select(container.querySelector('[aria-label="Booking mode"]')!, 'INDIVIDUAL_ROOM_ONLY');
    await submit(container, 'Save booking mode');
    const bookingModeRequest = fetch.mock.calls.filter(([, init]) => init?.method === 'PATCH')[4];
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
    expect(
      fetch.mock.calls.some(
        ([url, init]) => init?.method === 'POST' && url.endsWith('/wordpress-pairing'),
      ),
    ).toBe(true);
    expect(
      (container.querySelector('[aria-label="Connection code"]') as HTMLInputElement).value,
    ).toBe('MUST-GRANDHOTEL-ABCD-1234');
    expect(container.textContent).toContain('Expires in 30 minutes');

    await act(async () => root.unmount());
  });

  it('warns when an enabled online payment method lacks a connected property integration', async () => {
    property = {
      ...property,
      paymentGateways: { stripe: false, pokpay: true, payAtHotel: true },
    };
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/properties')) return new Response(JSON.stringify([property]));
      if (url.endsWith('/plan-usage'))
        return new Response(
          JSON.stringify({ plan: { name: 'Free', maxProperties: 3 }, usage: { properties: 1 } }),
        );
      if (url.endsWith('/properties/p/integration-connections'))
        return new Response(JSON.stringify([{ connectionId: 'pokpay-failed', enabled: true }]));
      if (url.endsWith('/integration-connections'))
        return new Response(
          JSON.stringify([
            { id: 'pokpay-failed', kind: 'PAYMENT', provider: 'POKPAY', status: 'FAILED' },
          ]),
        );
      return new Response('{}');
    });
    vi.stubGlobal('fetch', fetch);
    const { container, root } = await mount();

    expect(container.textContent).toContain(
      'PokPay is enabled but not connected and assigned to this property.',
    );
    await act(async () => root.unmount());
  });
});

async function mount(settingsArea?: SettingsArea) {
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(DashboardSettings, { tenantId: 't', propertyId: 'p', settingsArea }),
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
