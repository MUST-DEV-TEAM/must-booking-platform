// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { DashboardSettings, SettingsOverview } from './settings';
import { resolveSettingsTab, type SettingsTab } from './settings-registry';
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
  it('renders the readiness check with links to the new tabs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/exchange-rates'))
          return Response.json({ base: 'EUR', version: '0', displayCurrencies: null, rates: [] });
        if (url.endsWith('/settings-summary')) {
          const step = (key: string, tab: string, label: string, status: string, note: string) => ({
            key,
            tab,
            label,
            status,
            note,
          });
          return Response.json({
            hotel: property,
            ready: false,
            steps: [
              step(
                'profile',
                'profile',
                'Hotel identity',
                'done',
                'Name, address and time zone are set.',
              ),
              step(
                'booking-rules',
                'booking-rules',
                'Booking rules',
                'done',
                'Stay limits are set.',
              ),
              step(
                'policies',
                'policies',
                'Check-in and check-out times',
                'done',
                'From 15:00 to 11:00.',
              ),
              step(
                'payment-methods',
                'payment-methods',
                'Payment method',
                'done',
                'A method is available.',
              ),
              step(
                'website',
                'integrations',
                'Website connection',
                'todo',
                'The hotel website is not connected yet.',
              ),
            ],
          });
        }
        return new Response(JSON.stringify([]));
      }),
    );
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(
          DashboardQueryProvider,
          undefined,
          createElement(SettingsOverview, {
            tenantId: 't',
            propertyId: 'p',
            property,
            canWrite: true,
          }),
        ),
      );
    });
    for (let i = 0; i < 60 && !container.textContent?.includes('Set up your hotel'); i += 1)
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 30));
      });
    const text = container.textContent ?? '';
    for (const step of [
      'Hotel identity',
      'Booking rules',
      'Check-in and check-out times',
      'Payment method',
      'Website connection',
    ])
      expect(text).toContain(step);
    for (const tab of ['profile', 'booking-rules', 'policies', 'payment-methods', 'integrations'])
      expect(
        container.querySelector(
          `a[href="/dashboard/t?propertyId=p&section=settings&settingsArea=${tab}"]`,
        ),
      ).not.toBeNull();
    expect(container.querySelector('a[href*="settingsArea=general"]')).toBeNull();
    // Real status, not decoration: the demo hotel has no website yet.
    expect(text).toContain('Set up your hotel');
    expect(text).toContain('Settings at a glance');
    expect(text).toContain('Grand Hotel');
    const finder = container.querySelector<HTMLInputElement>('input[aria-label="Find a setting"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        finder,
        'nuis',
      );
      finder.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.textContent).toContain('Legal name and tax number');
    const hide = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Hide for now',
    )!;
    await act(async () => hide.click());
    expect(container.textContent).toContain('Setup: 4 of 5');
    expect(container.textContent).not.toContain('Set up your hotel');
    expect(text).toContain('The hotel website is not connected yet.');
    // Old area names from saved links land on their new tab; unknown and unbuilt ones on the overview.
    expect(resolveSettingsTab('general')).toBe('profile');
    expect(resolveSettingsTab('check-in-out')).toBe('policies');
    expect(resolveSettingsTab('payments')).toBe('payment-methods');
    expect(resolveSettingsTab('managed-pages')).toBe('integrations');
    expect(resolveSettingsTab('billing')).toBe('plan-usage');
    expect(resolveSettingsTab('email')).toBe('emails');
    expect(resolveSettingsTab('booking-mode')).toBe('overview');
    expect(resolveSettingsTab('taxes-fees')).toBe('overview');
    expect(resolveSettingsTab(null)).toBe('overview');
    await act(async () => root.unmount());
    container.remove();
  });

  it('shows only the forms of the selected tab', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/exchange-rates'))
          return Response.json({ base: 'EUR', version: '0', displayCurrencies: null, rates: [] });
        if (url.endsWith('/properties')) return new Response(JSON.stringify([property]));
        if (url.endsWith('/plan-usage'))
          return new Response(JSON.stringify({ plan: { name: 'Free' }, usage: {} }));
        if (url.endsWith('/integration-connections')) return new Response(JSON.stringify([]));
        return new Response(JSON.stringify([]));
      }),
    );
    const { container, root } = await mount('profile');

    expect(container.textContent).toContain('Hotel identity');
    expect(container.textContent).not.toContain('Email branding');
    expect(container.textContent).not.toContain('Payment methods');
    expect(container.textContent).not.toContain('Booking rules');

    await act(async () => root.unmount());
  });

  it('renders the stay limits, cancellation, inventory mode and house rules sections', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/exchange-rates'))
          return Response.json({ base: 'EUR', version: '0', displayCurrencies: null, rates: [] });
        if (url.endsWith('/properties')) return new Response(JSON.stringify([property]));
        if (url.endsWith('/plan-usage'))
          return new Response(JSON.stringify({ plan: { name: 'Free' }, usage: {} }));
        if (url.endsWith('/integration-connections')) return new Response(JSON.stringify([]));
        return new Response(JSON.stringify([]));
      }),
    );
    const { container, root } = await mount('booking-rules');

    for (const section of [
      'Stay limits',
      'Cancellation',
      'Inventory mode',
      'House rules',
      'How online checkout works',
    ])
      expect(container.textContent).toContain(section);
    // Nothing is saved until something changes.
    expect(container.textContent).not.toContain('Save changes');
    expect(container.textContent).not.toContain('Hotel identity');
    expect(container.textContent).not.toContain('Payment methods');

    await act(async () => root.unmount());
  });

  it.each([
    ['payment-methods', 'Payment methods', 'Email branding'],
    ['contact-brand', 'Logo and colour', 'Payment methods'],
  ] as const)(
    'renders the %s Settings sub-view',
    async (settingsArea, visiblePanel, hiddenPanel) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (url.endsWith('/exchange-rates'))
            return Response.json({ base: 'EUR', version: '0', displayCurrencies: null, rates: [] });
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
      if (settingsArea === 'payment-methods') {
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
        (button) => button.textContent === 'Try again',
      ),
    ).toBe(true);
    await act(async () => root.unmount());
  });

  it('keeps the WordPress connection controls in the managed-pages sub-view', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/exchange-rates'))
          return Response.json({ base: 'EUR', version: '0', displayCurrencies: null, rates: [] });
        if (url.endsWith('/properties')) return new Response(JSON.stringify([property]));
        if (url.endsWith('/plan-usage'))
          return new Response(JSON.stringify({ plan: { name: 'Free' }, usage: {} }));
        if (url.endsWith('/integration-connections')) return new Response(JSON.stringify([]));
        return new Response(JSON.stringify([]));
      }),
    );
    const { container, root } = await mount('integrations');

    expect(container.textContent).toContain('Website connection');
    expect(container.textContent).toContain('Public website origin');
    expect(container.textContent).toContain('Generate connection code');
    expect(container.textContent).not.toContain('Hotel identity');
    expect(container.textContent).not.toContain('Payment methods');

    await act(async () => root.unmount());
  });

  it('renders the billing sub-view as a future platform-billing stub', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/exchange-rates'))
          return Response.json({ base: 'EUR', version: '0', displayCurrencies: null, rates: [] });
        if (url.endsWith('/properties')) return new Response(JSON.stringify([property]));
        if (url.endsWith('/plan-usage'))
          return new Response(JSON.stringify({ plan: { name: 'Free' }, usage: {} }));
        if (url.endsWith('/integration-connections')) return new Response(JSON.stringify([]));
        return new Response(JSON.stringify([]));
      }),
    );
    const { container, root } = await mount('plan-usage');

    expect(container.textContent).toContain('Billing account');
    expect(container.textContent).toContain('Current plan: Free');
    expect(container.textContent).toContain('Platform billing is not available yet');
    expect(container.textContent).not.toContain('Milestone 13');
    expect(container.textContent).not.toContain('Payment methods');

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
      if (url.endsWith('/exchange-rates'))
        return Response.json({ base: 'EUR', version: '0', displayCurrencies: null, rates: [] });
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
    expect(container.textContent).toContain('do not block or validate bookings');
    expect(container.textContent).not.toContain('Manage properties');
    expect(container.textContent).not.toContain('Add property');
    expect(
      [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
        button.textContent?.includes('Platform billing is not available yet'),
      )?.disabled,
    ).toBe(true);

    await value(container.querySelector('#hotel-name')!, 'Grand Hotel Tirana');
    await saveChanges(container);
    const identityRequest = fetch.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(JSON.parse(identityRequest[1]!.body as string)).toEqual({ name: 'Grand Hotel Tirana' });
    expect((container.querySelector('#hotel-name') as HTMLInputElement).value).toBe(
      'Grand Hotel Tirana',
    );

    await value(container.querySelector('#branding-supportEmail')!, 'stay@example.test');
    await value(container.querySelector('#branding-phone')!, '691234567');
    await saveChanges(container);
    const brandingRequest = fetch.mock.calls.filter(([, init]) => init?.method === 'PATCH')[1];
    expect(JSON.parse(brandingRequest[1]!.body as string)).toEqual({
      supportEmail: 'stay@example.test',
      phone: '+355691234567',
    });

    await value(container.querySelector('#rules-min')!, '3');
    await saveChanges(container);
    const patchCalls = fetch.mock.calls.filter(([, init]) => init?.method === 'PATCH');
    expect(JSON.parse(patchCalls[2][1]!.body as string)).toEqual({ minStayNights: 3 });

    await value(container.querySelector('#rules-text')!, 'Adults only.');
    await saveChanges(container);
    const rulesRequest = fetch.mock.calls.filter(([, init]) => init?.method === 'PATCH')[3];
    expect(JSON.parse(rulesRequest[1]!.body as string)).toEqual({ rules: 'Adults only.' });

    await value(container.querySelector('#times-in')!, '14:00');
    await saveChanges(container);
    const timesRequest = fetch.mock.calls.filter(([, init]) => init?.method === 'PATCH')[4];
    expect(JSON.parse(timesRequest[1]!.body as string)).toEqual({ checkInTime: '14:00' });

    const pokpayCheckbox = container.querySelector('#payment-pokpay') as HTMLButtonElement;
    await act(async () => {
      pokpayCheckbox.click();
      await Promise.resolve();
    });
    await saveChanges(container);
    const paymentGatewaysRequest = fetch.mock.calls.find(
      ([, init]) => init?.method === 'PATCH' && !!JSON.parse(init.body as string).paymentGateways,
    )!;
    expect(JSON.parse(paymentGatewaysRequest[1]!.body as string)).toEqual({
      paymentGateways: { stripe: false, pokpay: true, payAtHotel: true },
      onlinePaymentHoldMinutes: 30,
      autoRefundOnFreeCancellation: true,
      deductPaymentFeeOnGuestRefund: true,
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
    expect((container.querySelector('#website-code') as HTMLInputElement).value).toBe(
      'MUST-GRANDHOTEL-ABCD-1234',
    );
    expect(container.textContent).toContain('Expires in 30 minutes');

    await act(async () => root.unmount());
  });

  it.each(['payment-methods', 'contact-brand', 'integrations'] as const)(
    'shows %s values without save or pairing actions for a read-only viewer',
    async (area) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async (url: string) =>
            new Response(
              JSON.stringify(
                url.endsWith('/properties')
                  ? [property]
                  : url.endsWith('/plan-usage')
                    ? { plan: { name: 'Free' } }
                    : [],
              ),
            ),
        ),
      );
      const { container, root } = await mount(area, false);
      expect(
        container.querySelectorAll('input:disabled, button[role="switch"]:disabled').length,
      ).toBeGreaterThan(0);
      expect(container.textContent).not.toContain('Save changes');
      expect(container.textContent).not.toContain('Generate connection code');
      await act(async () => root.unmount());
    },
  );

  it('validates branding, previews draft contacts, and guards unsaved navigation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify(
              url.endsWith('/properties')
                ? [property]
                : url.endsWith('/plan-usage')
                  ? { plan: { name: 'Free' } }
                  : [],
            ),
          ),
      ),
    );
    const { container, root } = await mount('contact-brand');
    expect(container.querySelector('[aria-label="Unsaved changes"]')).toBeNull();
    await value(container.querySelector('#branding-supportEmail')!, 'bad-email');
    await value(container.querySelector('#branding-phone')!, '12');
    expect(container.textContent).toContain('Enter an email address');
    expect(container.textContent).toContain('Enter a full phone number');
    expect(
      Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent === 'Save changes',
      )!.disabled,
    ).toBe(true);
    expect(container.textContent).toContain('bad-email | +355 12');
    const before = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(true);
    await act(async () =>
      Array.from(container.querySelectorAll('button'))
        .find((b) => b.textContent === 'Discard')!
        .click(),
    );
    expect(container.querySelector('[aria-label="Unsaved changes"]')).toBeNull();
    await act(async () => root.unmount());
  });

  it('asks for the WhatsApp number and reception hours only when they differ', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify(
              url.endsWith('/properties')
                ? [property]
                : url.endsWith('/plan-usage')
                  ? { plan: { name: 'Free' } }
                  : [],
            ),
          ),
      ),
    );
    const { container, root } = await mount('contact-brand');
    expect(container.querySelector('#branding-whatsappNumber')).toBeNull();
    const save = () =>
      Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent === 'Save changes',
      );
    await act(async () =>
      (container.querySelector('#branding-whatsappSameAsPhone') as HTMLButtonElement).click(),
    );
    expect(container.querySelector('#branding-whatsappNumber')).not.toBeNull();
    expect(container.textContent).toContain('Enter the WhatsApp number');
    expect(save()!.disabled).toBe(true);
    await value(container.querySelector('#branding-whatsappNumber')!, '691234567');
    expect(save()!.disabled).toBe(false);
    await act(async () =>
      (container.querySelector('#branding-receptionOpen24h') as HTMLButtonElement).click(),
    );
    expect(container.textContent).toContain('Enter the opening time');
    expect(save()!.disabled).toBe(true);
    await act(async () => root.unmount());
  });

  it('checks online profiles against their site and warns about low-contrast colours', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify(
              url.endsWith('/properties')
                ? [property]
                : url.endsWith('/plan-usage')
                  ? { plan: { name: 'Free' } }
                  : [],
            ),
          ),
      ),
    );
    const { container, root } = await mount('contact-brand');
    const save = () =>
      Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent === 'Save changes',
      );
    await value(container.querySelector('#branding-profile-facebook')!, 'https://evil.com/x');
    expect(container.textContent).toContain('not a Facebook address');
    expect(save()!.disabled).toBe(true);
    await value(
      container.querySelector('#branding-profile-facebook')!,
      'https://facebook.com/demo',
    );
    expect(save()!.disabled).toBe(false);
    await value(container.querySelector('#branding-accentColour')!, '#ffee00');
    expect(container.textContent).toContain('White text is hard to read on the accent colour');
    await act(async () => root.unmount());
  });

  it('refuses all payment methods off and discards the draft', async () => {
    property = { ...property, paymentGateways: { payAtHotel: true, stripe: false, pokpay: false } };
    const fetch = vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.endsWith('/properties')
              ? [property]
              : url.endsWith('/plan-usage')
                ? { plan: { name: 'Free' } }
                : [],
          ),
        ),
    );
    vi.stubGlobal('fetch', fetch);
    const { container, root } = await mount('payment-methods');
    await act(async () =>
      (container.querySelector('#payment-payAtHotel') as HTMLButtonElement).click(),
    );
    expect(container.textContent).toContain('so guests can complete an online booking');
    expect(
      Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent === 'Save changes',
      )!.disabled,
    ).toBe(true);
    expect(fetch.mock.calls.some(([url]) => url.endsWith('/payment-gateways'))).toBe(false);
    await act(async () =>
      Array.from(container.querySelectorAll('button'))
        .find((b) => b.textContent === 'Discard')!
        .click(),
    );
    expect(container.querySelector('#payment-payAtHotel')?.getAttribute('aria-checked')).toBe(
      'true',
    );
    await act(async () => root.unmount());
  });

  it('validates and saves the website origin in Clock mode without changing pairing', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        property = { ...property, ...JSON.parse(init.body as string) };
        // Existing update responses omit wordpressConnectedAt.
        const response: Record<string, unknown> = { ...property };
        delete response.wordpressConnectedAt;
        return new Response(JSON.stringify(response));
      }
      if (url.endsWith('/exchange-rates'))
        return Response.json({ base: 'EUR', version: '0', displayCurrencies: null, rates: [] });
      if (url.endsWith('/properties')) return new Response(JSON.stringify([property]));
      if (url.endsWith('/properties/p/integration-connections'))
        return new Response(JSON.stringify([{ connectionId: 'clock', enabled: true }]));
      if (url.endsWith('/integration-connections'))
        return new Response(
          JSON.stringify([{ id: 'clock', provider: 'CLOCK_PMS', status: 'CONNECTED' }]),
        );
      return new Response(JSON.stringify({ plan: { name: 'Free' } }));
    });
    property = { ...property, wordpressConnectedAt: '2026-10-01T12:00:00Z' };
    vi.stubGlobal('fetch', fetch);
    const { container, root } = await mount('integrations');
    expect(container.textContent).toContain('managed in Clock');
    await value(container.querySelector('#website-origin')!, 'https://hotel.test/path');
    expect(container.textContent).toContain('without a path');
    expect(
      Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent === 'Save changes',
      )!.disabled,
    ).toBe(true);
    await value(container.querySelector('#website-origin')!, 'https://hotel.test');
    await saveChanges(container);
    const patch = fetch.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(patch[0]).toContain('/public-website-origin');
    expect(JSON.parse(patch[1]!.body as string)).toEqual({
      publicWebsiteOrigin: 'https://hotel.test',
    });
    expect(container.textContent).toContain('WordPress paired');
    expect(container.querySelector('[aria-label="Unsaved changes"]')).toBeNull();
    await act(async () => root.unmount());
  });

  it('preserves provider state and invalidates saved readiness immediately after branding save', async () => {
    const connection = { id: 'stripe', kind: 'PAYMENT', provider: 'STRIPE', status: 'CONNECTED' };
    const assignment = { connectionId: 'stripe', enabled: true };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const hubKey = ['dashboard', 'settings-hub', 't', 'p'];
    client.setQueryData(hubKey, { property });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'PATCH')
          return new Response(JSON.stringify({ ...property, ...JSON.parse(init.body as string) }));
        if (url.endsWith('/exchange-rates'))
          return Response.json({ base: 'EUR', version: '0', displayCurrencies: null, rates: [] });
        if (url.endsWith('/properties')) return new Response(JSON.stringify([property]));
        if (url.endsWith('/plan-usage'))
          return new Response(JSON.stringify({ plan: { name: 'Free' } }));
        return new Response(
          JSON.stringify(url.includes('/properties/p/') ? [assignment] : [connection]),
        );
      }),
    );
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(DashboardSettings, {
            tenantId: 't',
            propertyId: 'p',
            settingsArea: 'contact-brand',
            canWrite: true,
          }),
        ),
      ),
    );
    for (let i = 0; i < 8; i++)
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 20));
      });
    await value(container.querySelector('#branding-supportEmail')!, 'new@hotel.test');
    await saveChanges(container);
    const cached = client.getQueryData<{
      connections: unknown[];
      propertyConnections: unknown[];
      property: { supportEmail: string };
    }>(['dashboard', 'settings', 't', 'p'])!;
    expect(cached.connections).toEqual([connection]);
    expect(cached.propertyConnections).toEqual([assignment]);
    expect(cached.property.supportEmail).toBe('new@hotel.test');
    expect(client.getQueryState(hubKey)?.isInvalidated).toBe(true);
    await act(async () => root.unmount());
    client.clear();
  });

  it('warns when an enabled online payment method lacks a connected property integration', async () => {
    property = {
      ...property,
      paymentGateways: { stripe: false, pokpay: true, payAtHotel: true },
    };
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/exchange-rates'))
        return Response.json({ base: 'EUR', version: '0', displayCurrencies: null, rates: [] });
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

    expect(container.textContent).toContain('Not connected - unavailable to guests');
    await act(async () => root.unmount());
  });
});

async function mount(settingsArea?: SettingsTab, canWrite = true) {
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(DashboardSettings, {
          tenantId: 't',
          propertyId: 'p',
          settingsArea,
          canWrite,
        }),
      ),
    );
  });
  // Wait for the page to settle rather than for a fixed time: a busy machine (a full parallel run) can take
  // far longer than 160ms to resolve the mocked requests. Settled = no "Loading" text and the same content
  // for several consecutive ticks, with a hard cap so a genuine hang still fails loudly.
  let previous = '';
  let stable = 0;
  for (let iteration = 0; iteration < 250 && stable < 4; iteration += 1) {
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
      await Promise.resolve();
    });
    const html = container.innerHTML;
    stable = html === previous && !/Loading/.test(container.textContent ?? '') ? stable + 1 : 0;
    previous = html;
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

async function saveChanges(container: HTMLElement) {
  await act(async () => {
    Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Save changes')!
      .click();
    for (let iteration = 0; iteration < 4; iteration += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
      await Promise.resolve();
    }
  });
}
