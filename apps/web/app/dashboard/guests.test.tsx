// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardGuests } from './guests';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const base = '/api/tenants/t/properties/p';
const guests = [
  {
    id: 'guest-1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@test',
    phone: null,
    bookingCount: 2,
    mostRecentStartsOn: '2026-08-10',
    mostRecentEndsOn: '2026-08-12',
  },
  {
    id: 'guest-2',
    firstName: 'No',
    lastName: 'History',
    email: 'none@test',
    phone: null,
    bookingCount: 1,
    mostRecentStartsOn: '2026-08-14',
    mostRecentEndsOn: '2026-08-15',
  },
];
const bookings = [
  {
    id: 'booking-1',
    guestId: 'guest-1',
    guestEmail: 'ada@test',
    roomTypeName: 'Deluxe',
    startsOn: '2026-08-10',
    endsOn: '2026-08-12',
  },
];
afterEach(() => vi.unstubAllGlobals());
describe('Dashboard guests', () => {
  it('renders fetched guest data and filters selected guest history by guest id', async () => {
    mockFetch();
    const { c, r } = await mount();
    expect(c.textContent).toContain('Ada Lovelace');
    expect(c.textContent).toContain('ada@test');
    expect(c.textContent).toContain('2 bookings');
    await act(async () => {
      Array.from(c.querySelectorAll('button'))
        .find((x) => x.textContent === 'Ada Lovelace')!
        .click();
    });
    expect(c.textContent).toContain('booking history');
    expect(c.textContent).toContain('Deluxe');
    await act(async () => r.unmount());
  });
  it('shows no bookings found when the selected guest has no matching history', async () => {
    mockFetch();
    const { c, r } = await mount();
    await act(async () => {
      Array.from(c.querySelectorAll('button'))
        .find((x) => x.textContent === 'No History')!
        .click();
    });
    expect(c.textContent).toContain('No bookings found.');
    await act(async () => r.unmount());
  });
});
function mockFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(
        new Response(JSON.stringify(url.startsWith(`${base}/guests`) ? guests : bookings)),
      ),
    ),
  );
}
async function mount() {
  vi.useFakeTimers();
  const c = document.createElement('div');
  document.body.appendChild(c);
  const r = createRoot(c);
  await act(async () => {
    r.render(createElement(DashboardGuests, { tenantId: 't', propertyId: 'p' }));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
    await Promise.resolve();
  });
  vi.useRealTimers();
  return { c, r };
}
