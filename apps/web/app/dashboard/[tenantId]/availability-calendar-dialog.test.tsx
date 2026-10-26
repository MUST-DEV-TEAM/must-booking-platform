// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AvailabilityCalendarDialog } from './availability-calendar-dialog';
import { DashboardQueryProvider } from '../query-provider';
import type { RoomType } from './room-management-types';
import { addDays } from '../../../lib/calendar-board';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  window.history.replaceState({}, '', '/');
  window.localStorage.clear();
});
const today = (() => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
})();
const roomType: RoomType = {
  id: 'type-1',
  name: 'Double',
  description: null,
  amenitiesIntro: null,
  mainImageUrl: null,
  galleryImageUrls: [],
  maxOccupancy: 2,
  status: 'PUBLISHED',
};
const room = {
  id: 'room-1',
  name: '101',
  title: null,
  roomSize: null,
  rules: null,
  description: null,
  floor: 1,
  viewType: null,
  isActive: true,
};
async function mount({
  single = false,
  canBlock = true,
  canCreateBooking = true,
  violation,
  scopedLimits,
  bookingOnly = false,
}: {
  single?: boolean;
  canBlock?: boolean;
  canCreateBooking?: boolean;
  violation?: { code: string; message: string };
  scopedLimits?: { min: number; max: number };
  bookingOnly?: boolean;
} = {}) {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const json = (data: unknown) => new Response(JSON.stringify(data));
    // The board only offers blocking for a hotel whose stock MUST owns, so these tests run as one.
    if (url.endsWith('/pms-connection-status')) return json({ provider: 'LOCAL' });
    if (url.includes('/booking-rules/evaluate')) {
      const selected = new URL(url, 'http://localhost').searchParams.has('startsOn');
      const result = {
        valid: selected && !violation,
        errors: selected && violation ? [violation] : [],
      };
      return json({
        today,
        minStayNights: selected && scopedLimits ? scopedLimits.min : 2,
        maxStayNights: selected && scopedLimits ? scopedLimits.max : 5,
        disabledDates: [addDays(today, -1)],
        pastDateMessage: 'Check-in cannot be in the past.',
        booking: result,
        block: bookingOnly ? { valid: selected, errors: [] } : result,
      });
    }
    if (url.includes('/bookings/board')) return json({ items: [], truncated: false });
    if (url.endsWith('/room-types')) return json([{ ...roomType, roomCount: 2 }]);
    if (url.endsWith('/rooms'))
      return json([
        { ...room, roomTypeId: 'type-1', roomTypeName: 'Double' },
        { ...room, id: 'room-2', name: '102', roomTypeId: 'type-1', roomTypeName: 'Double' },
      ]);
    return json([]);
  });
  vi.stubGlobal('fetch', fetch);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(AvailabilityCalendarDialog, {
          tenantId: 'tenant-1',
          propertyId: 'property-1',
          target: single ? { kind: 'room', room, roomType } : { kind: 'room-type', roomType },
          open: true,
          canBlock,
          canCreateBooking,
          onOpenChange: vi.fn(),
        }),
      ),
    ),
  );
  await act(async () => {
    await vi.waitFor(() =>
      expect(document.body.querySelector(`[aria-label="Select 101 ${today}"]`)).not.toBeNull(),
    );
  });
  return fetch;
}
async function select(day: string) {
  await act(async () =>
    document.body.querySelector<HTMLButtonElement>(`[aria-label="Select 101 ${day}"]`)!.click(),
  );
}

describe('AvailabilityCalendarDialog shared board', () => {
  it('shows every room for a type and keeps a single room target fixed', async () => {
    await mount();
    expect(document.body.querySelector(`[aria-label="Select 102 ${today}"]`)).not.toBeNull();
    expect(document.body.textContent).toContain('minimum 2 nights; maximum 5 nights');
    await act(async () => roots.splice(0).forEach((root) => root.unmount()));
    await mount({ single: true });
    expect(document.body.querySelector(`[aria-label="Select 102 ${today}"]`)).toBeNull();
  });
  it('disables past days and remains read-only without action capabilities', async () => {
    await mount({ canBlock: false, canCreateBooking: false });
    expect(
      document.body.querySelector<HTMLButtonElement>(
        `[aria-label="Select 101 ${addDays(today, -1)}"]`,
      )?.disabled,
    ).toBe(true);
    expect(
      document.body.querySelector<HTMLButtonElement>(`[aria-label="Select 101 ${today}"]`)
        ?.disabled,
    ).toBe(true);
    expect(document.body.textContent).toContain('Check-in cannot be in the past.');
    expect(document.body.textContent).not.toContain('New booking');
    expect(document.body.textContent).not.toContain('Block these nights');
  });
  it('prefills the existing booking flow from a selected room and date range', async () => {
    const fetch = await mount({ single: true });
    await select(today);
    await select(addDays(today, 1));
    await act(async () => {
      await vi.waitFor(() =>
        expect(document.body.querySelector('a[href*="roomId=room-1"]')).not.toBeNull(),
      );
    });
    const link = document.body.querySelector('a[href*="roomId=room-1"]')!;
    expect(link.getAttribute('href')).toContain(`start=${today}&end=${addDays(today, 2)}`);
    expect(
      fetch.mock.calls.some(
        ([url]) =>
          String(url).includes('roomId=room-1') && String(url).includes('booking-rules/evaluate'),
      ),
    ).toBe(true);
  });
  it('uses the server-selected stay limits for the header and night stepper', async () => {
    await mount({ scopedLimits: { min: 1, max: 7 } });
    await select(today);
    await act(async () => {
      await vi.waitFor(() =>
        expect(document.body.textContent).toContain('minimum 1 nights; maximum 7 nights'),
      );
    });
    for (let i = 0; i < 6; i++) {
      await act(async () =>
        document.body.querySelector<HTMLButtonElement>('[aria-label="More nights"]')!.click(),
      );
      await act(async () => {
        await vi.waitFor(() =>
          expect(
            document.body.querySelector(`a[href*="end=${addDays(today, i + 2)}"]`),
          ).not.toBeNull(),
        );
      });
    }
    expect(
      document.body.querySelector<HTMLButtonElement>('[aria-label="More nights"]')!.disabled,
    ).toBe(true);
    await act(async () => {
      await vi.waitFor(() =>
        expect(document.body.querySelector(`a[href*="end=${addDays(today, 7)}"]`)).not.toBeNull(),
      );
    });
  });
  it.each([
    'MIN_STAY',
    'MAX_STAY',
    'CLOSED_TO_ARRIVAL',
    'CLOSED_TO_DEPARTURE',
    'STOP_SELL',
    'MINIMUM_ADVANCE',
    'RESTRICTION_PRIORITY_CONFLICT',
  ])('keeps blocking available when only booking is rejected by %s', async (code) => {
    await mount({
      violation: { code, message: `Restriction rejected: ${code}` },
      bookingOnly: true,
    });
    await select(today);
    await act(async () => {
      await vi.waitFor(() =>
        expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(code),
      );
    });
    const booking = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent === 'New booking',
    )!;
    const block = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Block these nights',
    )!;
    expect(booking.disabled).toBe(true);
    expect(block.disabled).toBe(false);
  });
  it.each([
    ['MIN_STAY', 'A minimum stay of 2 nights is required.'],
    ['MAX_STAY', 'A maximum stay of 5 nights is allowed.'],
    ['BOOKING_CONFLICT', 'The selected range overlaps an existing reservation.'],
    ['AVAILABILITY_BLOCK_CONFLICT', 'The selected range overlaps an availability block.'],
    ['CHECK_IN_PAST', 'Check-in cannot be in the past.'],
    ['INVALID_RANGE', 'End date must be after start date.'],
  ])('shows the server %s message and disables actions', async (code, message) => {
    await mount({ violation: { code, message } });
    await select(today);
    await act(async () => {
      await vi.waitFor(() =>
        expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(message),
      );
    });
    const actions = [...document.body.querySelectorAll('button')].filter(
      (button) =>
        button.textContent === 'New booking' || button.textContent?.trim() === 'Block these nights',
    );
    expect(actions).toHaveLength(2);
    expect(actions.every((button) => button.disabled)).toBe(true);
  });
});
