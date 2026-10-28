// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NumberStepper } from '../../components/ui/number-stepper';
import { Stepper } from '../../components/ui/stepper';
import { AddReservation } from './add-reservation';
import { HotelMoneyProvider } from '../../lib/hotel-money-scope';
import { formatMoney } from '../../lib/money';
import { DashboardQueryProvider } from './query-provider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopObserver as unknown as typeof ResizeObserver;

afterEach(() => vi.unstubAllGlobals());

async function render(node: ReturnType<typeof createElement>) {
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(HotelMoneyProvider, {
        tenantId: 't',
        propertyId: 'p',
        currency: 'EUR',
        children: node,
      }),
    );
  });
  return { container, root };
}

describe('Stepper', () => {
  it('marks finished steps, the current step and later steps', async () => {
    const { container, root } = await render(
      createElement(Stepper, {
        steps: [
          { id: 'a', title: 'One' },
          { id: 'b', title: 'Two' },
          { id: 'c', title: 'Three' },
        ],
        current: 1,
      }),
    );
    const items = container.querySelectorAll('li');
    expect(items).toHaveLength(3);
    expect(items[1]?.getAttribute('aria-current')).toBe('step');
    expect(items[0]?.getAttribute('aria-current')).toBeNull();
    expect(items[0]?.querySelector('svg')).not.toBeNull();
    await act(async () => root.unmount());
  });
});

describe('NumberStepper', () => {
  it('stays inside its limits', async () => {
    const onChange = vi.fn();
    const { container, root } = await render(
      createElement(NumberStepper, { label: 'Adults', value: 1, min: 1, max: 2, onChange }),
    );
    const buttons = container.querySelectorAll('button');
    expect(buttons[0]?.disabled).toBe(true);
    await act(async () => (buttons[1] as HTMLButtonElement).click());
    expect(onChange).toHaveBeenCalledWith(2);
    await act(async () => root.unmount());
  });
});

describe('AddReservation', () => {
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));

  it('starts on the stay step and asks for dates before listing rooms', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/booking-rules/evaluate'))
          return json({
            today: '2026-10-18',
            disabledDates: [],
            minStayNights: null,
            maxStayNights: null,
            booking: { valid: false, errors: [] },
            block: { valid: false, errors: [] },
          });
        if (url.endsWith('/pms-connection-status')) return json({ provider: 'LOCAL' });
        if (url.endsWith('/room-types')) return json([{ id: 'rt', name: 'Double', roomCount: 2 }]);
        if (url.endsWith('/rooms')) return json([]);
        if (url.endsWith('/rate-plans'))
          return json([{ id: 'rp', name: 'Flexible', currency: 'EUR' }]);
        return json({});
      }),
    );
    const { container, root } = await render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(AddReservation, {
          tenantId: 't',
          propertyId: 'p',
          bookingMode: 'ROOM_TYPE_ONLY',
          paymentGateways: { stripe: false, pokpay: false, payAtHotel: true },
        }),
      ),
    );
    await act(async () => {
      await vi.waitFor(() => {
        if (!container.textContent?.includes('Choose dates to see rooms'))
          throw new Error('Add reservation has not finished loading yet.');
      });
    });

    expect(container.textContent).toContain('Add reservation');
    const addChild =
      container.querySelector<HTMLButtonElement>('button[aria-label="More children"]') ??
      [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
        b.getAttribute('aria-label')?.toLowerCase().includes('increase children'),
      );
    expect(addChild).toBeTruthy();
    await act(async () => addChild!.click());
    expect(container.querySelector('input[aria-label="Child 1 age at check-in"]')).toBeTruthy();
    expect(
      (container.querySelector('input[aria-label="Child 1 age at check-in"]') as HTMLInputElement)
        .value,
    ).toBe('');

    expect(container.querySelector('li[aria-current="step"]')?.textContent).toContain(
      'Stay details',
    );
    const next = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Continue to guest information'),
    );
    expect(next?.disabled).toBe(true);
    expect(container.textContent).toContain('One room per reservation');

    await act(async () => root.unmount());
  });

  it('shows a clear message when rooms and rates cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.endsWith('/pms-connection-status')
          ? json({ provider: 'LOCAL' })
          : Promise.resolve(new Response(null, { status: 500 })),
      ),
    );
    const { container, root } = await render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(AddReservation, { tenantId: 't', propertyId: 'p' }),
      ),
    );
    await act(async () => {
      await vi.waitFor(() => {
        if (!container.textContent?.includes('Rooms and rates could not be loaded'))
          throw new Error('Error state has not rendered yet.');
      });
    });
    await act(async () => root.unmount());
  });

  it('hides payment recording choices without payments.record', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/booking-rules/evaluate'))
          return json({
            today: '2026-10-18',
            disabledDates: [],
            minStayNights: null,
            maxStayNights: null,
            booking: { valid: false, errors: [] },
            block: { valid: false, errors: [] },
          });
        if (url.endsWith('/pms-connection-status')) return json({ provider: 'LOCAL' });
        if (url.endsWith('/room-types')) return json([{ id: 'rt', name: 'Double', roomCount: 2 }]);
        if (url.endsWith('/rooms')) return json([]);
        if (url.endsWith('/rate-plans'))
          return json([{ id: 'rp', name: 'Flexible', currency: 'EUR' }]);
        return json({});
      }),
    );
    const { container, root } = await render(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(AddReservation, {
          tenantId: 't',
          propertyId: 'p',
          paymentGateways: { stripe: false, pokpay: false, payAtHotel: true },
          canRecordPayment: false,
        }),
      ),
    );
    await act(async () => {
      await vi.waitFor(() => {
        if (!container.textContent?.includes('Choose dates to see rooms'))
          throw new Error('Add reservation has not finished loading yet.');
      });
    });
    expect(container.textContent).not.toContain('Record a payment now');
    await act(async () => root.unmount());
  });
  it.each(['EUR', 'ALL'])(
    'keeps selected type behavior and %s offer display while rules reload',
    async (currency) => {
      window.history.replaceState({}, '', '/?start=2027-01-01&end=2027-01-03');
      const offers: Array<Array<{ key: string; roomTypeId: string; roomId?: string }>> = [];
      let finishRules: (() => void) | undefined;
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string, init?: RequestInit) => {
          if (url.includes('/booking-rules/evaluate')) {
            const result = {
              today: '2026-10-21',
              disabledDates: [],
              minStayNights: 1,
              maxStayNights: null,
              booking: { valid: true, errors: [] },
              block: { valid: true, errors: [] },
            };
            if (url.includes('roomTypeId=t1'))
              return new Promise<Response>((resolve) => {
                finishRules = () => resolve(Response.json(result));
              });
            return json(result);
          }
          if (url.includes('/public/exchange-rates'))
            return json({ base: 'EUR', date: '2026-10-28', rates: { ALL: 100 } });
          if (url.endsWith('/pms-connection-status')) return json({ provider: 'CLOCK_PMS' });
          if (url.endsWith('/room-types'))
            return json([
              { id: 't1', name: 'Double', roomCount: 2 },
              { id: 't2', name: 'Suite', roomCount: 1 },
            ]);
          if (url.endsWith('/rooms'))
            return json([
              { id: 'r1', name: '101', roomTypeId: 't1' },
              { id: 'r2', name: '102', roomTypeId: 't1' },
              { id: 'r3', name: '201', roomTypeId: 't2' },
            ]);
          if (url.endsWith('/rate-plans')) return json([]);
          if (url.endsWith('/staff-bookings/rate-offers')) return json({ offers: [] });
          if (url.endsWith('/staff-bookings/offers')) {
            const body = JSON.parse(String(init?.body));
            offers.push(body.items);
            return json({
              offers: Object.fromEntries(
                body.items.map((i: { key: string }) => [
                  i.key,
                  i.key === 'r2'
                    ? { ok: false, reason: 'Occupied' }
                    : { ok: true, total: { amount: '100.00', currency } },
                ]),
              ),
            });
          }
          return json([]);
        }),
      );
      const { container, root } = await render(
        createElement(
          DashboardQueryProvider,
          undefined,
          createElement(AddReservation, { tenantId: 't', propertyId: 'p', bookingMode: 'MIXED' }),
        ),
      );
      const waitUntil = async (check: () => boolean) => {
        for (let n = 0; n < 60; n++) {
          await act(async () => {
            await new Promise((r) => setTimeout(r, 50));
          });
          if (check()) return;
        }
        throw Error('The booking form did not finish loading');
      };
      await waitUntil(() => {
        const radio = container.querySelector<HTMLButtonElement>('[role="radio"]');
        return !!radio && !radio.disabled;
      });
      const radio = container.querySelector<HTMLButtonElement>('[role="radio"]')!;
      await act(async () => radio.click());
      expect(
        container.querySelector('[role="radiogroup"][aria-label="Room types"]'),
      ).not.toBeNull();
      expect(radio.getAttribute('aria-checked')).toBe('true');
      expect(offers).toHaveLength(1);
      await act(async () => {
        finishRules?.();
        await Promise.resolve();
      });
      const byRoom = [...container.querySelectorAll('button')].find(
        (b) => b.textContent === 'By specific room',
      )!;
      await act(async () => byRoom.click());
      await act(async () => {
        finishRules?.();
      });
      await waitUntil(
        () =>
          offers.length === 2 &&
          [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')].some(
            (b) => b.textContent?.includes('102') && b.disabled,
          ),
      );
      await waitUntil(() => currency === 'EUR' || !!container.textContent?.includes('estimate'));
      expect(container.textContent).toContain(formatMoney('100.00', currency));
      expect(container.textContent?.includes('(\u2248 ')).toBe(currency === 'ALL');
      const rateCalls = vi
        .mocked(globalThis.fetch)
        .mock.calls.filter(([url]) => String(url).includes('/public/exchange-rates'));
      expect(rateCalls).toHaveLength(currency === 'EUR' ? 0 : 1);
      expect(offers[1].map((i) => i.roomId)).toEqual(['r1', 'r2']);
      expect(offers[1].every((i) => i.roomTypeId === 't1')).toBe(true);
      expect(
        [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) =>
          b.textContent?.includes('102'),
        )?.disabled,
      ).toBe(true);
      await act(async () => root.unmount());
      window.history.replaceState({}, '', '/');
    },
  );
});
