// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
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
describe('Payments', () => {
  it('hides refund without capability', async () => {
    const c = document.createElement('div');
    const r = createRoot(c);
    await act(async () =>
      r.render(
        createElement(
          DashboardQueryProvider,
          undefined,
          createElement(DashboardPayments, {
            tenantId: 't',
            propertyId: 'p',
            initialBookings: [booking],
            initialCapabilities: [],
          }),
        ),
      ),
    );
    expect(c.querySelector('button.must-button--danger')).toBeNull();
    await act(async () => r.unmount());
  });
  it('settles an unpaid pay-at-hotel booking and updates status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              url.endsWith('/bookings') ? [{ ...booking, paidAmount: '100.00' }] : { ok: true },
            ),
          ),
        ),
      ),
    );
    const c = document.createElement('div');
    const r = createRoot(c);
    await act(async () =>
      r.render(
        createElement(
          DashboardQueryProvider,
          undefined,
          createElement(DashboardPayments, {
            tenantId: 't',
            propertyId: 'p',
            initialBookings: [booking],
            initialCapabilities: ['payments.refund'],
          }),
        ),
      ),
    );
    await act(async () => {
      const method = c.querySelector<HTMLSelectElement>('#manual-payment-method-b1')!;
      method.value = 'card_in_person';
      method.dispatchEvent(new Event('change', { bubbles: true }));
      c.querySelector<HTMLButtonElement>('button.must-button--secondary')!.click();
      for (let iteration = 0; iteration < 4; iteration += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 20));
        await Promise.resolve();
      }
    });
    expect(c.textContent).toContain('Paid');
    expect(toast.success).toHaveBeenCalledWith('Payment recorded.');
    const manualPaymentCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(([url]) =>
      String(url).endsWith('/manual-payment'),
    );
    expect(JSON.parse(manualPaymentCall?.[1].body)).toEqual({ method: 'card_in_person' });
    await act(async () => r.unmount());
  });
  it('shows persisted paid and partial payment statuses on initial load', async () => {
    const c = document.createElement('div');
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
            initialBookings: [
              { ...booking, id: 'stripe', paymentMethod: 'STRIPE_CHECKOUT', paidAmount: '100.00' },
              { ...booking, id: 'partial', paidAmount: '100.00', refundedAmount: '25.00' },
            ],
          }),
        ),
      ),
    );
    expect(c.textContent).toContain('Paid');
    expect(c.textContent).toContain('Partially refunded');
    await act(async () => r.unmount());
  });

  it('shows Refund only when a positive refundable balance remains', async () => {
    const c = document.createElement('div');
    const r = createRoot(c);
    await act(async () =>
      r.render(
        createElement(
          DashboardQueryProvider,
          undefined,
          createElement(DashboardPayments, {
            tenantId: 't',
            propertyId: 'p',
            initialCapabilities: ['payments.refund'],
            initialBookings: [
              { ...booking, id: 'unpaid', guestEmail: 'unpaid@test' },
              { ...booking, id: 'paid', guestEmail: 'paid@test', paidAmount: '100.00' },
              {
                ...booking,
                id: 'partial-refund',
                guestEmail: 'partial-refund@test',
                paidAmount: '100.00',
                refundedAmount: '25.00',
              },
              {
                ...booking,
                id: 'full-refund',
                guestEmail: 'full-refund@test',
                paidAmount: '100.00',
                refundedAmount: '100.00',
              },
            ],
          }),
        ),
      ),
    );

    expect(c.querySelectorAll('button.must-button--danger')).toHaveLength(2);
    const rows = Array.from(c.querySelectorAll('tbody tr'));
    expect(rows[0].querySelector('button.must-button--danger')).toBeNull();
    expect(rows[3].querySelector('button.must-button--danger')).toBeNull();
    expect(c.textContent).toContain('Partially refunded');
    expect(c.textContent).toContain('Refunded');
    await act(async () => r.unmount());
  });

  it('submits a percentage refund with a staff note from the dialog', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              url.endsWith('/bookings') ? [{ ...booking, paidAmount: '100.00' }] : { ok: true },
            ),
          ),
        ),
      ),
    );
    const c = document.createElement('div');
    const r = createRoot(c);
    await act(async () =>
      r.render(
        createElement(
          DashboardQueryProvider,
          undefined,
          createElement(DashboardPayments, {
            tenantId: 't',
            propertyId: 'p',
            initialCapabilities: ['payments.refund'],
            initialBookings: [{ ...booking, paidAmount: '100.00' }],
          }),
        ),
      ),
    );

    await act(async () => {
      c.querySelector<HTMLButtonElement>('button.must-button--danger')!.click();
    });
    const dialog = c.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Remaining refundable balance: 100.00 EUR');
    const type = dialog.querySelector<HTMLSelectElement>('#refund-type')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(type), 'value')!.set!.call(
        type,
        'percentage',
      );
      type.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      const percentage = c.querySelector<HTMLInputElement>('#refund-percentage')!;
      const note = c.querySelector<HTMLTextAreaElement>('#refund-note')!;
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(percentage), 'value')!.set!.call(
        percentage,
        '25',
      );
      percentage.dispatchEvent(new Event('change', { bubbles: true }));
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(note), 'value')!.set!.call(
        note,
        'Approved by guest services',
      );
      note.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });

    await act(async () => {
      Array.from(c.querySelector('[role="dialog"]')!.querySelectorAll('button'))
        .find((button) => button.textContent === 'Record refund')!
        .click();
      for (let iteration = 0; iteration < 4; iteration += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 20));
        await Promise.resolve();
      }
    });

    const refundCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(([url]) =>
      String(url).endsWith('/payments/refunds'),
    );
    expect(JSON.parse(refundCall?.[1].body)).toMatchObject({
      bookingId: 'b1',
      note: 'Approved by guest services',
      percentage: 25,
    });
    expect(c.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => r.unmount());
  });

  async function renderPayments(bookings: Reservation[], capabilities = ['payments.refund']) {
    const c = document.createElement('div');
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
          }),
        ),
      ),
    );
    return { c, unmount: () => act(async () => r.unmount()) };
  }

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
    const { c, unmount } = await renderPayments([live]);
    const row = c.querySelector('tbody tr')!;
    expect(row.textContent).toContain('EBR-LIVE-0001');
    expect(row.textContent).toContain('Ada Lovelace');
    expect(row.textContent).toContain('ada@test');
    expect(row.textContent).toContain('3 Oct → 4 Oct 2026');
    expect(row.textContent).toContain('Executive Suite Sea View');
    expect(row.textContent).toContain('Confirmed');
    expect(row.textContent).toContain('Paid');
    await unmount();
  });

  it('never calls a cancelled booking Paid or Due at hotel, and offers no manual payment for it', async () => {
    const { c, unmount } = await renderPayments([cancelledHeld, cancelledPayAtHotel]);
    const [heldRow, hotelRow] = Array.from(c.querySelectorAll('tbody tr'));
    expect(heldRow.textContent).toContain('Cancelled');
    expect(heldRow.textContent).toContain('Refund due');
    expect(heldRow.textContent).not.toContain('Partially paid');
    expect(hotelRow.textContent).toContain('Nothing paid');
    expect(hotelRow.textContent).not.toContain('Due at hotel');
    expect(c.textContent).not.toContain('Mark as Paid');
    // The held money can still be refunded; the unpaid cancelled booking cannot.
    expect(heldRow.querySelector('button.must-button--danger')).not.toBeNull();
    expect(hotelRow.querySelector('button.must-button--danger')).toBeNull();
    await unmount();
  });

  it('lists the newest booking first', async () => {
    const { c, unmount } = await renderPayments([cancelledPayAtHotel, live, cancelledHeld]);
    const references = Array.from(c.querySelectorAll('tbody tr code')).map((e) => e.textContent);
    expect(references).toEqual(['EBR-LIVE-0001', 'EBR-CANCELLED-0002', 'EBR-CANCELLED-0003']);
    await unmount();
  });

  it('filters by tab and shows a count on each tab', async () => {
    const { c, unmount } = await renderPayments([live, cancelledHeld, cancelledPayAtHotel]);
    const tab = (label: string) =>
      Array.from(c.querySelectorAll<HTMLButtonElement>('[role="group"] button')).find((button) =>
        button.textContent?.startsWith(label),
      )!;
    expect(tab('All').textContent).toContain('3');
    expect(tab('Needs action').textContent).toContain('1');
    expect(tab('Cancelled').textContent).toContain('2');
    await act(async () => tab('Needs action').click());
    const references = Array.from(c.querySelectorAll('tbody tr code')).map((e) => e.textContent);
    expect(references).toEqual(['EBR-CANCELLED-0002']);
    expect(tab('Needs action').getAttribute('aria-pressed')).toBe('true');
    await unmount();
  });

  it('searches by reference, guest name or email', async () => {
    const { c, unmount } = await renderPayments([live, cancelledHeld]);
    const search = c.querySelector<HTMLInputElement>('input[type="search"]')!;
    const setValue = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(search), 'value')!.set!;
    for (const [query, expected] of [
      ['cancelled-0002', ['EBR-CANCELLED-0002']],
      ['lovelace', ['EBR-LIVE-0001']],
      ['GRACE@TEST', ['EBR-CANCELLED-0002']],
    ] as const) {
      await act(async () => {
        setValue.call(search, query);
        search.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(Array.from(c.querySelectorAll('tbody tr code')).map((e) => e.textContent)).toEqual(
        expected,
      );
    }
    await act(async () => {
      setValue.call(search, 'nobody');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(c.querySelector('tbody')!.textContent).toContain('No payments match');
    await unmount();
  });

  it('names the booking in the refund dialog so the right row is refunded', async () => {
    const { c, unmount } = await renderPayments([live]);
    await act(async () => {
      c.querySelector<HTMLButtonElement>('button.must-button--danger')!.click();
    });
    const dialog = c.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain('EBR-LIVE-0001 · Ada Lovelace');
    expect(dialog.textContent).toContain('Remaining refundable balance: 100.00 EUR');
    await unmount();
  });

  it('links each reference to its payment page and each guest to their guest page', async () => {
    const { c, unmount } = await renderPayments([{ ...live, guestId: 'g1' } as Reservation]);
    const row = c.querySelector('tbody tr')!;
    const links = Array.from(row.querySelectorAll('a')).map((a) => [
      a.textContent,
      a.getAttribute('href'),
    ]);
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
    const totals = c.querySelector('dl[aria-label="Payment totals in EUR"]')!.textContent ?? '';
    expect(totals).toContain('Collected200.00 EUR');
    expect(totals).toContain('Refunded40.00 EUR');
    expect(totals).toContain('Net received160.00 EUR');
    expect(totals).toContain('Outstanding0.00 EUR');
    expect(totals).toContain('Needs action1');
    await unmount();
  });

  it('disables Export CSV when no payment matches the current search', async () => {
    const { c, unmount } = await renderPayments([live]);
    const exportButton = Array.from(c.querySelectorAll('button')).find(
      (button) => button.textContent === 'Export CSV',
    )!;
    expect(exportButton.disabled).toBe(false);
    const search = c.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(search), 'value')!.set!.call(
        search,
        'nobody',
      );
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(exportButton.disabled).toBe(true);
    await unmount();
  });
});
