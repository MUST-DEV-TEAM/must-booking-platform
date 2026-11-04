// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, it, expect, vi } from 'vitest';
import { DashboardQueryProvider } from '../query-provider';
import { LiveFloorPanel } from './live-floor-panel';
import { dateInZone } from './reservation-display';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 15));
};
async function mount(closed = false) {
  const calls: string[] = [];
  const date = dateInZone('UTC');
  const booking = {
    id: 'r',
    reference: 'R123',
    status: 'confirmed',
    guestName: 'Ari',
    partySize: 2,
    startsAt: `${date}T19:15:00Z`,
    endsAt: `${date}T20:45:00Z`,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      if (url.endsWith('/services'))
        return Response.json(
          closed
            ? []
            : [
                {
                  name: 'Dinner',
                  days: [1, 2, 3, 4, 5, 6, 7],
                  opensAt: '19:00',
                  closesAt: '21:00',
                  slotMinutes: 30,
                },
              ],
        );
      const params = new URL(url, 'http://localhost').searchParams;
      const from = params.get('from');
      const overlaps =
        from &&
        Date.parse(booking.startsAt) < Date.parse(params.get('to')!) &&
        Date.parse(booking.endsAt) > Date.parse(from);
      return Response.json({
        at: params.get('at') ?? from ?? `${date}T18:00:00Z`,
        timezone: 'UTC',
        areas: [
          {
            id: 'a',
            name: 'Terrace',
            mapWidth: 1000,
            mapHeight: 700,
            tables: [
              {
                id: 't1',
                areaId: 'a',
                label: 'T1',
                minSeats: 1,
                maxSeats: 4,
                mapX: 10,
                mapY: 10,
                mapWidth: 80,
                mapHeight: 80,
                shape: 'square',
                active: true,
                status: 'free',
                current: null,
                next: null,
                bookings: overlaps ? [booking] : [],
              },
            ],
          },
        ],
      });
    }),
  );
  root = createRoot(document.body.appendChild(document.createElement('div')));
  await act(async () => {
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(LiveFloorPanel, { tenantId: 'tenant', venueId: 'venue', timezone: 'UTC' }),
      ),
    );
    await settle();
  });
  await act(settle);
  await act(settle);
  return calls;
}
async function click(label: string, modifiers: MouseEventInit = {}) {
  await act(async () => {
    document
      .querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, ...modifiers }));
    await settle();
  });
  await act(settle);
}
it('uses actual service columns and keeps single-moment at working', async () => {
  const calls = await mount();
  expect(document.querySelector('[type="range"]')).toBeNull();
  expect(document.querySelector('[aria-label="Dinner 19:00"]')).not.toBeNull();
  expect(document.querySelector('[aria-label="Dinner 21:00"]')).toBeNull();
  await click('Dinner 19:15');
  expect(
    calls.some((url) => new URL(url, 'http://localhost').searchParams.get('at')?.includes('19:15')),
  ).toBe(true);
});
it('shows whole-period bookings and queries Ctrl selections as separate periods', async () => {
  const calls = await mount();
  await click('Dinner 19:00');
  await click('Dinner 19:30', { shiftKey: true });
  const period = calls
    .map((url) => new URL(url, 'http://localhost'))
    .find(
      (url) =>
        url.searchParams.get('from')?.includes('19:00') &&
        url.searchParams.get('to')?.includes('19:45'),
    );
  expect(period).toBeDefined();
  await click('T1, 1 to 4 seats');
  expect(document.body.textContent).toContain('Ari');
  expect(document.body.textContent).toContain('19:15-20:45');
  await click('Dinner 19:00');
  await click('Dinner 20:45', { ctrlKey: true });
  expect(
    calls.some((url) =>
      new URL(url, 'http://localhost').searchParams.get('from')?.includes('20:45'),
    ),
  ).toBe(true);
  expect(document.body.textContent).not.toContain('Ari');
  expect(document.body.textContent).toContain('Free for the whole selected period.');
});
it('explains closed days and retains the date picker', async () => {
  await mount(true);
  expect(document.body.textContent).toContain('Closed on this day.');
  expect(document.querySelector('[aria-label^="Floor date"]')).not.toBeNull();
});
