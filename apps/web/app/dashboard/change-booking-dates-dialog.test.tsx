// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ChangeBookingDatesDialog } from './change-booking-dates-dialog';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView = vi.fn();
const props = {
  tenantId: 'tenant',
  propertyId: 'hotel',
  bookingId: 'booking',
  startsOn: '2030-07-10',
  endsOn: '2030-07-12',
  managedInClock: false,
  onClose: vi.fn(),
  onSaved: vi.fn(async () => {}),
};
const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text)!;
const named = (label: string) =>
  document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
async function click(b: HTMLElement) {
  await act(async () => b.click());
}
async function pause(ms = 320) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
async function value(selector: string, next: string) {
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>(selector)!;
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!.call(input, next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function mockFetch(canRefund = true, decrease = false) {
  let patches = 0;
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH')
      return new Response(
        JSON.stringify(++patches === 1 ? { message: 'Please retry' } : { ok: true }),
        { status: patches === 1 ? 503 : 200 },
      );
    const q = new URL(url, 'http://localhost').searchParams;
    if (url.includes('amend-calendar')) {
      const days = [];
      for (
        let date = q.get('from')!;
        date < q.get('to')!;
        date = new Date(Date.parse(date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10)
      )
        days.push({
          date,
          disabled: date === '2030-07-15',
          reason: date === '2030-07-15' ? 'Booked: another reservation overlaps.' : null,
        });
      return new Response(JSON.stringify({ days }));
    }
    const outcome =
      q.get('outcome') ?? (decrease ? (canRefund ? 'refund' : 'refund_due') : 'charge');
    return new Response(
      JSON.stringify({
        startsOn: q.get('startsOn'),
        endsOn: q.get('endsOn'),
        nights: 4,
        available: true,
        oldTotal: '200.00',
        newTotal: decrease ? '100.00' : '400.00',
        recordedTotal: outcome === 'waive' ? '200.00' : decrease ? '100.00' : '400.00',
        difference: decrease ? '-100.00' : '200.00',
        currency: 'EUR',
        paid: '200.00',
        refunded: '0.00',
        balance: '200.00',
        balanceState: 'due',
        policyNotes: [],
        version: 3,
        previewHash: 'hash-' + outcome + '-' + q.get('outcomeReason'),
        outcome,
        outcomeReason: q.get('outcomeReason') ?? '',
        canRefund,
        refundToIssue: '0.00',
        availableOutcomes: decrease
          ? canRefund
            ? ['refund', 'no_refund', 'refund_due']
            : ['refund_due']
          : canRefund
            ? ['charge', 'waive']
            : ['charge'],
      }),
    );
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
async function mount() {
  const host = document.body.appendChild(document.createElement('div')),
    root = createRoot(host);
  await act(async () => root.render(<ChangeBookingDatesDialog {...props} />));
  return {
    root,
    dispose: async () => {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    },
  };
}
async function changeCheckout() {
  await click(named('Stay dates'));
  await pause(30);
  await click(named('Choose 10 July 2030'));
  await click(named('Choose 14 July 2030'));
  await click(button('Apply'));
  await pause();
}
it('uses a single stay-range calendar, auto-previews and preserves retry identity', async () => {
  const fetch = mockFetch(),
    view = await mount();
  try {
    expect(document.querySelector('input[type=date]')).toBeNull();
    await click(named('Stay dates'));
    await pause(30);
    await click(named('Choose 10 July 2030'));
    await click(named('Choose 14 July 2030'));
    await click(button('Apply'));
    expect(fetch.mock.calls.filter(([url]) => url.includes('amend-preview'))).toHaveLength(0);
    await pause();
    expect(fetch.mock.calls.filter(([url]) => url.includes('amend-preview'))).toHaveLength(1);
    expect(document.body.textContent).toContain('EUR 400.00');
    expect(document.body.textContent).toContain('No card is charged automatically');
    expect(button('Check dates again')).toBeUndefined();
    expect(button('Confirm date change').disabled).toBe(true);
    await value('#amend-reason', 'Guest requested longer stay');
    await click(button('Confirm date change'));
    await click(button('Confirm date change'));
    const calls = fetch.mock.calls.filter(([, init]) => init?.method === 'PATCH');
    expect(calls).toHaveLength(2);
    expect(calls[0]![1]!.headers).toEqual(calls[1]![1]!.headers);
    expect(JSON.parse(calls[1]![1]!.body as string)).toMatchObject({
      startsOn: '2030-07-10',
      endsOn: '2030-07-14',
      outcome: 'charge',
      outcomeReason: '',
      previewHash: 'hash-charge-',
      expectedVersion: 3,
    });
  } finally {
    await view.dispose();
  }
});
it('refreshes the hash when staff choose waive and requires the price-decision reason', async () => {
  const fetch = mockFetch(),
    view = await mount();
  try {
    await changeCheckout();
    await value('#amend-reason', 'Extend stay');
    const trigger = document.querySelector<HTMLElement>('#amend-outcome')!;
    await act(async () =>
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })),
    );
    await pause(20);
    const option = [...document.querySelectorAll<HTMLElement>('[role=option]')].find(
      (o) => o.textContent === 'Waive the difference',
    )!;
    await act(async () =>
      option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
    );
    expect(button('Confirm date change').disabled).toBe(true);
    await pause();
    expect(document.querySelector('#amend-outcome-reason')).not.toBeNull();
    await value('#amend-outcome-reason', 'Honor the original price');
    expect(button('Confirm date change').disabled).toBe(true);
    await pause();
    await click(button('Confirm date change'));
    const call = fetch.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(JSON.parse(call[1]!.body as string)).toMatchObject({
      outcome: 'waive',
      outcomeReason: 'Honor the original price',
      previewHash: 'hash-waive-Honor the original price',
    });
    expect(document.body.textContent).toContain('keeps its old agreed total');
  } finally {
    await view.dispose();
  }
});
it.each([false, true])(
  'shows permission guidance for a decrease=%s and requires terms review for Clock',
  async (decrease) => {
    mockFetch(false, decrease);
    const view = await mount();
    try {
      await changeCheckout();
      expect(document.querySelector('#amend-outcome')).toBeNull();
      expect(document.body.textContent).toContain('Refund permission is required');
      expect(document.body.textContent).toContain(
        decrease ? 'Refund due for a manager' : 'required to waive the price increase',
      );
      await act(async () =>
        view.root.render(<ChangeBookingDatesDialog key="clock" {...props} managedInClock />),
      );
      await pause();
      expect(document.body.textContent).toContain('Clock rechecks the original rate');
      expect(named('Stay dates').disabled).toBe(false);
      expect(button('Confirm date change').disabled).toBe(true);
      expect(document.querySelector('#amend-terms')).not.toBeNull();
    } finally {
      await view.dispose();
    }
  },
);

it.each(['refund', 'payment'] as const)(
  'saves the Clock amendment before opening the separate %s review',
  async (followUp) => {
    const onReviewRefund = vi.fn(),
      onCollectPayment = vi.fn(),
      onSaved = vi.fn(async () => {});
    let patches = 0;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/amend-status')) return Response.json({ pending: false });
      if (init?.method === 'PATCH') {
        patches++;
        return Response.json(
          patches === 1
            ? { ok: false, error: { message: 'Stay update needs review' } }
            : { ok: true },
        );
      }
      if (url.includes('amend-calendar')) return Response.json({ days: [] });
      const q = new URL(url, 'http://localhost').searchParams;
      return Response.json({
        startsOn: q.get('startsOn'),
        endsOn: q.get('endsOn'),
        nights: 4,
        available: true,
        oldTotal: '1000.00',
        newTotal: followUp === 'refund' ? '500.00' : '1250.00',
        recordedTotal: followUp === 'refund' ? '500.00' : '1250.00',
        paid: '1000.00',
        refunded: '0.00',
        difference: followUp === 'refund' ? '-500.00' : '250.00',
        balance: followUp === 'refund' ? '-500.00' : '250.00',
        balanceState: followUp === 'refund' ? 'refund_due' : 'due',
        currency: 'EUR',
        version: 2,
        previewHash: 'reviewed-preview',
        outcome: 'refund_due',
        canRefund: false,
        policyNotes: [],
      });
    });
    vi.stubGlobal('fetch', fetcher);
    const host = document.body.appendChild(document.createElement('div')),
      root = createRoot(host);
    await act(async () =>
      root.render(
        <ChangeBookingDatesDialog
          {...props}
          managedInClock
          onSaved={onSaved}
          onReviewRefund={onReviewRefund}
          onCollectPayment={onCollectPayment}
        />,
      ),
    );
    try {
      await changeCheckout();
      await pause(600);
      await value('#amend-reason', 'Guest requested revised stay');
      await click(document.querySelector<HTMLElement>('#amend-terms')!);
      const label = followUp === 'refund' ? 'Confirm & review refund' : 'Confirm & choose payment';
      expect(
        button(followUp === 'refund' ? 'Confirm & refund later' : 'Confirm & collect later'),
      ).toBeTruthy();
      await click(button(label));
      expect(onReviewRefund).not.toHaveBeenCalled();
      expect(onCollectPayment).not.toHaveBeenCalled();
      expect(onSaved).not.toHaveBeenCalled();
      await click(button(label));
      expect(onSaved).toHaveBeenCalledOnce();
      if (followUp === 'refund') expect(onReviewRefund).toHaveBeenCalledWith('500.00');
      else expect(onCollectPayment).toHaveBeenCalledOnce();
      expect(
        fetcher.mock.calls.every(
          ([url]) => !url.includes('/payments/refunds') && !url.endsWith('/collect-pokpay'),
        ),
      ).toBe(true);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  },
);
