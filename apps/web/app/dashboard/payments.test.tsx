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
      Array.from(c.querySelectorAll('button'))
        .find((x) => x.textContent === 'Settle')!
        .click();
      await Promise.resolve();
    });
    expect(c.textContent).toContain('Paid');
    expect(toast.success).toHaveBeenCalledWith('Payment recorded.');
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
              { ...booking, id: 'partial', paidAmount: '25.00' },
            ],
          }),
        ),
      ),
    );
    expect(c.textContent).toContain('Paid');
    expect(c.textContent).toContain('Partially paid');
    await act(async () => r.unmount());
  });
});
