// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DisplayCurrenciesSettings } from './display-currencies-settings';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});
const settle = () =>
  act(async () => void (await new Promise((resolve) => setTimeout(resolve, 35))));
async function mount(
  canWrite = true,
  feed?: unknown,
  changes: unknown[] = [],
  updatedAt = '2026-10-28T12:00:00Z',
) {
  let state: Record<string, unknown> & { rates: Array<Record<string, string>> } = {
    base: 'ALL',
    version: '1',
    displayCurrencies: ['EUR'],
    ...(feed ? { feed } : {}),
    rates: [
      {
        currency: 'EUR',
        rate: '100.00000000',
        updatedAt,
        updatedBy: 'u',
        updatedByName: 'Hotel Owner',
      },
    ],
  };
  const writes: Array<{ method: string; url: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/changes')) return Response.json(changes);
      if (init?.method) {
        const body = init.body ? JSON.parse(String(init.body)) : null;
        writes.push({ url, method: init.method, body });
        if (init.method === 'PUT')
          state = {
            ...state,
            rates: [{ ...state.rates[0]!, rate: body.rate, updatedAt: '2026-10-28T13:00:00Z' }],
          };
        if (init.method === 'DELETE') state = { ...state, rates: [] };
        if (init.method === 'PATCH') state = { ...state, displayCurrencies: body.currencies };
      }
      return Response.json(state);
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(DisplayCurrenciesSettings, { tenantId: 't', propertyId: 'p', canWrite }),
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
const euroInput = (host: HTMLElement) =>
  host.querySelector<HTMLInputElement>('[aria-label="Hotel rate for EUR"]')!;
const market = { date: '2026-10-28', perUnit: { EUR: 100 } };

describe('Display currencies settings', () => {
  it('shows the market reference and a worked example, which exposes a reversed rate', async () => {
    const { host, root, client } = await mount(true, market);
    expect(host.textContent).toContain('Market today: 1 EUR ≈ 100 ALL (daily feed, 2026-10-28)');
    await fill(euroInput(host), '200');
    // 200 lek per euro would make 100 lek worth only half a euro: the mistake seen at Empire.
    expect(host.textContent).toContain('100 ALL ≈ 0.5 EUR');
    await act(async () => root.unmount());
    client.clear();
  });
  it('needs a second deliberate click for a rate far from the market, and tells the server', async () => {
    const { host, root, writes, client } = await mount(true, market);
    await fill(euroInput(host), '200');
    await press(host, 'Save EUR rate');
    expect(writes).toEqual([]);
    expect(host.textContent).toContain('100% away from the market rate');
    await press(host, 'Save anyway');
    await settle();
    expect(writes[0]).toMatchObject({ method: 'PUT', body: { rate: '200', confirmOutlier: true } });
    await act(async () => root.unmount());
    client.clear();
  });
  it('asks to confirm a moderate difference without forcing the server override', async () => {
    const { host, root, writes, client } = await mount(true, market);
    await fill(euroInput(host), '115');
    await press(host, 'Save EUR rate');
    expect(writes).toEqual([]);
    await press(host, 'Save anyway');
    await settle();
    expect(writes[0]).toMatchObject({ method: 'PUT', body: { rate: '115' } });
    expect((writes[0]!.body as Record<string, unknown>).confirmOutlier).toBeUndefined();
    await act(async () => root.unmount());
    client.clear();
  });
  it('flags a rate nobody has reviewed for two months and lists recent changes', async () => {
    const { host, root, client } = await mount(
      true,
      undefined,
      [
        {
          id: 'c1',
          currency: 'EUR',
          oldRate: null,
          newRate: '100.00000000',
          changedAt: '2026-08-01T12:00:00Z',
          changedByName: 'Hotel Owner',
        },
      ],
      '2026-08-01T12:00:00Z',
    );
    expect(host.textContent).toMatch(/Not reviewed for \d+ days/);
    expect(host.textContent).toContain('Recent rate changes');
    expect(host.textContent).toContain('feed → 100 ALL');
    expect(host.textContent).toContain('Hotel Owner');
    await act(async () => root.unmount());
    client.clear();
  });
  it('states the stored direction and last editor, saves a rate, and removes only the override', async () => {
    const { host, root, writes, client } = await mount();
    expect(host.textContent).toContain('1 EUR in ALL');
    expect(host.textContent).toContain('Last changed by Hotel Owner');
    expect(host.textContent).toContain('not used for charging');
    await fill(host.querySelector<HTMLInputElement>('[aria-label="Hotel rate for EUR"]')!, '105');
    await act(async () =>
      [...host.querySelectorAll('button')].find((b) => b.textContent === 'Save EUR rate')!.click(),
    );
    await settle();
    expect(writes[0]).toEqual({
      url: '/api/tenants/t/properties/p/exchange-rates/EUR',
      method: 'PUT',
      body: { rate: '105' },
    });
    await act(async () =>
      [...host.querySelectorAll('button')]
        .find((b) => b.textContent === 'Use feed for EUR')!
        .click(),
    );
    await settle();
    expect(writes[1]?.method).toBe('DELETE');
    expect(host.querySelector('[aria-label="Display EUR"]')?.getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(host.textContent).toContain('Uses the daily feed');
    await act(async () => root.unmount());
    client.clear();
  });
  it('adds an extra display currency to the hotel-selected website list', async () => {
    const { host, root, writes, client } = await mount();
    await fill(host.querySelector<HTMLInputElement>('#display-currency-code')!, 'USD');
    await act(async () =>
      [...host.querySelectorAll('button')]
        .find((b) => b.textContent === 'Add display currency')!
        .click(),
    );
    await settle();
    expect(writes[0]).toMatchObject({ method: 'PATCH', body: { currencies: ['EUR', 'USD'] } });
    expect(host.querySelector('[aria-label="Hotel rate for USD"]')).not.toBeNull();
    await act(async () => root.unmount());
    client.clear();
  });
  it('disables writes without settings write access', async () => {
    const { host, root, writes, client } = await mount(false);
    expect(
      [...host.querySelectorAll<HTMLInputElement>('input')].every((input) => input.disabled),
    ).toBe(true);
    expect(
      [...host.querySelectorAll<HTMLButtonElement>('button')].every((button) => button.disabled),
    ).toBe(true);
    expect(writes).toEqual([]);
    await act(async () => root.unmount());
    client.clear();
  });
});
