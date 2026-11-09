// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { IntegrationSettings } from './integration-settings';
vi.mock('./clock-sync', () => ({ ClockSyncStatus: () => null }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
HTMLElement.prototype.scrollIntoView = vi.fn();
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
const wait = () => new Promise((r) => setTimeout(r, 50));

// The hotel uses "PokPay Staging"; "PokPay Production" is saved but switched off.
async function mount() {
  const calls: Array<{ path: string; method?: string }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      calls.push({ path, method: init?.method });
      if (init?.method === 'PATCH') return Response.json({});
      return Response.json(
        path.endsWith('/properties/p/integration-connections')
          ? [{ connectionId: 'staging', enabled: true }]
          : [
              { id: 'staging', provider: 'POKPAY', name: 'PokPay Staging', status: 'CONNECTED' },
              { id: 'live', provider: 'POKPAY', name: 'PokPay Production', status: 'CONNECTED' },
            ],
      );
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(IntegrationSettings, { tenantId: 't', propertyId: 'p', canWrite: true }),
      ),
    );
    await wait();
  });
  await act(wait);
  return calls;
}
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent === label);

describe('switching the PokPay connection', () => {
  it('asks first, and only switches after the owner confirms', async () => {
    const calls = await mount();
    await act(async () => {
      button('Enable')!.click();
      await wait();
    });
    expect(document.body.textContent).toContain('Switch PokPay connection?');
    expect(document.body.textContent).toContain('PokPay Staging');
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
    await act(async () => {
      button('Switch')!.click();
      await wait();
    });
    expect(calls.some((c) => c.method === 'PATCH' && c.path.endsWith('/live'))).toBe(true);
  });

  it('does nothing when the owner cancels', async () => {
    const calls = await mount();
    await act(async () => {
      button('Enable')!.click();
      await wait();
    });
    await act(async () => {
      button('Cancel')!.click();
      await wait();
    });
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });
});
