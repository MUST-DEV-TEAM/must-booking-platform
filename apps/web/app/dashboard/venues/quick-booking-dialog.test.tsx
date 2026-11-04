// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { DashboardQueryProvider } from '../query-provider';
import { QuickBookingDialog } from './quick-booking-dialog';

vi.mock('../../../components/ui/time-field', () => ({
  TimeField: ({
    id,
    value,
    onChange,
    label,
  }: {
    id: string;
    value: string;
    onChange: (value: string) => void;
    label: string;
  }) =>
    createElement('input', {
      id,
      value,
      'aria-label': label,
      onChange: (event: { target: { value: string } }) => onChange(event.target.value),
    }),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 120));
const button = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === name,
  )!;
async function click(name: string) {
  await act(async () => {
    button(name).click();
    await settle();
  });
}
async function type(id: string, text: string) {
  await act(async () => {
    const el = document.querySelector<HTMLInputElement>(id)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
  });
}
async function mount(prefilled = false, deposit = false, busyForLongStay = false) {
  const calls: Array<[string, RequestInit | undefined]> = [];
  const close = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      if (url.includes('/availability?'))
        return Response.json({
          date: '2026-12-01',
          partySize: 2,
          diningMinutes: 90,
          reason: null,
          services: [
            {
              name: 'Dinner',
              opensAt: '19:00',
              closesAt: '23:00',
              slots: [
                {
                  time: '19:00',
                  bookable: !(busyForLongStay && url.includes('durationMinutes=120')),
                  past: false,
                  startsAt: '2026-12-01T19:00:00Z',
                  bestTableId: 'table',
                  freeTables: [
                    {
                      id: 'table',
                      label: 'T1',
                      areaId: 'area',
                      areaName: 'Terrace',
                      minSeats: 1,
                      maxSeats: 4,
                    },
                  ],
                },
              ],
            },
          ],
        });
      if (url.includes('/guests?'))
        return Response.json([
          {
            id: 'guest',
            email: 'ari@example.test',
            firstName: 'Ari',
            lastName: 'Guest',
            phone: '+355691234567',
            bookingCount: 2,
          },
        ]);
      if (url.endsWith('/deposit-rules/quote'))
        return Response.json({
          amount: deposit ? '20.00' : '0.00',
          suggestedAmount: deposit ? '20.00' : '0.00',
          currency: 'EUR',
          freeCancelHours: 24,
          canOverride: false,
          quoteHash: 'quote',
          serviceName: 'Dinner',
          areaName: 'Terrace',
        });
      if (url.endsWith('/reservations'))
        return Response.json({
          id: 'reservation',
          status: deposit ? 'pending_payment' : 'confirmed',
          reference: 'R123',
        });
      if (url.includes('/reservations/'))
        return Response.json({ id: 'reservation', status: 'confirmed', reference: 'R123' });
      return Response.json({ id: 'venue', propertyId: 'property', diningMinutes: 90 });
    }),
  );
  root = createRoot(document.body.appendChild(document.createElement('div')));
  await act(async () => {
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(QuickBookingDialog, {
          tenantId: 'tenant',
          venueId: 'venue',
          today: '2026-11-01',
          initialDate: '2026-12-01',
          ...(prefilled
            ? { initialTime: '19:00', initialTableId: 'table', initialAreaId: 'area' }
            : {}),
          onOpenChange: close,
        }),
      ),
    );
    await settle();
  });
  await act(settle);
  await act(settle);
  return { calls, close };
}
it('combines date, guests and clock time, then books with the chosen duration, guest and saved terms', async () => {
  const { calls, close } = await mount();
  expect(document.querySelector('[aria-current="step"]')?.textContent).toContain(
    'Date, guests and time',
  );
  expect(document.querySelector('#booking-date')).not.toBeNull();
  expect(document.querySelector('[aria-label="Guests"]')).not.toBeNull();
  await type('#booking-time', '19:00');
  await click('Continue');
  await act(async () => {
    document.querySelector<HTMLButtonElement>('[aria-label="More duration in minutes"]')!.click();
    await settle();
  });
  expect(calls.some(([url]) => url.includes('durationMinutes=105'))).toBe(true);
  await click('Continue');
  expect(document.body.textContent).toContain('Selected: T1');
  await click('Continue');
  await type('#booking-name', 'Ari');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 450));
  });
  await act(settle);
  const match = [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    b.textContent?.includes('ari@example.test'),
  )!;
  await act(async () => {
    match.click();
    await settle();
  });
  expect(document.querySelector<HTMLInputElement>('#booking-email')?.value).toBe(
    'ari@example.test',
  );
  await click('Continue');
  await act(settle);
  expect(document.body.textContent).toContain('No deposit');
  await click('Book 19:00');
  const sent = calls.find(
    ([url, init]) => url.endsWith('/reservations') && init?.method === 'POST',
  )!;
  expect(JSON.parse(sent[1]!.body as string)).toMatchObject({
    durationMinutes: 105,
    guestName: 'Ari Guest',
    guestEmail: 'ari@example.test',
    tableId: 'table',
    depositQuoteHash: 'quote',
  });
  expect(close).toHaveBeenCalledWith(false);
});
it('checks the entire stay again and prevents choosing a table when a longer visit is unavailable', async () => {
  const { calls } = await mount(true, false, true);
  await click('2 hours');
  await act(settle);
  expect(
    calls.some(([url]) => url.includes('durationMinutes=120') && url.includes('time=19%3A00')),
  ).toBe(true);
  expect(document.body.textContent).toContain('Departure 21:00');
  expect(document.body.textContent).toContain('No table is free for this entire stay');
  expect(button('Continue').disabled).toBe(true);
  await click('1 hour 30 min · usual stay');
  await click('Continue');
  expect(document.body.textContent).toContain('Selected: T1');
});
it('marks date and time complete for an empty calendar cell and preserves the table', async () => {
  await mount(true);
  expect(document.querySelector('[aria-current="step"]')?.textContent).toContain('How long');
  await click('Continue');
  expect(document.body.textContent).toContain('Selected: T1');
});

it('shows the confirmed result after a deposit payment and prevents a second booking from the form', async () => {
  const { close } = await mount(true, true);
  await click('Continue');
  await click('Continue');
  await type('#booking-name', 'Ari');
  await click('Continue');
  await act(settle);
  expect(document.body.textContent).toContain('20.00 EUR deposit');
  await click('Book 19:00');
  await act(settle);
  await act(settle);
  expect(document.body.textContent).toContain('Booking R123 is confirmed.');
  expect(button('Book 19:00')).toBeUndefined();
  await click('Done');
  expect(close).toHaveBeenCalledWith(false);
});
