// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  availabilityBlockDescription,
  bookingsForDay,
  DashboardCalendar,
  type CalendarAvailability,
  type CalendarRow,
} from './calendar';
import { DashboardQueryProvider } from './query-provider';
import type { Reservation } from './reservations';

const roomTypes = [
  { id: 'deluxe', name: 'Deluxe King' },
  { id: 'standard', name: 'Standard Double' },
];
const availability: CalendarAvailability[] = [
  {
    roomTypeId: 'deluxe',
    startsOn: '2026-08-10',
    endsOn: '2026-08-11',
    isAvailable: true,
    availableUnits: 2,
  },
  {
    roomTypeId: 'standard',
    startsOn: '2026-08-10',
    endsOn: '2026-08-11',
    isAvailable: true,
    availableUnits: 1,
  },
  {
    roomTypeId: 'deluxe',
    startsOn: '2026-08-11',
    endsOn: '2026-08-12',
    isAvailable: false,
    availableUnits: 0,
  },
  {
    roomTypeId: 'standard',
    startsOn: '2026-08-11',
    endsOn: '2026-08-12',
    isAvailable: true,
    availableUnits: 2,
  },
];
const reservation = (
  id: string,
  startsOn: string,
  endsOn: string,
  firstName: string,
  status = 'CONFIRMED',
): Reservation => ({
  id,
  guestId: `guest-${id}`,
  guestFirstName: firstName,
  guestLastName: 'Guest',
  guestEmail: `${id}@example.test`,
  guestPhone: null,
  guestStreetAddress: null,
  guestAddressLine2: null,
  guestCity: null,
  guestCounty: null,
  guestPostcode: null,
  roomTypeId: 'deluxe',
  roomTypeName: 'Deluxe King',
  ratePlanId: 'flex',
  ratePlanName: 'Flexible',
  startsOn,
  endsOn,
  status,
  paymentMethod: 'PAY_AT_HOTEL',
  total: { amount: '120.00', currency: 'EUR' },
  externalReference: id,
  version: 1,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
});
const bookings = [
  reservation('arrival', '2026-08-10', '2026-08-12', 'Ada'),
  reservation('departure', '2026-08-08', '2026-08-10', 'Grace'),
  reservation('in-house', '2026-08-09', '2026-08-11', 'Lin'),
  reservation('payment-failed', '2026-08-10', '2026-08-12', 'Failed', 'PAYMENT_FAILED'),
];

/** Selects exactly the given option values in a <select multiple>, firing
 * a real change event the way a person clicking options would. */
function selectMultipleOptions(select: HTMLSelectElement, values: string[]) {
  for (const option of Array.from(select.options)) {
    option.selected = values.includes(option.value);
  }
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('Dashboard calendar', () => {
  const props = {
    tenantId: 'tenant-1',
    propertyId: 'property-1',
    initialMonth: '2026-08',
    initialRoomTypes: roomTypes,
    initialAvailability: availability,
    initialBookings: bookings,
  };

  it('renders a month grid with per-room-type remaining inventory', () => {
    const markup = renderToStaticMarkup(
      createElement(DashboardQueryProvider, undefined, createElement(DashboardCalendar, props)),
    );
    expect(markup).toContain('August 2026');
    expect(markup).toContain('Deluxe King');
    expect(markup).toContain('Standard Double');
    expect(markup).toContain('Sold out');
    expect(markup).not.toContain('Block availability');
  });

  it('walks an Owner/Admin through the block-availability popup: room type, then room, then dates', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        createElement(
          DashboardQueryProvider,
          undefined,
          createElement(DashboardCalendar, {
            ...props,
            bookingMode: 'MIXED' as const,
            canManageAvailability: true,
            initialBlocks: [],
            initialRooms: [{ id: 'deluxe-101', name: '101', roomTypeId: 'deluxe' }],
            initialRows: [
              {
                id: 'deluxe-101',
                label: '101',
                totalUnits: 1,
                availableByDate: { '2026-08-10': 1, '2026-08-11': 0 },
              },
            ] satisfies CalendarRow[],
          }),
        ),
      ),
    );

    const findButton = (text: string) =>
      Array.from(container.querySelectorAll('button')).find((button) =>
        button.textContent?.includes(text),
      );

    // Not shown until opened.
    expect(container.textContent).not.toContain('Block all room types');

    await act(async () => findButton('Block availability')!.click());
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
      'which room types?',
    );
    expect(container.textContent).toContain('All room types');
    expect(container.textContent).toContain('Room types to block');

    await act(async () => {
      selectMultipleOptions(container.querySelector('#block-room-types') as HTMLSelectElement, [
        'deluxe',
      ]);
    });
    await act(async () => findButton('Next')!.click());

    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('which rooms?');
    expect(container.textContent).toContain('Deluxe King — 101');

    await act(async () => findButton('Next')!.click());

    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('which nights?');
    expect(container.textContent).toContain('Choose the first and last unavailable night.');

    await act(async () => root.unmount());
    container.remove();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('blocking a specific room sends only that room, never the whole room type it belongs to', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    let postedBody: unknown;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/tenants/tenant-1/properties/property-1/availability-blocks' && init?.method === 'POST') {
        postedBody = JSON.parse(init.body as string);
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'block-1', ...postedBody }), { status: 200 }),
        );
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        createElement(
          DashboardQueryProvider,
          undefined,
          createElement(DashboardCalendar, {
            ...props,
            bookingMode: 'MIXED' as const,
            canManageAvailability: true,
            initialBlocks: [],
            initialRooms: [
              { id: 'deluxe-101', name: '101', roomTypeId: 'deluxe' },
              { id: 'deluxe-102', name: '102', roomTypeId: 'deluxe' },
            ],
            initialRows: [
              {
                id: 'deluxe-101',
                label: '101',
                totalUnits: 1,
                availableByDate: { '2026-08-10': 1 },
              },
              {
                id: 'deluxe-102',
                label: '102',
                totalUnits: 1,
                availableByDate: { '2026-08-10': 1 },
              },
            ] satisfies CalendarRow[],
          }),
        ),
      ),
    );

    const findButton = (text: string) =>
      Array.from(container.querySelectorAll('button')).find((button) =>
        button.textContent?.includes(text),
      );

    await act(async () => findButton('Block availability')!.click());
    await act(async () => {
      selectMultipleOptions(container.querySelector('#block-room-types') as HTMLSelectElement, [
        'deluxe',
      ]);
    });
    await act(async () => findButton('Next')!.click());
    // Pick only room 101, leaving 102 unblocked.
    await act(async () => {
      selectMultipleOptions(container.querySelector('#block-rooms') as HTMLSelectElement, [
        'deluxe-101',
      ]);
    });
    await act(async () => findButton('Next')!.click());

    const [start, end] = Array.from(
      container.querySelectorAll('.rdp-day_button:not(.rdp-outside)'),
    ) as HTMLElement[];
    await act(async () => start.click());
    await act(async () => end.click());
    await act(async () => findButton('Create availability block')!.click());

    expect(postedBody).toMatchObject({ roomIds: ['deluxe-101'], roomTypeIds: [] });

    await act(async () => root.unmount());
    container.remove();
  });

  it('shows existing blocks that already cover the targeted room before creating a new one', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (
        url === '/api/tenants/tenant-1/properties/property-1/availability-blocks/existing-block' &&
        init?.method === 'DELETE'
      )
        return Promise.resolve(new Response(null, { status: 204 }));
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        createElement(
          DashboardQueryProvider,
          undefined,
          createElement(DashboardCalendar, {
            ...props,
            bookingMode: 'MIXED' as const,
            canManageAvailability: true,
            initialBlocks: [
              {
                id: 'existing-block',
                startsOn: '2026-08-15',
                endsOn: '2026-08-17',
                all: false,
                roomTypeIds: [],
                roomIds: ['deluxe-101'],
              },
            ],
            initialRooms: [{ id: 'deluxe-101', name: '101', roomTypeId: 'deluxe' }],
            initialRows: [
              {
                id: 'deluxe-101',
                label: '101',
                totalUnits: 1,
                availableByDate: { '2026-08-10': 1 },
              },
            ] satisfies CalendarRow[],
          }),
        ),
      ),
    );

    const findButton = (text: string) =>
      Array.from(container.querySelectorAll('button')).find((button) =>
        button.textContent?.includes(text),
      );

    await act(async () => findButton('Block availability')!.click());
    await act(async () => {
      selectMultipleOptions(container.querySelector('#block-room-types') as HTMLSelectElement, [
        'deluxe',
      ]);
    });
    await act(async () => findButton('Next')!.click());
    await act(async () => {
      selectMultipleOptions(container.querySelector('#block-rooms') as HTMLSelectElement, [
        'deluxe-101',
      ]);
    });
    await act(async () => findButton('Next')!.click());

    expect(container.textContent).toContain('Already blocked');
    expect(container.textContent).toContain('Deluxe King — 101');

    // The already-blocked nights are disabled on the mini calendar itself,
    // not just listed above it.
    const dayButtons = Array.from(
      container.querySelectorAll('.rdp-day_button'),
    ) as HTMLButtonElement[];
    const blockedDayButton = dayButtons.find((button) => button.textContent === '16');
    expect(blockedDayButton?.disabled).toBe(true);
    const openDayButton = dayButtons.find((button) => button.textContent === '5');
    expect(openDayButton?.disabled).toBe(false);

    // Removing it from inside the dialog uses the same delete action as
    // before, just relocated here instead of a separate page section.
    await act(async () => findButton('Remove')!.click());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/tenants/tenant-1/properties/property-1/availability-blocks/existing-block',
      expect.objectContaining({ method: 'DELETE' }),
    );

    await act(async () => root.unmount());
    container.remove();
  });

  it('classifies arrivals, departures, and in-house bookings for a selected day', () => {
    const day = bookingsForDay(bookings, '2026-08-10');
    expect(day.arrivals).toEqual([bookings[0]]);
    expect(day.departures).toEqual([bookings[1]]);
    expect(day.inHouse).toEqual([bookings[2]]);
    expect([...day.arrivals, ...day.departures, ...day.inHouse]).not.toContain(bookings[3]);
  });

  it('describes an existing block with its dates and targets for calendar staff', () => {
    expect(
      availabilityBlockDescription(
        {
          id: 'block-1',
          startsOn: '2026-08-10',
          endsOn: '2026-08-12',
          all: false,
          roomTypeIds: ['deluxe'],
          roomIds: ['room-101'],
        },
        {
          roomTypes: [{ id: 'deluxe', name: 'Deluxe King' }],
          rooms: [{ id: 'room-101', name: '101', roomTypeId: 'deluxe' }],
          availability: [],
        },
      ),
    ).toContain('Deluxe King — 101');
  });

  it('opens a read-only day drill-in from the month grid', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        createElement(DashboardQueryProvider, undefined, createElement(DashboardCalendar, props)),
      ),
    );
    await act(async () => container.querySelector('button[aria-label="Open 2026-08-10"]')!.click());
    const drillIn = container.querySelector('[aria-label="Day bookings"]');
    expect(drillIn?.textContent).toContain('Arrivals (1)');
    expect(drillIn?.textContent).toContain('Departures (1)');
    expect(drillIn?.textContent).toContain('In house (1)');
    expect(drillIn?.textContent).not.toContain('Failed Guest');
    expect(drillIn?.textContent).toContain('Read-only operational view');
    await act(async () => root.unmount());
    container.remove();
  });
});
