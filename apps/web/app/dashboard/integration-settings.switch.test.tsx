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

// The hotel keeps a PokPay test and a live account; `inUse` is the one switched on now.
async function mount(inUse: 'staging' | 'live') {
  const calls: Array<{ path: string; method?: string }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      calls.push({ path, method: init?.method });
      if (init?.method === 'PATCH') return Response.json({});
      return Response.json(
        path.endsWith('/properties/p/integration-connections')
          ? [{ connectionId: inUse, enabled: true }]
          : [
              {
                id: 'staging',
                provider: 'POKPAY',
                name: 'PokPay Staging',
                status: 'CONNECTED',
                mode: 'TEST',
              },
              {
                id: 'live',
                provider: 'POKPAY',
                name: 'PokPay Production',
                status: 'CONNECTED',
                mode: 'LIVE',
              },
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
const button = (label: string, within: ParentNode = document) =>
  [...within.querySelectorAll('button')].find((b) => b.textContent === label);
const click = async (label: string) =>
  act(async () => {
    button(label)!.click();
    await wait();
  });
/** The confirmation dialog's own button (a card button can carry the same words). */
const confirm = async (label: string) =>
  act(async () => {
    button(label, document.querySelector('[role="dialog"]')!)!.click();
    await wait();
  });

describe('switching between the PokPay test and live accounts', () => {
  it('labels each account and goes live only after the owner confirms', async () => {
    const calls = await mount('staging');
    const badges = [...document.querySelectorAll('[data-slot="badge"]')].map((b) => b.textContent);
    expect(badges).toEqual(expect.arrayContaining(['Test', 'Live']));
    await click('Switch to live');
    expect(document.body.textContent).toContain('Go live with PokPay?');
    expect(document.body.textContent).toContain('PokPay Staging');
    expect(document.body.textContent).toContain('keeps its keys');
    expect(document.body.textContent).not.toContain('cannot refund');
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
    await confirm('Go live');
    expect(calls.some((c) => c.method === 'PATCH' && c.path.endsWith('/live'))).toBe(true);
  });

  it('switches a live hotel back to its test account after confirmation', async () => {
    const calls = await mount('live');
    await click('Switch to test');
    expect(document.body.textContent).toContain('Switch PokPay to test?');
    expect(document.body.textContent).toContain('not real money');
    expect(document.body.textContent).toContain(
      'Payments already taken stay with the account that took them, including their refunds.',
    );
    await confirm('Switch to test');
    expect(calls.some((c) => c.method === 'PATCH' && c.path.endsWith('/staging'))).toBe(true);
  });

  it('does nothing when the owner cancels', async () => {
    const calls = await mount('staging');
    await click('Switch to live');
    await confirm('Cancel');
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });
});
