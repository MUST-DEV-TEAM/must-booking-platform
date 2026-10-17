// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NumberStepper } from '../../components/ui/number-stepper';
import { Stepper } from '../../components/ui/stepper';
import { AddReservation } from './add-reservation';
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
    root.render(node);
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
        if (url.endsWith('/pms-connection-status')) return json({ provider: 'LOCAL' });
        if (url.endsWith('/room-types')) return json([{ id: 'rt', name: 'Double', roomCount: 2 }]);
        if (url.endsWith('/rooms')) return json([]);
        if (url.endsWith('/rate-plans')) return json([{ id: 'rp', name: 'Flexible', currency: 'EUR' }]);
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
    expect(container.querySelector('li[aria-current="step"]')?.textContent).toContain('Stay details');
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
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.endsWith('/pms-connection-status')) return json({ provider: 'LOCAL' });
      if (url.endsWith('/room-types')) return json([{ id: 'rt', name: 'Double', roomCount: 2 }]);
      if (url.endsWith('/rooms')) return json([]);
      if (url.endsWith('/rate-plans')) return json([{ id: 'rp', name: 'Flexible', currency: 'EUR' }]);
      return json({});
    }));
    const { container, root } = await render(createElement(DashboardQueryProvider, undefined,
      createElement(AddReservation, {
        tenantId: 't', propertyId: 'p',
        paymentGateways: { stripe: false, pokpay: false, payAtHotel: true },
        canRecordPayment: false,
      }),
    ));
    await act(async () => {
      await vi.waitFor(() => {
        if (!container.textContent?.includes('Choose dates to see rooms')) throw new Error('Add reservation has not finished loading yet.');
      });
    });
    expect(container.textContent).not.toContain('Record a payment now');
    await act(async () => root.unmount());
  });
});
