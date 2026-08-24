// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DashboardGuests } from './guests';
import { DashboardQueryProvider } from './query-provider';

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
  it('keeps the loading skeleton until the guest request and booking history resolve', async () => {
    let resolveGuests!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.endsWith('/guests')
          ? new Promise<Response>((resolve) => (resolveGuests = resolve))
          : Promise.resolve(new Response(JSON.stringify(bookings))),
      ),
    );
    const { container, root } = await mount({ settle: false });
    await act(async () => {
      await settleQueries();
    });

    expect(container.querySelector('[aria-busy="true"]')?.textContent).toContain('Loading guests…');

    await act(async () => {
      resolveGuests(new Response(JSON.stringify(guests)));
      await Promise.resolve();
    });
    await act(async () => root.unmount());
  });

  it('renders fetched guest data and filters selected guest history by guest id', async () => {
    mockFetch();
    const { container, root } = await mount();
    expect(container.textContent).toContain('Ada Lovelace');
    expect(container.textContent).toContain('ada@test');
    expect(container.textContent).toContain('2 bookings');
    await click(
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === 'Ada Lovelace',
      )!,
    );
    expect(container.textContent).toContain('booking history');
    expect(container.textContent).toContain('Deluxe');
    await act(async () => root.unmount());
  });

  it('shows an error and reloads both datasets when Retry succeeds', async () => {
    let failGuests = true;
    const fetch = vi.fn((url: string) => {
      if (url.endsWith('/guests')) {
        const status = failGuests ? 500 : 200;
        return Promise.resolve(
          new Response(failGuests ? null : JSON.stringify(guests), { status }),
        );
      }
      return Promise.resolve(new Response(JSON.stringify(bookings)));
    });
    vi.stubGlobal('fetch', fetch);
    const { container, root } = await mount();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Unable to load guests.',
    );
    failGuests = false;
    await click(
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === 'Retry',
      )!,
    );

    expect(container.textContent).toContain('Ada Lovelace');
    expect(fetch.mock.calls.filter(([url]) => url === `${base}/guests`)).toHaveLength(2);
    await act(async () => root.unmount());
  });

  it('shows no bookings found when the selected guest has no matching history', async () => {
    mockFetch();
    const { container, root } = await mount();
    await click(
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === 'No History',
      )!,
    );
    expect(container.textContent).toContain('No bookings found.');
    await act(async () => root.unmount());
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

async function mount({ settle = true }: { settle?: boolean } = {}) {
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(DashboardGuests, { tenantId: 't', propertyId: 'p' }),
      ),
    );
  });
  if (settle) {
    await act(async () => {
      await settleQueries();
    });
  }
  return { container, root };
}

async function click(element: Element) {
  await act(async () => {
    (element as HTMLButtonElement).click();
    await settleQueries();
  });
}

async function settleQueries() {
  for (let iteration = 0; iteration < 4; iteration += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    await Promise.resolve();
  }
}
