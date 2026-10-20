// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { EditBookingDetailsDialog } from './edit-booking-details-dialog';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
it('validates fields, retains the key for retry, saves explicitly, and renders Clock read-only', async () => {
  const host = document.body.appendChild(document.createElement('div')),
    root = createRoot(host),
    close = vi.fn(),
    saved = vi.fn(async () => {});
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Please retry' }), { status: 503 }),
    )
    .mockResolvedValue(new Response(JSON.stringify({ ok: true, version: 2 })));
  vi.stubGlobal('fetch', fetch);
  const initial = {
    firstName: 'Ada',
    lastName: 'Guest',
    email: 'bad-email',
    phone: '',
    specialRequests: '',
    estimatedArrivalTime: '18:30',
    adults: 1,
    children: 0,
  };
  const props = {
    tenantId: 'tenant',
    propertyId: 'hotel',
    bookingId: 'booking',
    version: 1,
    initial,
    maxOccupancy: 3,
    managedInClock: false,
    onClose: close,
    onSaved: saved,
  };
  const save = () =>
    [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'Save details',
    )!;
  try {
    await act(async () => root.render(<EditBookingDetailsDialog {...props} />));
    await act(async () => save().click());
    expect(fetch).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Enter a valid guest email');
    const email = document.querySelector<HTMLInputElement>('#edit-email')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        email,
        'edited@example.test',
      );
      email.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => save().click());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Please retry');
    await act(async () => save().click());
    expect(saved).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalled();
    expect(fetch.mock.calls[0]?.[1].headers['Idempotency-Key']).toBe(
      fetch.mock.calls[1]?.[1].headers['Idempotency-Key'],
    );
    expect(JSON.parse(fetch.mock.calls[1]?.[1].body)).toMatchObject({
      email: 'edited@example.test',
      expectedVersion: 1,
      estimatedArrivalTime: '18:30',
    });
    await act(async () =>
      root.render(<EditBookingDetailsDialog key="clock" {...props} managedInClock />),
    );
    expect(document.body.textContent).toContain('Managed in Clock');
    expect(document.querySelector<HTMLInputElement>('#edit-email')?.disabled).toBe(true);
    expect(save()).toBeUndefined();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
