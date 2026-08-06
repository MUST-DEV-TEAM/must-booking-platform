import { createElement } from 'react';
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

    expect(markup).toContain('Payment received');
    expect(markup).toContain('Taking you back to the dashboard');
    expect(markup).toContain('href="/dashboard"');
    expect(markup).not.toContain('was not completed');
  });

  it('explains a cancelled checkout without claiming a charge occurred', () => {
    mockParams = { bookingId: 'booking-1', outcome: 'cancel' };
    const markup = renderToStaticMarkup(createElement(BookingPaymentOutcomePage));

    expect(markup).toContain('Payment was not completed');
    expect(markup).toContain('has not been charged');
    expect(markup).toContain('href="/dashboard"');
  });
});
