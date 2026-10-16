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
const suspectedDuplicates = [
  {
    guest: guests[0],
    suspectedDuplicate: {
      id: 'guest-3',
      firstName: 'A.',
      lastName: 'Lovelace',
      email: 'ada+old@test',
      phone: '+355 69 123 4567',
      bookingCount: 1,
    },
  },
];

afterEach(() => vi.unstubAllGlobals());

describe('Dashboard guests', () => {
  it('keeps the loading skeleton until the guest request and booking history resolve', async () => {
    let resolveGuests!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.endsWith('/suspected-duplicates'))
          return Promise.resolve(new Response(JSON.stringify([])));
        return url.endsWith('/guests')
          ? new Promise<Response>((resolve) => (resolveGuests = resolve))
          : Promise.resolve(new Response(JSON.stringify(bookings)));
      }),
    );
    const { container, root } = await mount({ settle: false });
    await act(async () => {
      await settleQueries();
    });

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();

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
    expect(container.querySelector('tbody tr')?.textContent).toContain('2');
    await click(
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === 'Ada Lovelace',
      )!,
    );
    expect(container.textContent).toContain('booking history');
    expect(container.textContent).toContain('Deluxe');
    await act(async () => root.unmount());
  });

  it('sorts the directory by booking count and filters to suspected duplicate profiles', async () => {
    mockFetch(suspectedDuplicates);
    const { container, root } = await mount();
    const bookingSort = Array.from(container.querySelectorAll('thead button')).find(
      (button) => button.textContent?.includes('Bookings'),
    )!;
    await click(bookingSort);
    expect(
      Array.from(container.querySelectorAll('tbody tr')).map(
        (row) => row.querySelector('button')?.textContent,
      ),
    ).toEqual(['Ada Lovelace', 'No History']);
    await click(bookingSort);
    expect(
      Array.from(container.querySelectorAll('tbody tr')).map(
        (row) => row.querySelector('button')?.textContent,
      ),
    ).toEqual(['No History', 'Ada Lovelace']);

    await click(container.querySelector('[role="tab"][aria-selected="false"]')!);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(container.querySelector('tbody')?.textContent).toContain('Ada Lovelace');
    await act(async () => root.unmount());
  });

  it('shows an error and reloads both datasets when Retry succeeds', async () => {
    let failGuests = true;
    const fetch = vi.fn((url: string) => {
      if (url.endsWith('/suspected-duplicates'))
        return Promise.resolve(new Response(JSON.stringify([])));
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
        (button) => button.textContent === 'Try again',
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

  it('shows suspected profiles side by side and sends the selected canonical guest', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(null, { status: 204 });
      if (url.endsWith('/suspected-duplicates'))
        return new Response(JSON.stringify(suspectedDuplicates));
      if (url.includes('/guests')) return new Response(JSON.stringify(guests));
      return new Response(JSON.stringify(bookings));
    });
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    const { container, root } = await mount();

    expect(container.textContent).toContain('Suspected duplicates');
    expect(container.textContent).toContain('ada+old@test');
    await click(container.querySelectorAll('[role="radio"]')[0]!);
    await click(
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === 'Merge profiles',
      )!,
    );
    const dialog = document.body.querySelector('[role="dialog"]')!;
    await click(
      Array.from(dialog.querySelectorAll('button')).find(
        (button) => button.textContent === 'Merge profiles',
      )!,
    );

    expect(fetch).toHaveBeenCalledWith(
      `${base}/guests/guest-1/merge`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ canonicalGuestId: 'guest-1' }),
      }),
    );
    await act(async () => root.unmount());
  });

  it('explains why a phone-matched pair was flagged, highlights the differing field, and previews the merge result', async () => {
    const phoneMatchPair = [
      {
        guest: {
          id: 'guest-4',
          firstName: 'Bob',
          lastName: null,
          email: 'bob@test',
          phone: '+355 69 000 1111',
          bookingCount: 3,
        },
        suspectedDuplicate: {
          id: 'guest-5',
          firstName: null,
          lastName: null,
          email: 'bob.alt@test',
          phone: '+355 69 000 1111',
          bookingCount: 1,
        },
      },
    ];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(null, { status: 204 });
      if (url.endsWith('/suspected-duplicates'))
        return new Response(JSON.stringify(phoneMatchPair));
      if (url.includes('/guests')) return new Response(JSON.stringify(guests));
      return new Response(JSON.stringify(bookings));
    });
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    const { container, root } = await mount();

    expect(container.textContent).toContain(
      'Flagged because the phone number matches, but the email addresses differ.',
    );
    expect(container.textContent).toContain('Email: bob@test · different');

    // Keep guest-5 (the one missing a name) — the preview should mention
    // backfilling its name from guest-4.
    await click(container.querySelectorAll('[role="radio"]')[1]!);
    expect(container.textContent).toContain('Keeping bob.alt@test');
    expect(container.textContent).toContain("the other profile's name Bob");

    await act(async () => root.unmount());
  });
});

function mockFetch(duplicates: typeof suspectedDuplicates = []) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            url.endsWith('/suspected-duplicates')
              ? duplicates
              : url.startsWith(`${base}/guests`)
                ? guests
                : bookings,
          ),
        ),
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
