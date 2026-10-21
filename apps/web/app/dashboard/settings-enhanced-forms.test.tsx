// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { it, expect, vi } from 'vitest';
import { PaymentSettings, BrandingSettings } from './settings-connection-forms';
import type { Property } from './settings-areas';
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
it('shows only the two hotel methods, validates hold bounds and saves settings with the existing Stripe flag preserved', async () => {
  const save = vi.fn(),
    props = {
      tenantId: 't',
      property,
      saving: false,
      canWrite: true,
      connectedProviders: new Set<string>(),
      operationsHref: '#',
      onPropertySave: save,
      onConnectionChanged: vi.fn(async () => {}),
    };
  const m = await mount(<PaymentSettings {...props} />);
  try {
    expect(document.querySelector('#payment-stripe')).toBeNull();
    expect(document.body.textContent).toContain('Pay online in full');
    await act(async () => {
      (document.querySelector('#payment-payAtHotel') as HTMLButtonElement).click();
    });
    expect(document.body.textContent).toContain('Keep at least one');
    await act(async () => {
      (document.querySelector('#payment-pokpay') as HTMLButtonElement).click();
    });
    await value('payment-hold', '9');
    expect(document.body.textContent).toContain('between 10 and 1440');
    await value('payment-hold', '45');
    await click('Save changes');
    expect(save).toHaveBeenCalledWith(
      { onlinePaymentHoldMinutes: 45, autoRefundOnFreeCancellation: true },
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
it('keeps PokPay credentials write-only, tests via the existing endpoint and assigns the tested account', async () => {
  const fetch = vi.fn(
    async (url: string, init?: RequestInit) =>
      new Response(
        JSON.stringify(
          url.endsWith('/test')
            ? { id: 'new', status: 'CONNECTED' }
            : init?.method === 'POST'
              ? { id: 'new', status: 'PENDING' }
              : {},
        ),
      ),
  );
  vi.stubGlobal('fetch', fetch);
  const changed = vi.fn(async () => {}),
    m = await mount(
      <PokpayConnectionPanel
        tenantId="t"
        propertyId="p"
        assigned={false}
        canManage
        onChanged={changed}
      />,
    );
  try {
    await value('pokpay-keyId', 'key');
    await value('pokpay-merchantId', 'merchant');
    await value('pokpay-keySecret', 'private-fixture-secret');
    await click('Save credentials');
    expect((document.querySelector('#pokpay-keySecret') as HTMLInputElement).value).toBe('');
    expect(document.body.textContent).toContain('Credentials: Saved');
    expect(document.querySelector('#pokpay-keySecret')?.getAttribute('type')).toBe('password');
    expect(document.body.textContent).not.toContain('private-fixture-secret');
    await click('Test connection');
    expect(document.querySelector('#pokpay-keySecret')).toBeNull();
    await click('Replace credentials');
    expect((document.querySelector('#pokpay-keySecret') as HTMLInputElement).value).toBe('');
    await click('Cancel');
    await click('Assign to this hotel');
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/tenants/t/integration-connections',
      '/api/tenants/t/integration-connections/new/test',
      '/api/tenants/t/properties/p/integration-connections/new',
    ]);
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string).credentials).toMatchObject({
      keyId: 'key',
      merchantId: 'merchant',
      keySecret: 'private-fixture-secret',
    });
    await act(async () =>
      m.root.render(
        <PokpayConnectionPanel
          key="readonly"
          tenantId="t"
          propertyId="p"
          connection={{ id: 'new', status: 'CONNECTED' }}
          assigned
          canManage={false}
          onChanged={changed}
        />,
      ),
    );
    expect(document.body.textContent).toContain('Connected');
    expect(document.querySelector('input')).toBeNull();
    expect(document.querySelector('button')).toBeNull();
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
    const upload = document.querySelector<HTMLInputElement>('#logo-upload')!;
    Object.defineProperty(upload, 'files', {
      configurable: true,
      value: [new File(['x'], 'bad.svg', { type: 'image/svg+xml' })],
    });
    await act(async () => upload.dispatchEvent(new Event('change', { bubbles: true })));
    expect(document.body.textContent).toContain('Choose JPG, PNG, or WebP');
    await click('hotel.png');
    await value('branding-brandColour', 'red');
    expect(document.body.textContent).toContain('Enter a colour such as');
    await value('branding-brandColour', '#cc1122');
    await value('branding-emailFooterText', 'Welcome to Ada');
    await value('branding-supportEmail', 'hello@hotel.test');
    await value('branding-termsUrl', 'http://hotel.test/terms');
    expect(document.body.textContent).toContain('full https terms');
    await value('branding-termsUrl', 'https://hotel.test/terms');
    await click('Save changes');
    expect(save).toHaveBeenCalledWith({
      logoUrl: 'https://photos.test/logo.png',
      brandColour: '#cc1122',
      emailFooterText: 'Welcome to Ada',
      supportEmail: 'hello@hotel.test',
      termsUrl: 'https://hotel.test/terms',
    });
    expect(document.querySelector('img[alt="Hotel Ada logo"]')).not.toBeNull();
    expect(document.body.textContent).toContain('Welcome to Ada');
    expect(document.body.textContent).toContain('14/300 characters');
    expect(document.querySelector('input[type=color]')).not.toBeNull();
    expect((document.querySelector('a[style]') as HTMLElement).style.color).toBe(
      'rgb(204, 17, 34)',
    );
    expect((document.querySelector('span[style]') as HTMLElement).style.backgroundColor).toBe(
      'rgb(204, 17, 34)',
    );
    await value('branding-brandColour-picker', '#005577');
    expect((document.querySelector('#branding-brandColour') as HTMLInputElement).value).toBe(
      '#005577',
    );
    expect((document.querySelector('a[style]') as HTMLElement).style.color).toBe('rgb(0, 85, 119)');
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
