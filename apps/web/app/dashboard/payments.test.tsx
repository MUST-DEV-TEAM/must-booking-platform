// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
import { DashboardPayments } from './payments';
import { DashboardQueryProvider } from './query-provider';
import type { Reservation } from './reservations';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const booking = {
  id: 'b1',
  guestEmail: 'ada@test',
  paymentMethod: 'PAY_AT_HOTEL',
  total: { amount: '100.00', currency: 'EUR' },
  paidAmount: '0.00',
  refundedAmount: '0.00',
} as Reservation;

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const settle = async () => {
  for (let iteration = 0; iteration < 4; iteration += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    await Promise.resolve();
  }
};
const buttons = () => Array.from(document.body.querySelectorAll<HTMLElement>('button, [role="radio"], [role="menuitem"]'));
const byText = (text: string, within: ParentNode = document.body) =>
  Array.from(within.querySelectorAll<HTMLElement>('button, [role="radio"], [role="menuitem"]')).find(
    (element) => element.textContent?.trim() === text,
  );
const setValue = async (input: HTMLInputElement | HTMLTextAreaElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
// Row actions live in a menu that Radix opens on pointer down.
const openMenu = async (row: Element) =>
  act(async () => {
    row
      .querySelector('button[aria-label^="More actions"]')!
      .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
  });
const menuItems = () => Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).map((item) => item.textContent?.trim());
const closeMenu = async () =>
  act(async () => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
const menuHas = async (row: Element, item: string) => {
  await openMenu(row);
  const has = menuItems().includes(item);
  await closeMenu();
  return has;
};
const openRefund = async (row: Element) => {
  await openMenu(row);
  await act(async () => byText('Refund…')!.click());
};
const rows = () => Array.from(document.body.querySelectorAll('tbody tr'));
const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]');

async function renderPayments(bookings: Reservation[], capabilities = ['payments.refund']) {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const r = createRoot(c);
  await act(async () =>
    r.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(DashboardPayments, {
          tenantId: 't',
          propertyId: 'p',
          initialCapabilities: capabilities,
          initialBookings: bookings,
          initialView: 'ledger',
        }),
      ),
    ),
  );
  return { c, unmount: () => act(async () => r.unmount()) };
}

describe('Payments', () => {
  it('hides refund without capability', async () => {
    const { unmount } = await renderPayments([{ ...booking, paidAmount: '100.00' }], []);
    expect(await menuHas(rows()[0]!, 'Refund…')).toBe(false);
    await unmount();
  });

  it('settles an unpaid pay-at-hotel booking with the chosen method', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              url.endsWith('/capabilities/mine')
                ? ['payments.refund']
                : url.endsWith('/bookings')
                  ? [{ ...booking, paidAmount: '100.00' }]
                  : { ok: true },
            ),
          ),
        ),
      ),
    );
    const { unmount } = await renderPayments([booking]);
    await openMenu(rows()[0]!);
    await act(async () => {
      byText('Card in person')!.click();
    });
    await act(settle);
    expect(toast.success).toHaveBeenCalledWith('Payment recorded.');
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(([url]) => String(url).endsWith('/manual-payment'));
    expect(JSON.parse(call?.[1].body)).toEqual({ method: 'card_in_person' });
    await unmount();
  });

  it('shows persisted paid and partial payment statuses on initial load', async () => {
    const { c, unmount } = await renderPayments(
      [
        { ...booking, id: 'stripe', paymentMethod: 'STRIPE_CHECKOUT', paidAmount: '100.00' },
        { ...booking, id: 'partial', paidAmount: '100.00', refundedAmount: '25.00' },
      ],
      [],
    );
    expect(c.textContent).toContain('Paid');
    expect(c.textContent).toContain('Partially refunded');
    await unmount();
  });

  it('shows Refund only when a positive refundable balance remains', async () => {
    const { unmount } = await renderPayments([
      { ...booking, id: 'unpaid', guestEmail: 'unpaid@test' },
      { ...booking, id: 'paid', guestEmail: 'paid@test', paidAmount: '100.00' },
      { ...booking, id: 'partial-refund', guestEmail: 'partial-refund@test', paidAmount: '100.00', refundedAmount: '25.00' },
      { ...booking, id: 'full-refund', guestEmail: 'full-refund@test', paidAmount: '100.00', refundedAmount: '100.00' },
    ]);
    const offered: boolean[] = [];
    for (const row of rows()) offered.push(await menuHas(row, 'Refund…'));
    expect(offered).toEqual([false, true, true, false]);
    await unmount();
  });

  it('submits a percentage refund with a staff note from the dialog', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              url.endsWith('/capabilities/mine')
                ? ['payments.refund']
                : url.endsWith('/bookings')
                  ? [{ ...booking, paidAmount: '100.00' }]
                  : { ok: true },
            ),
          ),
        ),
      ),
    );
    const { unmount } = await renderPayments([{ ...booking, paidAmount: '100.00' }]);
    await openRefund(rows()[0]!);
    expect(dialog()!.textContent).toContain('€100.00 was paid and can still be refunded');
    await act(async () => byText('Percentage', dialog()!)!.click());
    await act(async () => byText('25%', dialog()!)!.click());
    await setValue(dialog()!.querySelector<HTMLTextAreaElement>('textarea')!, 'Approved by guest services');
    await act(async () => {
      byText('Record refund', dialog()!)!.click();
    });
    await act(settle);
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(([url]) => String(url).endsWith('/payments/refunds'));
    expect(JSON.parse(call?.[1].body)).toMatchObject({ bookingId: 'b1', note: 'Approved by guest services', percentage: 25 });
    expect(dialog()).toBeNull();
    await unmount();
  });

  const live = {
    ...booking,
    status: 'CONFIRMED',
    paymentMethod: 'POKPAY',
    externalReference: 'EBR-LIVE-0001',
    guestFirstName: 'Ada',
    guestLastName: 'Lovelace',
    guestEmail: 'ada@test',
    startsOn: '2026-10-03',
    endsOn: '2026-10-04',
    roomTypeName: 'Executive Suite Sea View',
    paidAmount: '100.00',
    createdAt: '2026-09-30T10:00:00Z',
  } as Reservation;
  const cancelledHeld = {
    ...live,
    id: 'cancelled-held',
    status: 'CANCELLED',
    externalReference: 'EBR-CANCELLED-0002',
    guestFirstName: 'Grace',
    guestLastName: 'Hopper',
    guestEmail: 'grace@test',
    createdAt: '2026-09-29T10:00:00Z',
  } as Reservation;
  const cancelledPayAtHotel = {
    ...booking,
    id: 'cancelled-hotel',
    status: 'CANCELLED',
    externalReference: 'EBR-CANCELLED-0003',
    createdAt: '2026-09-28T10:00:00Z',
  } as Reservation;

  it('shows the reference, guest, stay and both statuses for each booking', async () => {
    const { unmount } = await renderPayments([live]);
    const text = rows()[0]!.textContent ?? '';
    expect(text).toContain('EBR-LIVE-0001');
    expect(text).toContain('Ada Lovelace');
    expect(text).toContain('ada@test');
    expect(text).toContain('3 Oct → 4 Oct 2026');
    expect(text).toContain('Executive Suite Sea View');
    expect(text).toContain('Confirmed');
    expect(text).toContain('Paid');
    await unmount();
  });

  it('never calls a cancelled booking Paid or Due at hotel, and offers no manual payment for it', async () => {
    const { c, unmount } = await renderPayments([cancelledHeld, cancelledPayAtHotel]);
    const [heldRow, hotelRow] = rows();
    expect(heldRow!.textContent).toContain('Cancelled');
    expect(heldRow!.textContent).toContain('Refund due');
    expect(heldRow!.textContent).not.toContain('Partially paid');
    expect(hotelRow!.textContent).toContain('Nothing paid');
    expect(hotelRow!.textContent).not.toContain('Due at hotel');
    // The held money can still be refunded; the unpaid cancelled booking cannot be refunded or marked paid.
    expect(await menuHas(heldRow!, 'Refund…')).toBe(true);
    expect(await menuHas(hotelRow!, 'Refund…')).toBe(false);
    expect(await menuHas(hotelRow!, 'Cash')).toBe(false);
    expect(c.textContent).toContain('Cancelled');
    await unmount();
  });

  it('lists the newest booking first', async () => {
    const { unmount } = await renderPayments([cancelledPayAtHotel, live, cancelledHeld]);
    const references = Array.from(document.body.querySelectorAll('tbody tr code')).map((e) => e.textContent);
    expect(references).toEqual(['EBR-LIVE-0001', 'EBR-CANCELLED-0002', 'EBR-CANCELLED-0003']);
    await unmount();
  });

  it('filters by tab and shows a count on each tab', async () => {
    const { unmount } = await renderPayments([live, cancelledHeld, cancelledPayAtHotel]);
    const tab = (label: string) =>
      Array.from(document.body.querySelectorAll<HTMLElement>('[role="tab"]')).find((button) =>
        button.textContent?.startsWith(label),
      )!;
    expect(tab('All').textContent).toContain('3');
    expect(tab('Needs action').textContent).toContain('1');
    expect(tab('Cancelled').textContent).toContain('2');
    await act(async () => tab('Needs action').click());
    const references = Array.from(document.body.querySelectorAll('tbody tr code')).map((e) => e.textContent);
    expect(references).toEqual(['EBR-CANCELLED-0002']);
    expect(tab('Needs action').getAttribute('aria-selected')).toBe('true');
    await unmount();
  });

  it('searches by reference, guest name or email', async () => {
    const { c, unmount } = await renderPayments([live, cancelledHeld]);
    const search = c.querySelector<HTMLInputElement>('input[type="search"]')!;
    for (const [query, expected] of [
      ['cancelled-0002', ['EBR-CANCELLED-0002']],
      ['lovelace', ['EBR-LIVE-0001']],
      ['GRACE@TEST', ['EBR-CANCELLED-0002']],
    ] as const) {
      await setValue(search, query);
      expect(Array.from(document.body.querySelectorAll('tbody tr code')).map((e) => e.textContent)).toEqual(expected);
    }
    await setValue(search, 'nobody');
    expect(c.textContent).toContain('No results');
    await unmount();
  });

  it('names the booking in the refund dialog so the right row is refunded', async () => {
    const { unmount } = await renderPayments([live]);
    await openRefund(rows()[0]!);
    expect(dialog()!.textContent).toContain('EBR-LIVE-0001 · Ada Lovelace');
    expect(dialog()!.textContent).toContain('€100.00 was paid and can still be refunded');
    await unmount();
  });

  it('links each reference to its payment page and each guest to their guest page', async () => {
    const { unmount } = await renderPayments([{ ...live, guestId: 'g1' } as Reservation]);
    const links = Array.from(rows()[0]!.querySelectorAll('a')).map((a) => [a.textContent, a.getAttribute('href')]);
    expect(links).toEqual([
      ['EBR-LIVE-0001', '/dashboard/t?propertyId=p&section=payments&payment=b1'],
      ['Ada Lovelace', '/dashboard/t?propertyId=p&section=guests&guest=g1'],
    ]);
    await unmount();
  });

  it('shows collected, refunded, net, outstanding and the needs-action count above the table', async () => {
    const { c, unmount } = await renderPayments([
      live,
      { ...cancelledHeld, refundedAmount: '40.00' } as Reservation,
      cancelledPayAtHotel,
    ]);
    const totals = c.querySelector('[aria-label="Payment totals"]')!.textContent ?? '';
    expect(totals).toMatch(/Collected\s*€200\.00/);
    expect(totals).toMatch(/Refunded\s*€40\.00/);
    expect(totals).toMatch(/Net received\s*€160\.00/);
    expect(totals).toMatch(/Outstanding\s*€0\.00/);
    expect(totals).toMatch(/Needs action\s*1/);
    await unmount();
  });

  it('disables Export CSV when no payment matches the current search', async () => {
    const { c, unmount } = await renderPayments([live]);
    const exportButton = byText('Export CSV') as HTMLButtonElement;
    expect(exportButton.disabled).toBe(false);
    await setValue(c.querySelector<HTMLInputElement>('input[type="search"]')!, 'nobody');
    expect(exportButton.disabled).toBe(true);
    await unmount();
  });

  it('previews the refund before confirming, taking a percentage of what is left', async () => {
    const { unmount } = await renderPayments([
      { ...live, total: { amount: '250.00', currency: 'EUR' }, paidAmount: '250.00', refundedAmount: '50.00' } as Reservation,
    ]);
    await openRefund(rows()[0]!);
    expect(dialog()!.textContent).toContain('€200.00 was paid and can still be refunded');
    expect(dialog()!.textContent).toContain('Refund: €200.00');
    await act(async () => byText('Percentage', dialog()!)!.click());
    await act(async () => byText('50%', dialog()!)!.click());
    expect(dialog()!.textContent).toContain('Refund: €100.00');
    await unmount();
  });
  it('opens on an overview that lists what needs action, what is owed and what was paid', async () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const r = createRoot(c);
    await act(async () =>
      r.render(
        createElement(
          DashboardQueryProvider,
          undefined,
          createElement(DashboardPayments, {
            tenantId: 't',
            propertyId: 'p',
            initialCapabilities: [],
            initialBookings: [live, cancelledHeld, cancelledPayAtHotel, { ...booking, id: 'owes', externalReference: 'EBR-OWES-0004', status: 'CONFIRMED' } as Reservation],
          }),
        ),
      ),
    );
    const text = c.textContent ?? '';
    expect(text).toContain('Needs action');
    expect(text).toContain('Grace Hopper · EBR-CANCELLED-0002');
    expect(text).toContain('money is still held');
    expect(text).toContain('EBR-OWES-0004');
    expect(text).toContain('Recently paid');
    expect(c.querySelector('tbody')).toBeNull();
    await act(async () => Array.from(c.querySelectorAll<HTMLElement>('[role="tab"]')).find((tab) => tab.textContent?.startsWith('Ledger'))!.click());
    expect(c.querySelector('tbody')).not.toBeNull();
    await act(async () => r.unmount());
  });
});
