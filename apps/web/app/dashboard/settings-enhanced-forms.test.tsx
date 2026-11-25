// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { it, expect, vi } from 'vitest';
import { PaymentSettings, BrandingSettings } from './settings-connection-forms';
import type { Property } from './settings-areas';
import { AppShell } from '../../components/app-shell';
import { HotelBrand } from '../../components/ui/hotel-brand';
import { PokpayConnectionPanel } from '../../components/ui/pokpay-connection-panel';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const property: Property = {
  id: 'p',
  name: 'Hotel Ada',
  address: 'A',
  timezone: 'Europe/Tirane',
  logoUrl: null,
  supportEmail: null,
  phone: null,
  minStayNights: null,
  maxStayNights: null,
  checkInTime: null,
  checkOutTime: null,
  rules: null,
  advanceBookingDays: null,
  freeCancellationDaysBeforeArrival: 1,
  bookingMode: 'ROOM_TYPE_ONLY',
  paymentGateways: { stripe: true, pokpay: false, payAtHotel: true },
  wordpressConnectedAt: null,
  publicWebsiteOrigin: null,
};
const click = async (text: string) =>
  act(async () => {
    [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent === text)!
      .click();
  });
async function value(id: string, text: string) {
  await act(async () => {
    const e = document.querySelector<HTMLInputElement>('#' + id)!;
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), 'value')!.set!.call(e, text);
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function mount(node: React.ReactNode) {
  const host = document.body.appendChild(document.createElement('div')),
    root = createRoot(host),
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>),
  );
  return {
    root,
    client,
    close: async () => {
      await act(async () => root.unmount());
      client.clear();
      host.remove();
      vi.unstubAllGlobals();
    },
  };
}
it('shows the three payment methods, validates hold bounds and saves the settings, including the Stripe switch and the fee setting', async () => {
  const save = vi.fn(),
    props = {
      tenantId: 't',
      property,
      saving: false,
      canWrite: true,
      connectedProviders: new Set<string>(),
      operationsHref: '#',
      onPropertySave: save,
    };
  const m = await mount(<PaymentSettings {...props} />);
  try {
    expect(document.querySelector('#payment-stripe')).not.toBeNull();
    expect(document.body.textContent).toContain('PokPay');
    expect(document.body.textContent).toContain('A guest who cancels pays the payment fee');
    // With Stripe, PokPay and pay-at-hotel all off there is no way to book online: the form says so.
    for (const id of ['payment-payAtHotel', 'payment-stripe'])
      await act(async () => {
        (document.querySelector(`#${id}`) as HTMLButtonElement).click();
      });
    expect(document.body.textContent).toContain('Keep at least one');
    for (const id of ['payment-pokpay', 'payment-stripe'])
      await act(async () => {
        (document.querySelector(`#${id}`) as HTMLButtonElement).click();
      });
    await value('payment-hold', '4');
    expect(document.body.textContent).toContain('between 5 and 1440');
    await value('payment-hold', '45');
    await click('Save changes');
    expect(save).toHaveBeenCalledWith(
      {
        onlinePaymentHoldMinutes: 45,
        autoRefundOnFreeCancellation: true,
        deductPaymentFeeOnGuestRefund: true,
      },
      { stripe: true, pokpay: true, payAtHotel: false },
    );
    await act(async () => m.root.render(<PaymentSettings {...props} canWrite={false} />));
    expect(
      [...document.querySelectorAll('button')].some((b) => b.textContent === 'Save changes'),
    ).toBe(false);
    expect(document.body.textContent).not.toContain('Save credentials');
  } finally {
    await m.close();
  }
});
const byLabel = (label: string) =>
  document.querySelector<HTMLElement>(`[aria-label="${label}"]`) as HTMLButtonElement;
it('orders the checkout methods, picks the default, asks what is accepted at the hotel and checks the link timing', async () => {
  const save = vi.fn(),
    props = {
      tenantId: 't',
      property: { ...property, paymentGateways: { stripe: true, pokpay: true, payAtHotel: true } },
      saving: false,
      canWrite: true,
      connectedProviders: new Set<string>(['STRIPE', 'POKPAY']),
      operationsHref: '#',
      onPropertySave: save,
    };
  const m = await mount(<PaymentSettings {...props} />);
  try {
    // Bank transfer is its own section now, not a "Soon" row.
    expect(document.body.textContent).toContain(
      'Bank transfer is set up in its own section below.',
    );
    expect(document.body.textContent).not.toContain('Soon');
    expect(byLabel('Move Stripe up').disabled).toBe(true);
    expect(byLabel('Move Pay at the hotel down').disabled).toBe(true);
    await act(async () => byLabel('Move PokPay up').click());
    await act(async () => byLabel('Make Stripe the default').click());
    // Nothing is accepted at the hotel yet, but a hotel that never chose can still save other changes.
    expect(document.body.textContent).not.toContain('Choose at least one way');
    await act(async () => byLabel('Accepted at the hotel').querySelectorAll('button')[0]!.click());
    await act(async () => byLabel('Accepted at the hotel').querySelectorAll('button')[1]!.click());
    await value('payment-link-days', '2');
    await value('payment-second-reminder', '5');
    expect(document.body.textContent).toContain('before the link expires');
    expect(
      [...document.querySelectorAll('button')].some((b) => b.textContent === 'Save changes'),
    ).toBe(true);
    await value('payment-link-days', '99');
    expect(document.body.textContent).toContain('from 1 to 14');
    await value('payment-link-days', '10');
    await click('Save changes');
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentMethodOrder: ['pokpay', 'stripe', 'pay_at_hotel'],
        paymentDefaultMethod: 'stripe',
        acceptedAtHotel: ['cash', 'visa'],
        paymentLinkValidDays: 10,
        paymentSecondReminderDays: 5,
      }),
      { stripe: true, pokpay: true, payAtHotel: true },
    );
  } finally {
    await m.close();
  }
});
it('does not block a hotel that never chose what it accepts from saving another change, and asks when it switches Pay at the hotel on', async () => {
  const save = vi.fn(),
    props = {
      tenantId: 't',
      property: {
        ...property,
        paymentGateways: { stripe: true, pokpay: false, payAtHotel: false },
      },
      saving: false,
      canWrite: true,
      connectedProviders: new Set<string>(['STRIPE']),
      operationsHref: '#',
      onPropertySave: save,
    };
  const m = await mount(<PaymentSettings {...props} />);
  try {
    await value('payment-hold', '45');
    await click('Save changes');
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => {
      (document.querySelector('#payment-payAtHotel') as HTMLButtonElement).click();
    });
    expect(document.body.textContent).toContain(
      'Choose at least one way guests can pay at the hotel',
    );
    await act(async () => byLabel('Accepted at the hotel').querySelectorAll('button')[0]!.click());
    expect(document.body.textContent).not.toContain('Choose at least one way');
  } finally {
    await m.close();
  }
});
it('shows whether the PokPay account in use is test or live and sends key changes to Integrations', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const manageHref = '/dashboard/t?propertyId=p&section=settings&settingsArea=integrations';
  const m = await mount(
    <PokpayConnectionPanel
      connection={{ id: 'live', status: 'CONNECTED', mode: 'LIVE' }}
      assigned
      manageHref={manageHref}
    />,
  );
  try {
    expect(document.body.textContent).toContain('Live');
    expect(document.body.textContent).toContain('Live account: guests pay real money.');
    expect(document.body.textContent).not.toContain('not supported');
    expect(document.querySelector('a')?.getAttribute('href')).toBe(manageHref);
    // Keys are never typed here: Integrations is the one place that handles them.
    expect(document.querySelector('input')).toBeNull();

    await act(async () =>
      m.root.render(
        <PokpayConnectionPanel
          connection={{ id: 'test', status: 'CONNECTED', mode: 'TEST' }}
          assigned
        />,
      ),
    );
    expect(document.body.textContent).toContain('Test account: card payments are test payments');
    expect(document.querySelector('a')).toBeNull();
    expect(document.querySelector('button')).toBeNull();

    await act(async () => m.root.render(<PokpayConnectionPanel assigned={false} />));
    expect(document.body.textContent).toContain('No PokPay account is switched on');
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    await m.close();
  }
});
it('selects an https library logo, guards uploads and previews and validates draft branding', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            { id: 'logo', url: 'https://photos.test/logo.png', originalName: 'hotel.png' },
          ]),
        ),
    ),
  );
  const save = vi.fn(),
    m = await mount(
      <BrandingSettings
        tenantId="t"
        property={property}
        canWrite
        canManagePhotos
        saving={false}
        onSave={save}
      />,
    );
  try {
    expect(document.querySelector('#branding-logoUrl')).toBeNull();
    await click('Choose logo');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[aria-label*="hotel.png"]')!.click();
    });
    await click('Use this logo');
    await value('branding-brandColour', 'red');
    expect(document.body.textContent).toContain('Enter a colour such as');
    await value('branding-brandColour', '#cc1122');
    await value('branding-emailFooterText', 'Welcome to Ada');
    await value('branding-supportEmail', 'hello@hotel.test');
    await click('Save changes');
    expect(save).toHaveBeenCalledWith({
      logoUrl: 'https://photos.test/logo.png',
      brandColour: '#cc1122',
      emailFooterText: 'Welcome to Ada',
      supportEmail: 'hello@hotel.test',
    });
    // The live preview shows the logo, the note and the brand colour as they are typed.
    expect(document.querySelector('img[src="https://photos.test/logo.png"]')).not.toBeNull();
    expect(document.body.textContent).toContain('Welcome to Ada');
    expect(document.body.textContent).toContain('14 / 300');
    expect(document.querySelector('input[type=color]')).not.toBeNull();
    const button = () =>
      [...document.querySelectorAll<HTMLElement>('span[style]')].find(
        (span) => span.textContent === 'View booking',
      )!;
    expect(button().style.backgroundColor).toBe('rgb(204, 17, 34)');
    await value('branding-brandColour-picker', '#005577');
    expect((document.querySelector('#branding-brandColour') as HTMLInputElement).value).toBe(
      '#005577',
    );
    expect(button().style.backgroundColor).toBe('rgb(0, 85, 119)');
  } finally {
    await m.close();
  }
});

it('keeps the MUST mark beside the hotel name and contains a supplied logo', async () => {
  const m = await mount(<HotelBrand name="Hotel Ada" />);
  try {
    expect(document.querySelector('svg')).not.toBeNull();
    expect(document.body.textContent).toContain('Hotel Ada');
    await act(async () =>
      m.root.render(<HotelBrand name="Hotel Ada" logoUrl="https://photos.test/logo.png" />),
    );
    const logo = document.querySelector('img')!;
    expect(logo.alt).toBe('Hotel Ada');
    expect(logo.className).toContain('object-contain');
    expect(document.querySelector('svg')).toBeNull();
  } finally {
    await m.close();
  }
});

it.each(['MUST Local Demo Hotel', 'MUST Local Demo Hotel With Forty Letters'])(
  'keeps the full sidebar name accessible through collapse and expand: %s',
  async (name) => {
    const m = await mount(
      <AppShell navigation={[]} title="Hotels" hotelBrand={{ name }}>
        Hotels
      </AppShell>,
    );
    const sidebar = document.querySelector('aside')!;
    expect(sidebar.querySelector('[title]')?.getAttribute('title')).toBe(name);
    const toggle = sidebar.querySelector<HTMLButtonElement>('[aria-label="Collapse sidebar"]')!;
    await act(async () => toggle.click());
    expect(sidebar.querySelector('[title]')).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await act(async () => toggle.click());
    expect(sidebar.querySelector('[title]')?.textContent).toBe(name);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await m.close();
  },
);
