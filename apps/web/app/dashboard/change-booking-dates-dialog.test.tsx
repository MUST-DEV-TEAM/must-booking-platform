// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ChangeBookingDatesDialog } from './change-booking-dates-dialog';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
it('previews dates, requires a reason, confirms without moving money, retains retry identity, and leaves Clock read-only', async () => {
  const host = document.body.appendChild(document.createElement('div')),
    root = createRoot(host),
    close = vi.fn(),
    saved = vi.fn(async () => {});
  let patches = 0;
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      patches++;
      return new Response(
        JSON.stringify(patches === 1 ? { message: 'Please retry' } : { ok: true }),
        { status: patches === 1 ? 503 : 200 },
      );
    }
    const q = new URL(url, 'http://localhost').searchParams;
    return new Response(
      JSON.stringify({
        startsOn: q.get('startsOn'),
        endsOn: q.get('endsOn'),
        nights: 4,
        available: true,
        oldTotal: '200.00',
        newTotal: '400.00',
        difference: '200.00',
        currency: 'EUR',
        paid: '200.00',
        refunded: '0.00',
        balance: '200.00',
        balanceState: 'due',
        policyNotes: [],
        version: 3,
        previewHash: 'reviewed-hash',
      }),
    );
  });
  vi.stubGlobal('fetch', fetch);
  const props = {
    tenantId: 'tenant',
    propertyId: 'hotel',
    bookingId: 'booking',
    startsOn: '2030-07-10',
    endsOn: '2030-07-12',
    managedInClock: false,
    onClose: close,
    onSaved: saved,
  };
  const button = (text: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === text,
    )!;
  async function value(selector: string, next: string) {
    await act(async () => {
      const input = document.querySelector<HTMLInputElement>(selector)!;
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!.call(
        input,
        next,
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  try {
    await act(async () => root.render(<ChangeBookingDatesDialog {...props} />));
    expect(fetch).not.toHaveBeenCalled();
    await value('#amend-endsOn', '2030-07-14');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });
    expect(document.body.textContent).toContain('The same accommodation is available');
    expect(document.body.textContent).toContain('EUR 400.00');
    expect(document.body.textContent).toContain('No money is moved');
    expect(button('Confirm date change').disabled).toBe(true);
    await value('#amend-reason', 'Guest requested longer stay');
    await act(async () => {
      (document.querySelector('#amend-notify') as HTMLButtonElement).click();
    });
    await act(async () => button('Confirm date change').click());
    expect(document.body.textContent).toContain('Please retry');
    await act(async () => button('Confirm date change').click());
    const calls = fetch.mock.calls.filter(([, init]) => init?.method === 'PATCH');
    expect(calls).toHaveLength(2);
    expect(calls[0]![1]!.headers).toEqual(calls[1]![1]!.headers);
    expect(JSON.parse(calls[1]![1]!.body as string)).toEqual({
      startsOn: '2030-07-10',
      endsOn: '2030-07-14',
      expectedVersion: 3,
      previewHash: 'reviewed-hash',
      reason: 'Guest requested longer stay',
      notifyGuest: true,
    });
    expect(saved).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalled();
    await value('#amend-endsOn', '2030-07-09');
    expect(button('Confirm date change').disabled).toBe(true);
    expect(document.body.textContent).toContain('after check-in');
    await act(async () =>
      root.render(<ChangeBookingDatesDialog key="clock" {...props} managedInClock />),
    );
    expect(document.body.textContent).toContain('Managed in Clock');
    expect(document.querySelector<HTMLInputElement>('#amend-startsOn')?.disabled).toBe(true);
    expect(button('Confirm date change')).toBeUndefined();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
