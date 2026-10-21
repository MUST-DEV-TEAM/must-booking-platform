// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

let mockParams: { bookingId: string; outcome: string } = {
  bookingId: 'booking-1',
  outcome: 'success',
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useParams: () => mockParams,
}));

import BookingPaymentOutcomePage from './page';

describe('Booking payment outcome page', () => {
  it('confirms a successful payment and links back to the dashboard', () => {
    mockParams = { bookingId: 'booking-1', outcome: 'success' };
    const markup = renderToStaticMarkup(createElement(BookingPaymentOutcomePage));

    expect(markup).toContain('Payment submitted');
    expect(markup).toContain('You can close this tab');
    expect(markup).toContain('href="/dashboard"');
    expect(markup).not.toContain('was not completed');
  });

  it('explains a cancelled checkout without claiming a charge occurred', () => {
    mockParams = { bookingId: 'booking-1', outcome: 'cancel' };
    const markup = renderToStaticMarkup(createElement(BookingPaymentOutcomePage));

    expect(markup).toContain('Payment was not completed');
    expect(markup).toContain('verified payment status');
    expect(markup).toContain('href="/dashboard"');
  });
});

it('notifies the original dashboard and closes the payment tab after return', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  mockParams = { bookingId: 'booking-1', outcome: 'success' };
  const postMessage = vi.fn(),
    channelClose = vi.fn();
  vi.stubGlobal(
    'BroadcastChannel',
    class {
      postMessage = postMessage;
      close = channelClose;
    },
  );
  const close = vi.spyOn(window, 'close').mockImplementation(() => {});
  const host = document.createElement('div'),
    root = createRoot(host);
  await act(async () => root.render(createElement(BookingPaymentOutcomePage)));
  expect(postMessage).toHaveBeenCalledWith({ bookingId: 'booking-1', outcome: 'success' });
  expect(close).toHaveBeenCalledOnce();
  expect(channelClose).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
