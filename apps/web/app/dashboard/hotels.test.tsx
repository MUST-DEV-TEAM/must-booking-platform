// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import {
  HotelDirectory,
  hotelReadiness,
  type DirectoryHotel,
} from '../../components/ui/hotel-directory';
import { HotelsSection } from './hotels';
import { DashboardQueryProvider } from './query-provider';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView = vi.fn();
const local: DirectoryHotel = {
  id: 'local',
  name: 'Ada Hotel',
  address: 'Tirana, Main street',
  timezone: 'Europe/Tirane',
  logoUrl: null,
  supportEmail: null,
  phone: null,
  minStayNights: null,
  maxStayNights: null,
  advanceBookingDays: null,
  checkInTime: '15:00',
  checkOutTime: '11:00',
  rules: null,
  freeCancellationDaysBeforeArrival: 1,
  bookingMode: 'ROOM_TYPE_ONLY',
  paymentGateways: { stripe: false, pokpay: false, payAtHotel: true },
  wordpressConnectedAt: '2026-10-20T12:00:00Z',
  publicWebsiteOrigin: 'https://hotel.test',
  staffCount: 3,
  pmsSource: 'MUST',
  connectedProviders: [],
};
const clock: DirectoryHotel = {
  ...local,
  id: 'clock',
  name: 'Beach Hotel',
  address: 'Vlore, Coast road',
  pmsSource: 'CLOCK_PMS',
  connectedProviders: ['CLOCK_PMS', 'POKPAY'],
  paymentGateways: { stripe: false, pokpay: true, payAtHotel: false },
  wordpressConnectedAt: null,
};
let root: Root;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  localStorage.clear();
});
async function mount(node: ReactNode) {
  const host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  await act(async () => root.render(<DashboardQueryProvider>{node}</DashboardQueryProvider>));
  await settle();
}
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });
}
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('button')];
async function click(name: string) {
  await act(async () =>
    buttons()
      .find((b) => b.textContent === name || b.getAttribute('aria-label') === name)!
      .click(),
  );
  await settle();
}
async function input(value: string) {
  const e = document.querySelector<HTMLInputElement>('input[type=search]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(e, value);
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const directory = (hotels = [local, clock], extras = {}) => (
  <HotelDirectory
    tenantId="t"
    hotels={hotels}
    onRetry={vi.fn()}
    onCreate={vi.fn()}
    canCreate
    canOpenSettings
    {...extras}
  />
);
it('renders selectable sortable hotels, counted tabs, readiness, density and a quick peek with scoped actions', async () => {
  await mount(directory());
  expect(document.body.textContent).toContain('MUST-source');
  expect(document.body.textContent).toContain('Managed in Clock');
  expect(document.body.textContent).toContain('PokPay connected');
  expect(document.body.textContent).toContain('Pay at hotel only');
  expect([...document.querySelectorAll('[role=tab]')].map((t) => t.textContent)).toEqual([
    'All2',
    'Active1',
    'Needs setup1',
  ]);
  await click('Select Ada Hotel');
  expect(document.body.textContent).toContain('1 hotels selected');
  await click('Clear selection');
  await click('City / address');
  expect(document.querySelector('[aria-sort=ascending]')?.textContent).toContain('City / address');
  await click('Compact rows');
  expect(buttons().find((b) => b.getAttribute('aria-label') === 'Comfortable rows')).toBeTruthy();
  await click('Preview Beach Hotel');
  const dialog = document.querySelector('[role=dialog]')!;
  expect(dialog.textContent).toContain('managed in Clock');
  expect(
    dialog.querySelector('a[href="/dashboard/t?propertyId=clock&section=overview"]'),
  ).not.toBeNull();
  expect(dialog.querySelector('a[href*="settingsArea=managed-pages"]')).not.toBeNull();
});
it('filters by counted views, search and connection and clears no-results', async () => {
  await mount(directory());
  await click('Needs setup1');
  expect(document.querySelector('tbody')?.textContent).not.toContain('Ada Hotel');
  await input('Tirana');
  expect(document.body.textContent).toContain('No results');
  await click('Clear filters');
  await input('ada');
  expect(document.querySelectorAll('tbody tr')).toHaveLength(1);
  await input('');
  await click('Filters');
  await act(async () => {
    document.querySelector<HTMLButtonElement>('[role=combobox][aria-label=Connection]')!.click();
  });
  await settle();
  await act(async () => {
    [...document.querySelectorAll<HTMLElement>('[role=option]')]
      .find((o) => o.textContent === 'Clock')!
      .click();
  });
  await settle();
  expect(document.querySelector('tbody')?.textContent).toContain('Beach Hotel');
  expect(document.querySelector('tbody')?.textContent).not.toContain('Ada Hotel');
});
it('treats missing required times, payments, website or invalid rules as setup, and branding as optional', () => {
  expect(hotelReadiness(local).active).toBe(true);
  expect(hotelReadiness(clock).active).toBe(false);
  expect(hotelReadiness({ ...local, checkInTime: null }).active).toBe(false);
  expect(
    hotelReadiness({
      ...local,
      paymentGateways: { stripe: false, pokpay: true, payAtHotel: false },
    }).active,
  ).toBe(false);
  expect(hotelReadiness({ ...local, minStayNights: 5, maxStayNights: 2 }).active).toBe(false);
});
it('shows an empty state and shared loading/error states with retry', async () => {
  const retry = vi.fn();
  await mount(directory([], { onRetry: retry }));
  expect(document.body.textContent).toContain('No hotels available');
  await act(async () => root.render(directory([], { loading: true })));
  expect(document.querySelector('[aria-busy=true]')).not.toBeNull();
  await act(async () => root.render(directory([], { error: 'Unavailable', onRetry: retry })));
  await click('Try again');
  expect(retry).toHaveBeenCalled();
});
it.each([
  ['STAFF', true, false],
  ['OWNER', false, false],
  ['OWNER', true, true],
  ['ADMIN', false, false],
  ['ADMIN', true, true],
] as const)('gates creation and settings for %s, verified=%s', async (role, verified, create) => {
  const fetch = vi.fn(async () => new Response(JSON.stringify([local])));
  vi.stubGlobal('fetch', fetch);
  await mount(<HotelsSection tenantId="t" role={role} emailVerified={verified} />);
  expect(buttons().some((b) => b.textContent === 'Add hotel')).toBe(create);
  expect(document.body.textContent).not.toContain('Beach Hotel');
  await click('Preview Ada Hotel');
  expect(document.querySelector('a[href*="section=settings"]') !== null).toBe(role !== 'STAFF');
  expect(fetch).toHaveBeenCalledWith('/api/tenants/t/properties', { credentials: 'include' });
});
