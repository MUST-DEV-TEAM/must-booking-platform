// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlobalSearch, highlightParts, searchItemHref } from './global-search';
import { DashboardQueryProvider } from './query-provider';
import { matchPages, quickLinks } from './search-pages';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
class Observer {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= Observer as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};

const roots: Root[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  localStorage.clear();
});
const wait = async (ms: number) => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
};
async function mount(canOpen = (_section: string) => true, can = (_capability: string) => true) {
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(GlobalSearch, { tenantId: 't', propertyId: 'p', canOpen, can }),
      ),
    );
  });
}
async function openPopup() {
  await act(async () => {
    document.querySelector<HTMLButtonElement>('button[aria-label="Search"]')!.click();
  });
  await wait(30);
}
async function type(value: string) {
  const el = document.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await wait(350);
  for (let i = 0; i < 40 && (document.body.textContent ?? '').includes('Searching…'); i++)
    await wait(50);
}
const options = () =>
  [...document.querySelectorAll<HTMLAnchorElement>('[role="option"]')].map((a) => ({
    title: a.querySelector('span')?.textContent,
    href: a.getAttribute('href'),
  }));

describe('search pages', () => {
  const all = () => true;
  it('finds pages and settings by name or by the words people use', () => {
    expect(matchPages('pay', all, all)[0]!.label).toBe('Payments');
    expect(matchPages('check-in time', all, all).map((p) => p.label)).toContain('Booking rules');
    expect(matchPages('smtp', all, all).map((p) => p.label)).toContain('Emails');
    expect(matchPages('password', all, all)[0]!.label).toBe('My account');
    expect(matchPages('p', all, all)).toEqual([]);
  });

  it('never offers what the person may not open or do', () => {
    const noSettings = (section: string) => section !== 'settings';
    expect(matchPages('check-in time', noSettings, all)).toEqual([]);
    expect(matchPages('new booking', all, () => false).map((p) => p.label)).not.toContain(
      'New booking',
    );
    expect(quickLinks(all, () => false).map((p) => p.label)).not.toContain('New booking');
  });

  it('links staff and email results to their pages', () => {
    expect(searchItemHref('t', 'p', { type: 'staff', id: 'u1', title: '', subtitle: '' })).toBe(
      '/dashboard/t?propertyId=p&section=staff&staffUser=u1',
    );
    expect(searchItemHref('t', 'p', { type: 'email', id: 'm1', title: '', subtitle: '' })).toBe(
      '/dashboard/t?propertyId=p&section=emails&emailMessageId=m1',
    );
  });
});

describe('what each kind of person sees', () => {
  const open = () => true;
  const frontDesk = new Set([
    'bookings.view',
    'bookings.create',
    'bookings.edit',
    'calendar.view',
    'guests.view',
    'payments.record',
  ]);
  const asFrontDesk = (capability: string) => frontDesk.has(capability);
  const titles = (query: string, can: (c: string) => boolean) =>
    matchPages(query, open, can, 20).map((p) => p.label);

  it('hides settings, hotels, reports, staff, rates, payments and emails from the front desk', () => {
    for (const query of [
      'settings',
      'booking rules',
      'check-in time',
      'branding',
      'hotels',
      'report',
      'revenue',
      'staff',
      'roles',
      'rates',
      'vat',
      'payments',
      'refund',
      'emails',
      'smtp',
      'billing',
    ])
      expect(titles(query, asFrontDesk), query).toEqual([]);
    expect(titles('calendar', asFrontDesk)).toContain('Calendar');
    expect(titles('new booking', asFrontDesk)).toContain('New booking');
    expect(titles('guests', asFrontDesk)).toContain('Guests');
  });

  it('shows hotel settings to an owner or admin but money pages only with the permission', () => {
    const admin = (capability: string) => capability !== 'none';
    expect(titles('check-in time', admin)).toContain('Booking rules');
    expect(titles('hotels', admin)).toContain('Hotels');
    const finance = (capability: string) => capability === 'payments.view';
    expect(titles('payments', finance)).toContain('Payments');
    expect(titles('reports', finance)).toEqual([]);
  });

  it('links payments, rate plans and rooms to the right place', () => {
    expect(
      searchItemHref('t', 'p', {
        type: 'payment',
        id: 'pay1',
        target: 'b9',
        title: '',
        subtitle: '',
      }),
    ).toBe('/dashboard/t?propertyId=p&section=payments&payment=b9');
    expect(searchItemHref('t', 'p', { type: 'rate_plan', id: 'r1', title: '', subtitle: '' })).toBe(
      '/dashboard/t?propertyId=p&section=rates-pricing',
    );
    expect(
      searchItemHref('t', 'p', { type: 'room', id: 'rm1', target: 'rt1', title: '', subtitle: '' }),
    ).toBe('/dashboard/t?propertyId=p&section=accommodations&roomType=rt1');
    expect(
      searchItemHref('t', 'p', { type: 'room_type', id: 'rt2', title: '', subtitle: '' }),
    ).toBe('/dashboard/t?propertyId=p&section=accommodations&roomType=rt2');
  });

  it('marks the typed words in a result, ignoring case and special characters', () => {
    expect(highlightParts('Zelda Searchable', 'zel')).toEqual([
      { text: 'Zel', match: true },
      { text: 'da Searchable', match: false },
    ]);
    expect(highlightParts('MLDH-2610 (VIP)', 'mldh-26 (vip)').map((p) => p.match)).toContain(true);
    expect(highlightParts('Anything', 'x')).toEqual([{ text: 'Anything', match: false }]);
  });
});

describe('global search popup', () => {
  it('is an icon that opens a popup with a hint, quick links and an example placeholder', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await mount();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await openPopup();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    const input = document.querySelector<HTMLInputElement>('input[type="search"]')!;
    expect(input.placeholder.length).toBeGreaterThan(8);
    expect(document.body.textContent).toContain('guests (by name, email or phone)');
    expect(document.body.textContent).toContain('Quick links');
    expect(options().map((o) => o.title)).toContain('New booking');
  });

  it('opens with the / key and waits for two letters before asking the server', async () => {
    const fetch = vi.fn(async () => Response.json({ query: 'ze', groups: [] }));
    vi.stubGlobal('fetch', fetch);
    await mount();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
    });
    await wait(30);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await type('z');
    expect(fetch).not.toHaveBeenCalled();
    await type('ze');
    expect(String(fetch.mock.calls.at(-1)![0])).toContain('/search?q=ze');
  });

  it('shows pages and settings together with record results, each with its own link', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          query: 'pay',
          groups: [
            {
              key: 'bookings',
              label: 'Reservations',
              items: [
                { type: 'booking', id: 'b1', title: 'SRCH-1001 · Zelda', subtitle: 'confirmed' },
              ],
            },
            {
              key: 'emails',
              label: 'Emails sent',
              items: [
                {
                  type: 'email',
                  id: 'm1',
                  title: 'Payment received',
                  subtitle: 'zelda@example.test · sent',
                },
              ],
            },
          ],
        }),
      ),
    );
    await mount();
    await openPopup();
    await type('pay');
    expect(options()).toEqual([
      { title: 'Payments', href: '/dashboard/t?propertyId=p&section=payments' },
      {
        title: 'Payment settings',
        href: '/dashboard/t?propertyId=p&section=settings&settingsArea=payments',
      },
      {
        title: 'SRCH-1001 · Zelda',
        href: '/dashboard/t?propertyId=p&section=reservations&reservation=b1',
      },
      {
        title: 'Payment received',
        href: '/dashboard/t?propertyId=p&section=emails&emailMessageId=m1',
      },
    ]);
    const text = document.body.textContent ?? '';
    for (const heading of ['Pages and settings', 'Reservations', 'Emails sent'])
      expect(text).toContain(heading);
  });

  it('says so when nothing matches and keeps pages when the record search fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ query: 'qqqq', groups: [] })),
    );
    await mount();
    await openPopup();
    await type('qqqq');
    expect(document.body.textContent).toContain('No results for “qqqq”.');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 500 })),
    );
    await type('payments');
    expect(document.body.textContent).toContain('Search for records is unavailable.');
    expect(options().map((o) => o.title)).toContain('Payments');
  });

  it('remembers what was opened and offers it again next time', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ query: 'calendar', groups: [] })),
    );
    await mount();
    await openPopup();
    await type('calendar');
    const first = document.querySelector<HTMLAnchorElement>('[role="option"]')!;
    await act(async () => {
      first.addEventListener('click', (event) => event.preventDefault());
      first.click();
    });
    expect(JSON.parse(localStorage.getItem('must.search.recent') ?? '[]')).toEqual(['calendar']);
  });
});
