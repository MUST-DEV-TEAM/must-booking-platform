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
    expect(c.textContent).not.toContain('Refund');
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
});
