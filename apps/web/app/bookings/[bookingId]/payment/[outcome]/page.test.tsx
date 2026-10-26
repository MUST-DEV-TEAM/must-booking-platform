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
  it('explains a submitted payment without redirecting', () => {
    mockParams = { bookingId: 'booking-1', outcome: 'success' };
    const markup = renderToStaticMarkup(createElement(BookingPaymentOutcomePage));

    expect(markup).toContain('Checking your payment');
    expect(markup).toContain('Close this tab');
    expect(markup).toContain('href="/dashboard"');
    expect(markup).not.toContain('was not completed');
  });

  it('explains a cancelled checkout without claiming a charge occurred', () => {
    mockParams = { bookingId: 'booking-1', outcome: 'cancel' };
    const markup = renderToStaticMarkup(createElement(BookingPaymentOutcomePage));

    expect(markup).toContain('Checkout closed');
    expect(markup).toContain('payment');
    expect(markup).toContain('href="/dashboard"');
  });
});

it('waits for the matching verified confirmation before closing the payment tab', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  window.history.replaceState({}, '', '/bookings/booking-1/payment/success?orderId=new-order');
  mockParams = { bookingId: 'booking-1', outcome: 'success' };
  let channel: { onmessage: ((event: { data: unknown }) => void) | null };
  const register = (value: typeof channel) => {
    channel = value;
  };
  const postMessage = vi.fn(),
    channelClose = vi.fn();
  vi.stubGlobal(
    'BroadcastChannel',
    class {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      constructor() {
        register(this);
      }
      postMessage = postMessage;
      close = channelClose;
    },
  );
  const close = vi.spyOn(window, 'close').mockImplementation(() => {});
  const host = document.createElement('div'),
    root = createRoot(host);
  await act(async () => root.render(createElement(BookingPaymentOutcomePage)));
  expect(postMessage).toHaveBeenCalledWith({
    bookingId: 'booking-1',
    orderId: 'new-order',
    outcome: 'success',
  });
  expect(close).not.toHaveBeenCalled();
  await act(async () => channel!.onmessage?.({ data: { bookingId: 'other', state: 'CONFIRMED' } }));
  expect(close).not.toHaveBeenCalled();
  await act(async () =>
    channel!.onmessage?.({ data: { bookingId: 'booking-1', state: 'PAYMENT_PENDING' } }),
  );
  expect(close).not.toHaveBeenCalled();
  await act(async () =>
    channel!.onmessage?.({ data: { bookingId: 'booking-1', orderId: 'old-order', state: 'PAID' } }),
  );
  expect(close).not.toHaveBeenCalled();
  await act(async () =>
    channel!.onmessage?.({ data: { bookingId: 'booking-1', orderId: 'new-order', state: 'PAID' } }),
  );
  expect(host.textContent).toContain('Payment received');
  await act(async () => vi.advanceTimersByTime(1500));
  expect(close).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
  expect(channelClose).toHaveBeenCalledOnce();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('loads the hotel logo, animates only the checking state and falls back to the hotel name on image error', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const tenant = '11111111-1111-4111-8111-111111111111',
    property = '22222222-2222-4222-8222-222222222222';
  window.history.replaceState(
    {},
    '',
    `/bookings/booking-1/payment/success?orderId=new-order&tenantId=${tenant}&propertyId=${property}`,
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ name: 'Beach Hotel', logoUrl: '/api/media/hotel-logo.png' })),
  );
  mockParams = { bookingId: 'booking-1', outcome: 'success' };
  const host = document.createElement('div'),
    root = createRoot(host);
  await act(async () => root.render(createElement(BookingPaymentOutcomePage)));
  expect(fetch).toHaveBeenCalledWith(
    `/api/tenants/${tenant}/properties/${property}/public/branding`,
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  const logo = host.querySelector('img')!;
  expect(logo.getAttribute('src')).toBe('/api/media/hotel-logo.png');
  expect(logo.alt).toBe('Beach Hotel');
  expect(host.querySelector('[data-testid="payment-checking-dots"]')?.children).toHaveLength(3);
  await act(async () => logo.dispatchEvent(new Event('error')));
  expect(host.textContent).toContain('Beach Hotel');
  expect(host.querySelector('img')).toBeNull();
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
