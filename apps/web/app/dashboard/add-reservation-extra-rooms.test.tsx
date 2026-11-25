// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HotelMoneyProvider } from '../../lib/hotel-money-scope';
import { ExtraRoomsCard, newExtraRoom, type ExtraRoom } from './add-reservation-extra-rooms';
import { DashboardQueryProvider } from './query-provider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopObserver as unknown as typeof ResizeObserver;

afterEach(() => vi.unstubAllGlobals());

const roomTypes = [
  { id: 'garden', name: 'Garden Suite' },
  { id: 'sea', name: 'Sea Suite' },
];

function Harness({ disabledReason = null }: { disabledReason?: string | null }) {
  const [rooms, setRooms] = useState<ExtraRoom[]>([]);
  return createElement(ExtraRoomsCard, {
    base: '/api/tenants/t/properties/p',
    roomTypes,
    startsOn: '2027-06-01',
    endsOn: '2027-06-03',
    ratePlanId: 'rate-1',
    isClock: false,
    rooms,
    onChange: setRooms,
    disabledReason,
  });
}

async function mount(disabledReason?: string | null) {
  const requests: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(body);
      const key = (body.items as Array<{ key: string }>)[0]!.key;
      return {
        ok: true,
        json: async () => ({
          offers: { [key]: { ok: true, total: { amount: '190.00', currency: 'EUR' } } },
        }),
      };
    }),
  );
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(HotelMoneyProvider, {
          tenantId: 't',
          propertyId: 'p',
          currency: 'EUR',
          children: createElement(Harness, { disabledReason }),
        }),
      ),
    );
  });
  return { container, root, requests };
}

const click = async (element: Element | undefined) => {
  await act(async () => (element as HTMLElement).click());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
};

describe('ExtraRoomsCard (multi-room reservation)', () => {
  it('adds a room with its own party, checks it for the same dates and removes it', async () => {
    const view = await mount();
    const add = [...view.container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Add another room'),
    );
    await click(add);
    expect(view.container.textContent).toContain('Room 2');
    expect(view.container.textContent).toContain('Available');
    // The room is checked with its own party for the stay's dates.
    expect(view.requests.at(-1)).toMatchObject({
      startsOn: '2027-06-01',
      endsOn: '2027-06-03',
      adults: 2,
      children: 0,
      items: [{ key: 'garden', roomTypeId: 'garden', ratePlanId: 'rate-1' }],
    });

    await click(view.container.querySelector('[aria-label="Remove room 2"]')!);
    expect(view.container.textContent).not.toContain('Room 2');
    await act(async () => view.root.unmount());
    view.container.remove();
  });

  it('asks for each child age before pricing the room', async () => {
    const view = await mount();
    await click(
      [...view.container.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Add another room'),
      ),
    );
    const before = view.requests.length;
    await click(view.container.querySelector('[aria-label="More children in room 2"]')!);
    expect(
      view.container.querySelector('[aria-label="Room 2 child 1 age at check-in"]'),
    ).not.toBeNull();
    // No new price check until the age is entered.
    expect(view.requests.length).toBe(before);
    await act(async () => view.root.unmount());
    view.container.remove();
  });

  it('cannot add a room while a reason is given', async () => {
    const view = await mount('Choose the dates first.');
    const add = [...view.container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Add another room'),
    ) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(view.container.textContent).toContain('Choose the dates first.');
    expect(newExtraRoom('sea')).toMatchObject({ roomTypeId: 'sea', adults: 2, children: 0 });
    await act(async () => view.root.unmount());
    view.container.remove();
  });
});
