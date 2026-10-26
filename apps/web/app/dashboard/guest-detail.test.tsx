// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GuestDetail, possibleDuplicates } from './guest-detail';
import { DashboardQueryProvider } from './query-provider';
import type { Reservation } from './reservations';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const base = {
  guestId: 'g1',
  guestFirstName: 'Ada',
  guestLastName: 'Lovelace',
  guestEmail: 'ada@test',
  guestPhone: '+355 69 000 0000',
  guestCity: 'Vlorë',
  paymentMethod: 'POKPAY',
  roomTypeName: 'Executive Suite Sea View',
  total: { amount: '250.00', currency: 'EUR' },
  refundedAmount: '0.00',
} as Reservation;

const bookings: Reservation[] = [
  {
    ...base,
    id: 'new',
    status: 'CONFIRMED',
    externalReference: 'EBR-NEW',
    startsOn: '2026-10-03',
    endsOn: '2026-10-04',
    paidAmount: '250.00',
    createdAt: '2026-09-30T10:00:00Z',
  },
  {
    ...base,
    id: 'old',
    status: 'CANCELLED',
    externalReference: 'EBR-OLD',
    startsOn: '2026-09-01',
    endsOn: '2026-09-02',
    paidAmount: '250.00',
    refundedAmount: '100.00',
    createdAt: '2026-08-01T10:00:00Z',
  },
  {
    ...base,
    id: 'same-email',
    guestId: 'g2',
    guestFirstName: 'A.',
    guestLastName: 'Lovelace',
    guestEmail: 'ADA@test',
    status: 'CONFIRMED',
    externalReference: 'EBR-DUP-EMAIL',
    paidAmount: '0.00',
    createdAt: '2026-08-02T10:00:00Z',
  },
  {
    ...base,
    id: 'same-name',
    guestId: 'g3',
    guestEmail: 'other@test',
    status: 'CONFIRMED',
    externalReference: 'EBR-DUP-NAME',
    paidAmount: '0.00',
    createdAt: '2026-08-03T10:00:00Z',
  },
  {
    ...base,
    id: 'stranger',
    guestId: 'g4',
    guestFirstName: 'Grace',
    guestLastName: 'Hopper',
    guestEmail: 'grace@test',
    status: 'CONFIRMED',
    externalReference: 'EBR-OTHER',
    paidAmount: '0.00',
    createdAt: '2026-08-04T10:00:00Z',
  },
];

async function renderGuest(guestId: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(bookings), { status: 200 }))),
  );
  const c = document.createElement('div');
  const r = createRoot(c);
  await act(async () => {
    r.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(GuestDetail, { tenantId: 't', propertyId: 'p', guestId }),
      ),
    );
  });
  // React only applies updates when an act scope ends, so wait one short act per tick.
  for (let tick = 0; tick < 100; tick += 1) {
    if (!c.querySelector('[aria-busy="true"]')) break;
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });
  }
  return { c, unmount: () => act(async () => r.unmount()) };
}

afterEach(() => vi.unstubAllGlobals());

describe('possibleDuplicates', () => {
  it('finds other profiles with the same email (ignoring case) or the same name', () => {
    expect(possibleDuplicates('g1', bookings).map((b) => b.guestId)).toEqual(['g2', 'g3']);
  });

  it('finds nothing for a guest nobody resembles', () => {
    expect(possibleDuplicates('g4', bookings)).toEqual([]);
  });
});

describe('GuestDetail', () => {
  it("shows the guest's profile and their own bookings, newest first, with payment links", async () => {
    const { c, unmount } = await renderGuest('g1');
    expect(c.querySelector('h1, h2')?.textContent).toContain('Ada Lovelace');
    expect(c.textContent).toContain('ada@test');
    expect(c.textContent).toContain('Vlorë');
    const rows = Array.from(c.querySelectorAll('tbody tr'));
    expect(rows.map((row) => row.querySelector('code')?.textContent)).toEqual([
      'EBR-NEW',
      'EBR-OLD',
    ]);
    expect(rows[0].querySelector('a')?.getAttribute('href')).toBe(
      '/dashboard/t?propertyId=p&section=reservations&reservation=new',
    );
    expect(c.textContent).not.toContain('EBR-OTHER');
    await unmount();
  });

  it('reads the cancelled booking as a refund that was made, not as paid', async () => {
    const { c, unmount } = await renderGuest('g1');
    const cancelled = Array.from(c.querySelectorAll('tbody tr'))[1];
    expect(cancelled.textContent).toContain('Cancelled');
    await act(async () => {
      Array.from(c.querySelectorAll<HTMLElement>('[role="tab"]'))
        .find((entry) => entry.textContent?.startsWith('Payments'))!
        .click();
    });
    const paymentRow = Array.from(c.querySelectorAll('tbody tr'))[1];
    expect(paymentRow.textContent).toContain('Partially refunded');
    expect(paymentRow.querySelector('a')?.getAttribute('href')).toBe(
      '/dashboard/t?propertyId=p&section=payments&payment=old',
    );
    await unmount();
  });

  it('totals what the guest has paid and had refunded', async () => {
    const { c, unmount } = await renderGuest('g1');
    const summary = c.querySelector('[aria-label="Guest summary"]')!.textContent ?? '';
    expect(summary).toContain('1 cancelled');
    expect(summary).toMatch(/Net paid.*400/);
    expect(summary).toMatch(/Still owed.*—/);
    await unmount();
  });

  it('shows who the guest is, what they have done and a feed of their activity', async () => {
    const { c, unmount } = await renderGuest('g1');
    expect(c.textContent).toContain('Contact and identity');
    expect(c.textContent).toContain('Vlorë');
    expect(c.textContent).toContain('Possible duplicate');
    await act(async () => {
      Array.from(c.querySelectorAll<HTMLElement>('[role="tab"]'))
        .find((entry) => entry.textContent?.startsWith('Activity'))!
        .click();
    });
    expect(c.textContent).toContain('Reservation EBR-NEW created');
    expect(c.textContent).toContain('Reservation EBR-OLD cancelled');
    await unmount();
  });

  it('lists possible duplicate profiles with links to their pages', async () => {
    const { c, unmount } = await renderGuest('g1');
    const links = Array.from(c.querySelectorAll('li a')).map((a) => a.getAttribute('href'));
    expect(links).toEqual([
      '/dashboard/t?propertyId=p&section=guests&guest=g2',
      '/dashboard/t?propertyId=p&section=guests&guest=g3',
    ]);
    await unmount();
  });

  it('says so when the guest has no bookings here', async () => {
    const { c, unmount } = await renderGuest('nobody');
    expect(c.textContent).toContain('Guest not found');
    await unmount();
  });
});
