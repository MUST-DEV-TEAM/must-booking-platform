// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CollectPaymentActions } from './collect-payment-actions';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function mount(status = 'CONFIRMED', capabilities = ['payments.record']) {
  const requests: string[] = [];
  const fetcher = vi.fn(async (url: string) => {
    requests.push(url);
    return {
      ok: true,
      json: async () =>
        url.endsWith('/mine')
          ? capabilities
          : url.endsWith('/collection-options')
            ? { pokpay: true }
            : url.endsWith('/check-collection')
              ? { paid: true }
              : { checkoutUrl: 'https://staging.example/checkout' },
    };
  });
  vi.stubGlobal('fetch', fetcher);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const host = document.body.appendChild(document.createElement('div')),
    root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(CollectPaymentActions, {
          tenantId: 't',
          propertyId: 'p',
          booking: {
            id: 'b',
            status,
            total: { amount: '100', currency: 'EUR' },
            paidAmount: '25',
            guestEmail: 'guest@example.test',
          },
        }),
      ),
    );
  });
  for (let i = 0; i < 5; i++)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  return {
    host,
    requests,
    invalidate,
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
      client.clear();
    },
  };
}
describe('confirmed booking collection controls', () => {
  it.each(['PMS_UNKNOWN_RESULT', 'AVAILABILITY_FAILED', 'CANCELLED'])(
    'never offers collection for %s',
    async (status) => {
      const view = await mount(status);
      expect(view.host.textContent).toBe('');
      expect(view.requests.some((x) => x.endsWith('/collection-options'))).toBe(false);
      await view.close();
    },
  );
  it('hides collection from staff without payment recording permission', async () => {
    const view = await mount('CONFIRMED', []);
    expect(view.host.textContent).toBe('');
    await view.close();
  });
  it('opens one checkout on a double click and refreshes only after authoritative confirmation', async () => {
    const tab = { location: { href: '' }, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const view = await mount();
    const button = [...view.host.querySelectorAll('button')].find(
      (x) => x.textContent === 'Pay with PokPay',
    )!;
    await act(async () => {
      button.click();
      button.click();
    });
    expect(view.requests.filter((x) => x.endsWith('/collect-pokpay'))).toHaveLength(1);
    expect(tab.location.href).toBe('https://staging.example/checkout');
    expect(view.invalidate).not.toHaveBeenCalled();
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(view.requests.some((x) => x.endsWith('/check-collection'))).toBe(true);
    expect(view.invalidate).toHaveBeenCalledWith({ queryKey: ['dashboard'] });
    await view.close();
  });
  it('asks for explicit received-money confirmation before recording a manual payment', async () => {
    const view = await mount();
    await act(async () =>
      [...view.host.querySelectorAll('button')]
        .find((x) => x.textContent === 'Record payment received')!
        .click(),
    );
    expect(document.body.textContent).toContain('Record money already received');
    expect(view.requests.some((x) => x.endsWith('/manual-payment'))).toBe(false);
    await view.close();
  });
});
