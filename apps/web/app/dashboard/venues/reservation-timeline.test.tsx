// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { DashboardQueryProvider } from '../query-provider';
import { ReservationTimeline } from './reservation-timeline';
import type { Reservation } from './reservation-api';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.replaceChildren();
});

it('opens today at the current quarter hour in the restaurant timezone and other days at opening', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-12-01T11:07:00Z'));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      Response.json(
        url.endsWith('/services')
          ? [
              {
                name: 'Lunch',
                days: [1, 2, 3, 4, 5, 6, 7],
                opensAt: '09:00',
                closesAt: '17:00',
                slotMinutes: 30,
              },
            ]
          : { areas: [] },
      ),
    ),
  );
  root = createRoot(document.body.appendChild(document.createElement('div')));
  const render = async (date: string) => {
    await act(async () => {
      root.render(
        createElement(
          DashboardQueryProvider,
          undefined,
          createElement(ReservationTimeline, {
            tenantId: 't',
            venueId: 'v',
            timezone: 'Europe/Tirane',
            date,
            reservations: [],
          }),
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
  };
  await render('2026-12-01');
  expect(document.querySelector('[aria-label="Reservation calendar"]')?.scrollLeft).toBe(12 * 64);
  await render('2026-12-02');
  expect(document.querySelector('[aria-label="Reservation calendar"]')?.scrollLeft).toBe(0);
});
it('shows real service hours, duration blocks, area groups, and calendar booking actions', async () => {
  const onEmpty = vi.fn(),
    onBooking = vi.fn();
  const booking = {
    id: 'r',
    guestName: 'Ari',
    partySize: 2,
    status: 'confirmed',
    startsAt: '2026-12-01T19:30:00Z',
    endsAt: '2026-12-01T21:00:00Z',
    tables: [{ id: 't' }],
  } as Reservation;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      Response.json(
        url.endsWith('/services')
          ? [
              {
                name: 'Dinner',
                days: [1, 2, 3, 4, 5, 6, 7],
                opensAt: '19:00',
                closesAt: '22:00',
                slotMinutes: 30,
              },
            ]
          : {
              areas: [
                {
                  id: 'a',
                  name: 'Terrace',
                  active: true,
                  tables: [
                    { id: 't', areaId: 'a', label: 'T1', minSeats: 1, maxSeats: 4, active: true },
                  ],
                },
              ],
            },
      ),
    ),
  );
  root = createRoot(document.body.appendChild(document.createElement('div')));
  const settle = () => new Promise((resolve) => setTimeout(resolve, 150));
  await act(async () => {
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(ReservationTimeline, {
          tenantId: 'tenant',
          venueId: 'venue',
          timezone: 'UTC',
          date: '2026-12-01',
          reservations: [booking],
          onEmpty,
          onBooking,
        }),
      ),
    );
    await settle();
  });
  await act(settle);
  await act(settle);
  expect(document.querySelector('[aria-label="Terrace"]')).not.toBeNull();
  const block = document.querySelector<HTMLButtonElement>('[aria-label="Ari, 19:30-21:00"]')!;
  expect(block.style.width).toBe('384px'); // Six quarter-hour columns.
  expect(
    document.querySelector<HTMLButtonElement>('[aria-label="Book T1 at 20:00"]')?.disabled,
  ).toBe(true);
  expect(document.querySelector('[aria-label="Book T1 at 12:00"]')).toBeNull();
  await act(async () => {
    document.querySelector<HTMLButtonElement>('[aria-label="Book T1 at 19:15"]')!.click();
  });
  expect(onEmpty).toHaveBeenCalledWith({
    date: '2026-12-01',
    time: '19:15',
    tableId: 't',
    areaId: 'a',
    partySize: 2,
  });
  await act(async () => block.click());
  expect(onBooking).toHaveBeenCalledWith(booking);
});
