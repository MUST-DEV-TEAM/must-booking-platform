// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
import { PaymentDetail, type Ledger } from './payment-detail';
import { DashboardQueryProvider } from './query-provider';
import type { Reservation } from './reservations';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const booking = {
  id: 'b1',
  guestId: 'g1',
  guestFirstName: 'Ada',
  guestLastName: 'Lovelace',
  guestEmail: 'ada@test',
  status: 'CONFIRMED',
  paymentMethod: 'POKPAY',
  externalReference: 'EBR-260930-2258-9WDC',
  roomTypeName: 'Executive Suite Sea View',
  startsOn: '2026-10-03',
  endsOn: '2026-10-04',
  total: { amount: '250.00', currency: 'EUR' },
  paidAmount: '250.00',
  refundedAmount: '50.00',
  clockFolios: [
    { id: '77313832', isDeposit: false, balance: '250.00', closedAt: null },
    { id: '77313833', isDeposit: true, balance: '-250.00', closedAt: null },
  ],
} as Reservation;

const ledger: Ledger = {
  bookingId: 'b1',
  entries: [
    {
      id: 'pay-1',
      kind: 'CHARGE',
      provider: 'pokpay',
      method: null,
      externalPaymentId: 'f70f27df-b465-4a01-9376-31420178c7f1',
      status: 'PAID',
      amount: '250.00',
      currency: 'EUR',
      note: null,
      createdAt: '2026-09-30T20:59:00Z',
      actorEmail: null,
    },
    {
      id: 'pay-2',
      kind: 'REFUND',
      provider: 'pokpay',
      method: null,
      externalPaymentId: 'refund-1',
      status: 'REFUNDED',
      amount: '50.00',
      currency: 'EUR',
      note: 'goodwill',
      createdAt: '2026-10-01T09:00:00Z',
      actorEmail: 'reception@hotel.test',
    },
  ],
  events: [
    {
      action: 'booking.clock_deposit_posted',
      createdAt: '2026-09-30T21:00:00Z',
      actorEmail: null,
      details: { folioId: 77313833 },
    },
    {
      action: 'payment.refunded',
      createdAt: '2026-10-01T09:00:01Z',
      actorEmail: 'reception@hotel.test',
      details: { amount: { amount: '50.00', currency: 'EUR' }, note: 'goodwill' },
    },
  ],
};

function stubApi(options: { ledgerStatus?: number; capabilities?: string[] } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const respond = (body: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(body), { status }));
      if (url.includes('/payments/bookings/'))
        return options.ledgerStatus === 404 ? respond({}, 404) : respond(ledger);
      if (url.includes('/capabilities/mine'))
        return respond(options.capabilities ?? ['payments.refund']);
      return respond([booking]);
    }),
  );
}

async function renderDetail() {
  const c = document.createElement('div');
  const r = createRoot(c);
  await act(async () => {
    r.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(PaymentDetail, { tenantId: 't', propertyId: 'p', bookingId: 'b1' }),
      ),
    );
  });
  // React only applies updates when an act scope ends, so wait one short act per tick.
  for (let tick = 0; tick < 100; tick += 1) {
    if (c.textContent && !c.textContent.includes('Loading payment')) break;
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });
  }
  return { c, unmount: () => act(async () => r.unmount()) };
}

afterEach(() => vi.unstubAllGlobals());

describe('PaymentDetail', () => {
  it('shows the reference, guest link, badges and summary for the booking', async () => {
    stubApi();
    const { c, unmount } = await renderDetail();
    expect(c.querySelector('h1, h2')?.textContent).toContain('EBR-260930-2258-9WDC');
    const guestLink = Array.from(c.querySelectorAll('a')).find(
      (a) => a.textContent === 'Ada Lovelace',
    )!;
    expect(guestLink.getAttribute('href')).toBe(
      '/dashboard/t?propertyId=p&section=guests&guest=g1',
    );
    expect(c.querySelector('a')?.getAttribute('href')).toBe(
      '/dashboard/t?propertyId=p&section=payments',
    );
    expect(c.textContent).toContain('Confirmed');
    expect(c.textContent).toContain('Partially refunded');
    expect(c.textContent).toContain('250.00 EUR');
    expect(c.textContent).toContain('3 Oct → 4 Oct 2026');
    await unmount();
  });

  it('lists each charge and refund with its sign, actor and note', async () => {
    stubApi();
    const { c, unmount } = await renderDetail();
    const rows = Array.from(c.querySelectorAll('tbody tr')).map((row) => row.textContent ?? '');
    expect(rows[0]).toContain('Payment');
    expect(rows[0]).toContain('+250.00 EUR');
    expect(rows[0]).toContain('PokPay');
    expect(rows[1]).toContain('Refund');
    expect(rows[1]).toContain('−50.00 EUR');
    expect(rows[1]).toContain('reception@hotel.test');
    expect(rows[1]).toContain('goodwill');
    await unmount();
  });

  it('shows the audit activity and explains an open Clock deposit folio', async () => {
    stubApi();
    const { c, unmount } = await renderDetail();
    expect(c.textContent).toContain('Deposit posted to Clock · folio 77313833');
    expect(c.textContent).toContain('Refund recorded · 50.00 EUR · goodwill');
    expect(c.textContent).toContain('Folio 77313833 · Deposit · Open');
    expect(c.textContent).toContain('counts toward the booking balance in Clock');
    await unmount();
  });

  it('offers Refund only with the capability and names the booking in the dialog', async () => {
    stubApi({ capabilities: [] });
    let view = await renderDetail();
    expect(view.c.querySelector('button.must-button--danger')).toBeNull();
    await view.unmount();

    stubApi();
    view = await renderDetail();
    await act(async () => {
      view.c.querySelector<HTMLButtonElement>('button.must-button--danger')!.click();
    });
    const dialog = view.c.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('EBR-260930-2258-9WDC · Ada Lovelace');
    expect(dialog.textContent).toContain('Remaining refundable balance: 200.00 EUR');
    await view.unmount();
  });

  it('says so when the booking is not in this property', async () => {
    stubApi({ ledgerStatus: 404 });
    const { c, unmount } = await renderDetail();
    expect(c.textContent).toContain('Payment not found');
    await unmount();
  });
});
