// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { it, expect, vi } from 'vitest';
import { toast } from 'sonner';
import { CheckoutLinkActions } from './checkout-link-actions';
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
it('opens the saved checkout and copies it immediately without another provider request', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined),
    fetcher = vi.fn(),
    tab = { opener: {}, close: vi.fn() },
    opened = vi.fn();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
  vi.stubGlobal('fetch', fetcher);
  const host = document.body.appendChild(document.createElement('div')),
    root = createRoot(host);
  await act(async () =>
    root.render(
      createElement(CheckoutLinkActions, {
        url: 'https://pay.pokpay.test/existing',
        tenantId: 't',
        propertyId: 'p',
        bookingId: 'b',
        canSend: true,
        onOpened: opened,
      }),
    ),
  );
  const button = (text: string) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent === text)!;
  await act(async () => button('Copy PokPay link').click());
  expect(writeText).toHaveBeenCalledWith('https://pay.pokpay.test/existing');
  expect(toast.success).toHaveBeenCalledWith('Link copied');
  await act(async () => button('Pay with PokPay').click());
  expect(open).toHaveBeenCalledWith('https://pay.pokpay.test/existing', '_blank');
  expect(opened).toHaveBeenCalledWith(tab);
  expect(tab.opener).toBeNull();
  expect(tab.close).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
  expect(button('Send payment link')).toBeDefined();
  expect(button('Show payment QR code')).toBeDefined();
  await act(async () => root.unmount());
  host.remove();
  open.mockRestore();
  vi.unstubAllGlobals();
});
