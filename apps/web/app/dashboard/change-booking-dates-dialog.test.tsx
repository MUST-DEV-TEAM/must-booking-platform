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
  await click(named('Check-out date'));
  await pause(30);
  await click(named('Choose 14 July 2030'));
  await click(button('Apply'));
  await pause();
}
it('uses the shared calendar, greys booked dates with a focus reason, keeps own nights, auto-previews and preserves retry identity', async () => {
  const fetch = mockFetch(),
    view = await mount();
  try {
    expect(document.querySelector('input[type=date]')).toBeNull();
    await click(named('Check-out date'));
    await pause(30);
    const unavailable = named('Choose 15 July 2030');
    expect(unavailable.getAttribute('aria-disabled')).toBe('true');
    expect(unavailable.className).toContain('line-through');
    expect(named('Choose 11 July 2030').getAttribute('aria-disabled')).toBe('false');
    await act(async () => unavailable.focus());
    await pause(30);
    expect(document.body.textContent).toContain('Booked: another reservation overlaps.');
    await click(unavailable);
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
  'shows permission guidance for a decrease=%s and keeps Clock read-only',
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
      expect(document.body.textContent).toContain('Managed in Clock');
      expect(named('Check-in date').disabled).toBe(true);
      expect(button('Confirm date change')).toBeUndefined();
    } finally {
      await view.dispose();
    }
  },
);
