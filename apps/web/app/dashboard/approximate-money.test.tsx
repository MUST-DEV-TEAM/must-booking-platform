// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HotelMoneyProvider } from '../../lib/hotel-money-scope';
import { HotelMoney, LedgerAmount, MoneyList } from './approximate-money';
import { DashboardQueryProvider } from './query-provider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));

async function render(
  element: React.ReactElement,
  rates = { base: 'EUR', date: '2026-10-27', rates: { ALL: 100 } },
) {
  const fetch = vi.fn((url: string) =>
    url.includes('/public/exchange-rates')
      ? Promise.resolve(Response.json({ ...rates, approximate: true }))
      : Promise.resolve(Response.json({})),
  );
  vi.stubGlobal('fetch', fetch);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(DashboardQueryProvider, null, element)));
  await settle();
  return { text: () => container.textContent ?? '', fetch, root };
}

const entry = { amount: '5000.00', currency: 'ALL' };
const ids = { tenantId: 't', propertyId: 'p' };

describe('LedgerAmount', () => {
  it('shows a payment in the booking currency as it is, without asking for rates', async () => {
    const view = await render(
      createElement(LedgerAmount, {
        ...ids,
        entry: { amount: '50.00', currency: 'EUR' },
        bookingCurrency: 'EUR',
      }),
    );
    expect(view.text()).toContain('50.00');
    expect(view.text()).not.toContain('≈');
    expect(view.fetch).not.toHaveBeenCalled();
  });

  it('shows the amount in its own currency with the rate kept on the payment day in brackets', async () => {
    const view = await render(
      createElement(LedgerAmount, {
        ...ids,
        entry: { ...entry, fxRate: '0.01000000', fxRateDate: '2026-10-20' },
        bookingCurrency: 'EUR',
      }),
    );
    expect(view.text()).toContain('5,000');
    expect(view.text()).toContain('(≈ €50.00)');
    expect(view.text()).not.toContain('estimate');
    expect(view.fetch).not.toHaveBeenCalled();
  });

  it("marks today's rate as an estimate when no rate was kept, and says nothing when no rate is known", async () => {
    const estimated = await render(
      createElement(LedgerAmount, { ...ids, entry, bookingCurrency: 'EUR', negative: true }),
    );
    expect(estimated.text()).toContain('−');
    expect(estimated.text()).toContain('(≈ −€50.00, estimate)');

    const unknown = await render(
      createElement(LedgerAmount, { ...ids, entry, bookingCurrency: 'EUR' }),
      { base: 'EUR', date: null, rates: {} },
    );
    expect(unknown.text()).toContain('5,000');
    expect(unknown.text()).not.toContain('≈');
  });
});

describe('MoneyList', () => {
  it('keeps each currency on its own and estimates only the ones that are not the hotel currency', async () => {
    const view = await render(
      createElement(MoneyList, {
        ...ids,
        list: [
          { currency: 'EUR', amount: '200.00' },
          { currency: 'ALL', amount: '10000.00' },
        ],
      }),
    );
    const text = view.text();
    expect(text).toContain('€200.00');
    expect(text).toContain('10,000');
    expect(text).toContain('(≈ €100.00, estimate)');
    expect(text).not.toContain('€300');
  });

  it('shows a dash for an empty list', async () => {
    const view = await render(createElement(MoneyList, { ...ids, list: [] }));
    expect(view.text()).toBe('—');
  });
});

describe('HotelMoney with property currency already known', () => {
  it.each(['EUR', 'ALL'])('shows %s without per-row rate reads', async (currency) => {
    const view = await render(
      createElement(HotelMoneyProvider, {
        ...ids,
        currency: 'EUR',
        children: createElement(
          'div',
          null,
          ...Array.from({ length: 30 }, (_, key) =>
            createElement(HotelMoney, {
              ...ids,
              key,
              amount: '5000.00',
              currency,
            }),
          ),
        ),
      }),
    );
    expect(view.text()).toContain(currency === 'EUR' ? '\u20ac5,000.00' : 'ALL');
    expect(view.text().includes('(\u2248 \u20ac50.00, estimate)')).toBe(currency === 'ALL');
    expect(view.fetch).toHaveBeenCalledTimes(currency === 'EUR' ? 0 : 1);
    await act(async () => view.root.unmount());
  });
  it('does not reuse another tenant or property currency scope', async () => {
    const view = await render(
      createElement(HotelMoneyProvider, {
        ...ids,
        currency: 'ALL',
        children: createElement(HotelMoney, {
          tenantId: 'other',
          propertyId: 'other',
          currency: 'ALL',
          amount: '5000.00',
        }),
      }),
    );
    expect(view.text()).toContain('(\u2248 \u20ac50.00, estimate)');
    expect(view.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/tenants/other/properties/other/'),
      expect.anything(),
    );
    await act(async () => view.root.unmount());
  });
});
