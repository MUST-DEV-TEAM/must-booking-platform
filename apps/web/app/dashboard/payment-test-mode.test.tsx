// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PaymentTestMode } from './payment-test-mode';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
const wait = () => new Promise((r) => setTimeout(r, 50));

async function mount(modes: Array<{ provider: string; mode: string }>, canManage: boolean) {
  const fetch = vi.fn(async () => Response.json(modes));
  vi.stubGlobal('fetch', fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(PaymentTestMode, { tenantId: 't', propertyId: 'p', canManage }),
      ),
    );
    await wait();
  });
  return fetch;
}

const bar = () =>
  vi.waitFor(() => {
    const element = document.querySelector('[data-test-mode-bar]');
    if (!element) throw new Error('The test-mode bar is not shown yet.');
    return element;
  });

describe('the dashboard test-mode bar', () => {
  it('warns every hotel member while PokPay uses its test account', async () => {
    const fetch = await mount([{ provider: 'POKPAY', mode: 'TEST' }], false);
    const shown = await bar();
    expect(fetch).toHaveBeenCalledWith(
      '/api/tenants/t/properties/p/payment-modes',
      expect.anything(),
    );
    expect(shown.textContent).toContain('PokPay is in test mode');
    expect(shown.textContent).toContain('not real money');
    expect(shown.querySelector('a')).toBeNull();
  });

  it('links owners to the payment accounts', async () => {
    await mount([{ provider: 'POKPAY', mode: 'TEST' }], true);
    expect((await bar()).querySelector('a')?.getAttribute('href')).toBe(
      '/dashboard/t?propertyId=p&section=settings&settingsArea=integrations',
    );
  });

  it('stays hidden while the hotel takes live payments', async () => {
    const fetch = await mount([{ provider: 'POKPAY', mode: 'LIVE' }], true);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await act(wait);
    expect(document.querySelector('[data-test-mode-bar]')).toBeNull();
  });
});
