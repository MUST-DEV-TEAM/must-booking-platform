// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlsoShowPrices, ExchangeRateTable } from './display-currencies-settings';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});
const settle = () =>
  act(async () => void (await new Promise((resolve) => setTimeout(resolve, 35))));
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

/** The hotel is in EUR and shows ALL. The server stores EUR per one ALL: 0.00995025 is "1 EUR = 100.50 ALL". */
async function mount(
  options: {
    canWrite?: boolean;
    feed?: unknown;
    updatedAt?: string;
    displayCurrencies?: string[];
    rates?: Array<Record<string, string>>;
  } = {},
) {
  const rate = {
    currency: 'ALL',
    rate: '0.00995025',
    updatedAt: options.updatedAt ?? daysAgo(0),
    updatedBy: 'u',
    updatedByName: 'Hotel Owner',
  };
  let state: Record<string, unknown> = {
    base: 'EUR',
    version: '1',
    displayCurrencies: options.displayCurrencies ?? ['ALL'],
    ...(options.feed ? { feed: options.feed } : {}),
    rates: options.rates ?? [rate],
  };
  const writes: Array<{ method: string; url: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/changes')) return Response.json([]);
      if (init?.method) {
        const body = init.body ? JSON.parse(String(init.body)) : null;
        writes.push({ url, method: init.method, body });
        if (init.method === 'PATCH') state = { ...state, displayCurrencies: body.currencies };
        if (init.method === 'DELETE') state = { ...state, rates: [] };
      }
      return Response.json(state);
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const scope = { tenantId: 't', propertyId: 'p', canWrite: options.canWrite ?? true };
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(AlsoShowPrices, scope),
        createElement(ExchangeRateTable, scope),
      ),
    ),
  );
  await settle();
  return { host, root, writes, client };
}
const fill = async (input: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
const press = (host: HTMLElement, label: string) =>
  act(async () =>
    [...host.querySelectorAll('button')].find((b) => b.textContent === label)!.click(),
  );
const allInput = (host: HTMLElement) =>
  host.querySelector<HTMLInputElement>('[aria-label="1 EUR equals how many ALL"]')!;
// The daily feed says one ALL costs 0.01 EUR, so 1 EUR is 100 ALL.
const market = { date: '2026-11-19', perUnit: { ALL: 0.01 } };

describe('Display currencies and exchange rates', () => {
  it('shows a rate the natural way round, with the example guests see and when it changed', async () => {
    const { host, root, client } = await mount({ feed: market });
    expect(allInput(host).value).toBe('100.50');
    expect(host.textContent).toContain('1 EUR equals');
    expect(host.textContent).toContain('120.00 EUR ≈ 12060.00 ALL');
    expect(host.textContent).toContain('today');
    expect(host.textContent).toContain('1 of 5');
    expect(host.textContent).toContain('Rates: above 0, up to 6 decimals.');
    await act(async () => root.unmount());
    client.clear();
  });

  it('saves a typed rate as the stored direction, only once it has changed', async () => {
    const { host, root, writes, client } = await mount({ feed: market });
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Save')).toBe(false);
    await fill(allInput(host), '100');
    await press(host, 'Save');
    await settle();
    // 1 EUR = 100 ALL is stored as 0.01 EUR per ALL, to eight decimals.
    expect(writes[0]).toMatchObject({ method: 'PUT', body: { rate: '0.01000000' } });
    expect(writes[0]!.url).toContain('/ALL');
    await act(async () => root.unmount());
    client.clear();
  });

  it('asks to confirm a rate that is moderately far from the market, without forcing the server', async () => {
    const { host, root, writes, client } = await mount({ feed: market });
    await fill(allInput(host), '115');
    await press(host, 'Save');
    expect(writes).toEqual([]);
    expect(host.textContent).toContain('away from the market rate');
    await press(host, 'Save anyway');
    await settle();
    expect(writes[0]).toMatchObject({ method: 'PUT', body: { rate: '0.00869565' } });
    expect((writes[0]!.body as Record<string, unknown>).confirmOutlier).toBeUndefined();
    await act(async () => root.unmount());
    client.clear();
  });

  it('needs a second click for a rate far from the market and tells the server it was confirmed', async () => {
    const { host, root, writes, client } = await mount({ feed: market });
    await fill(allInput(host), '250');
    await press(host, 'Save');
    expect(writes).toEqual([]);
    expect(host.textContent).toContain('60% away from the market rate');
    expect(host.textContent).toContain('wrong way round');
    await press(host, 'Save anyway');
    await settle();
    expect(writes[0]).toMatchObject({
      method: 'PUT',
      body: { rate: '0.00400000', confirmOutlier: true },
    });
    await act(async () => root.unmount());
    client.clear();
  });

  it('flags a rate nobody has reviewed for two months', async () => {
    const { host, root, client } = await mount({ updatedAt: daysAgo(90) });
    expect(host.textContent).toContain('Not reviewed for 90 days');
    expect(host.textContent).toContain('90 days ago');
    await act(async () => root.unmount());
    client.clear();
  });

  it('removes only the hotel override and shows the market reference', async () => {
    const { host, root, writes, client } = await mount({ feed: market });
    expect(host.textContent).toContain('market today: 1 EUR ≈ 100.00 ALL');
    await press(host, 'Use the daily feed');
    await settle();
    expect(writes[0]).toMatchObject({ method: 'DELETE' });
    expect(writes[0]!.url).toContain('/ALL');
    await act(async () => root.unmount());
    client.clear();
  });

  it('says what to do when no other currency is chosen, and locks everything without write access', async () => {
    const empty = await mount({ displayCurrencies: [], rates: [] });
    expect(empty.host.textContent).toContain('0 of 5');
    expect(empty.host.textContent).toContain('Choose a currency above to set its rate');
    await act(async () => empty.root.unmount());
    empty.client.clear();
    const locked = await mount({ canWrite: false });
    expect(allInput(locked.host).disabled).toBe(true);
    expect([...locked.host.querySelectorAll('button')].some((b) => b.textContent === 'Save')).toBe(
      false,
    );
    await act(async () => locked.root.unmount());
    locked.client.clear();
  });
});

describe('Currencies offered in the pickers', () => {
  it('offers only currencies in use today', async () => {
    const { currentCurrencyCodes } = await import('../../lib/currencies');
    expect(currentCurrencyCodes).toContain('EUR');
    expect(currentCurrencyCodes).toContain('ALL');
    expect(currentCurrencyCodes).not.toContain('ALK');
    expect(currentCurrencyCodes).not.toContain('BGN');
    expect(currentCurrencyCodes).not.toContain('HRK');
  });

  it('lets a first currency be chosen while the limit is not reached', async () => {
    const { host, root, client } = await mount({ displayCurrencies: [], rates: [] });
    await act(async () => host.querySelector<HTMLElement>('[role="combobox"]')!.click());
    const option = [...document.body.querySelectorAll<HTMLElement>('[role="checkbox"]')].find((e) =>
      e.textContent?.includes('USD'),
    );
    expect(option).toBeTruthy();
    expect(
      option!.hasAttribute('disabled') || option!.getAttribute('aria-disabled') === 'true',
    ).toBe(false);
    await act(async () => root.unmount());
    client.clear();
  });
});
