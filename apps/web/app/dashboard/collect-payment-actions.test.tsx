// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { CollectPaymentActions } from './collect-payment-actions';
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));
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
    expect(tab.close).toHaveBeenCalledOnce();
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
  it('copies the same reusable checkout link without opening a payment tab', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const open = vi.spyOn(window, 'open');
    const view = await mount();
    await act(async () =>
      [...view.host.querySelectorAll('button')]
        .find((b) => b.textContent === 'Copy PokPay link')!
        .click(),
    );
    expect(writeText).toHaveBeenCalledWith('https://staging.example/checkout');
    expect(toast.success).toHaveBeenCalledWith('Link copied');
    expect(view.host.textContent).not.toContain('link copied');
    expect(view.host.textContent).not.toContain('Waiting for PokPay');
    expect(open).not.toHaveBeenCalled();
    expect(view.requests.filter((u) => u.endsWith('/collect-pokpay'))).toHaveLength(1);
    await act(async () =>
      [...view.host.querySelectorAll('button')]
        .find((b) => b.textContent === 'Copy PokPay link')!
        .click(),
    );
    expect(view.requests.filter((u) => u.endsWith('/collect-pokpay'))).toHaveLength(1);
    await view.close();
  });
  it('asks for confirmation and records the received date rather than silently marking paid', async () => {
    const view = await mount();
    await act(async () =>
      [...view.host.querySelectorAll('button')]
        .find((b) => b.textContent === 'Record payment received')!
        .click(),
    );
    expect(view.requests.some((u) => u.endsWith('/manual-payment'))).toBe(false);
    const dialog = document.body.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('money has arrived');
    expect(dialog.querySelector('input[type="date"]')).toBeTruthy();
    await act(async () =>
      [...dialog.querySelectorAll('button')]
        .find((b) => b.textContent === 'Record payment')!
        .click(),
    );
    const call = vi
      .mocked(fetch)
      .mock.calls.find(
        ([u, init]) => String(u).endsWith('/manual-payment') && init?.method === 'POST',
      );
    expect(JSON.parse(call![1]!.body as string)).toMatchObject({
      method: 'cash',
      evidence: { receivedOn: new Date().toISOString().slice(0, 10) },
    });
    await view.close();
  });
  it('leaves a selectable link when clipboard permission is denied', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('Permission denied')) },
    });
    const view = await mount();
    await act(async () =>
      [...view.host.querySelectorAll('button')]
        .find((b) => b.textContent === 'Copy PokPay link')!
        .click(),
    );
    expect(
      document.querySelector<HTMLInputElement>('input[aria-label="Payment link"]')?.value,
    ).toBe('https://staging.example/checkout');
    await view.close();
  });
});
