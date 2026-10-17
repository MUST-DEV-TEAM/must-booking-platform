// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AvailabilityCalendarDialog } from './availability-calendar-dialog';
import { DashboardQueryProvider } from '../query-provider';
import type { RoomType } from './room-management-types';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

const roomType: RoomType = {
  id: 'type-1',
  name: 'Double',
  description: null,
  amenitiesIntro: null,
  mainImageUrl: null,
  galleryImageUrls: [],
  maxOccupancy: 2,
};

function monthDays() {
  const now = new Date();
  const month = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const count = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return {
    month,
    days: Array.from({ length: count }, (_, index) => {
      const date = month + '-' + String(index + 1).padStart(2, '0');
      return { date, isAvailable: true, status: 'available' };
    }),
  };
}

function renderDialog(
  target: Parameters<typeof AvailabilityCalendarDialog>[0]['target'],
  canBlock: boolean,
) {
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(AvailabilityCalendarDialog, {
          tenantId: 'tenant-1',
          propertyId: 'property-1',
          target,
          open: true,
          canBlock,
          onOpenChange: () => undefined,
        }),
      ),
    );
  });
  return { container, root };
}

describe('AvailabilityCalendarDialog', () => {
  it('loads the selected room type month and creates a block through the existing route', async () => {
    const { month, days } = monthDays();
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/availability-calendar?')) return new Response(JSON.stringify({ days }));
      if (url.endsWith('/availability-blocks') && init?.method === undefined)
        return new Response(JSON.stringify([]));
      if (url.endsWith('/availability-blocks') && init?.method === 'POST')
        return new Response(null, { status: 201 });
      return new Response(JSON.stringify({ message: 'Unexpected request' }), { status: 404 });
    });
    vi.stubGlobal('fetch', fetch);
    const { root } = renderDialog({ kind: 'room-type', roomType }, true);
    await act(async () => {
      await vi.waitFor(() => {
        if (!document.body.textContent?.includes('Available'))
          throw new Error('Calendar has not loaded.');
      });
    });

    expect(
      fetch.mock.calls.some(([url]) => String(url).includes('roomTypeId=type-1&month=' + month)),
    ).toBe(true);
    const availableDays = [
      ...document.body.querySelectorAll<HTMLButtonElement>('button[aria-label$=", available"]'),
    ];
    expect(availableDays.length).toBeGreaterThan(1);
    await act(async () => availableDays[0].click());
    await act(async () => availableDays[1].click());
    const blockButton = [...document.body.querySelectorAll('button')].find(
      (button) => button.textContent === 'Block these nights',
    );
    expect(blockButton).toBeDefined();
    await act(async () => (blockButton as HTMLButtonElement).click());
    await act(async () => {
      await vi.waitFor(() => {
        if (!fetch.mock.calls.some(([, init]) => init?.method === 'POST'))
          throw new Error('Block was not submitted.');
      });
    });
    const call = fetch.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
      all: false,
      roomTypeIds: ['type-1'],
      roomIds: [],
    });
    await act(async () => root.unmount());
  });

  it('checks single-room availability and remains read-only without calendar.block', async () => {
    const { days } = monthDays();
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/availability-calendar?')) return new Response(JSON.stringify({ days }));
      if (url.endsWith('/availability-blocks')) return new Response(JSON.stringify([]));
      if (url.includes('/rooms/room-1/availability?'))
        return new Response(JSON.stringify({ isAvailable: true }));
      return new Response(JSON.stringify({ message: 'Unexpected request' }), { status: 404 });
    });
    vi.stubGlobal('fetch', fetch);
    const room = {
      id: 'room-1',
      name: '101',
      title: null,
      roomSize: null,
      rules: null,
      description: null,
      floor: 1,
      viewType: null,
    };
    const { root } = renderDialog({ kind: 'room', room, roomType }, false);
    await act(async () => {
      await vi.waitFor(() => {
        if (!document.body.textContent?.includes('Unavailable'))
          throw new Error('Calendar has not loaded.');
      });
    });
    expect(document.body.textContent).not.toContain('Block these nights');
    const firstAvailable = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label$=", available"]',
    );
    expect(firstAvailable).not.toBeNull();
    await act(async () => firstAvailable?.click());
    await act(async () => {
      await vi.waitFor(() => {
        if (!document.body.textContent?.includes('Selected night: Available'))
          throw new Error('Room day availability has not been checked.');
      });
    });
    expect(
      fetch.mock.calls.some(([url]) => String(url).includes('/rooms/room-1/availability?')),
    ).toBe(true);
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    await act(async () => root.unmount());
  });
});
