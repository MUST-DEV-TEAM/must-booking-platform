import { describe, expect, it } from 'vitest';

import { buildHealthSignals, type HealthFacts } from './system-health';

const base: HealthFacts = {
  now: new Date('2026-10-20T12:00:00Z'),
  pms: null,
  openManualReviews: 0,
  failedProviderOperations24h: 0,
  bookingsNeedingAttention: 0,
  gateways: { stripe: false, pokpay: true, payAtHotel: true },
  paymentConnections: [{ provider: 'POKPAY', status: 'CONNECTED' }],
  failedPayments24h: 0,
  emailsFailed24h: 0,
  emailsStuckQueued: 0,
};
const by = (facts: HealthFacts, key: string) =>
  buildHealthSignals(facts).find((s) => s.key === key)!;

describe('hotel system health signals', () => {
  it('is healthy when nothing is wrong and a MUST-only hotel needs no provider', () => {
    const signals = buildHealthSignals(base);
    expect(signals.map((s) => s.status)).toEqual(['healthy', 'healthy', 'healthy', 'healthy']);
    expect(by(base, 'pms').headline).toBe('Bookings are stored in MUST');
  });

  it('flags a failed or unverified provider connection and open manual reviews', () => {
    const failed = by(
      {
        ...base,
        pms: {
          provider: 'CLOCK_PMS',
          status: 'FAILED',
          lastTestResult: 'Bad key',
          lastWebhookReceivedAt: null,
        },
      },
      'pms',
    );
    expect(failed.status).toBe('attention');
    expect(failed.headline).toBe('The connection test failed.');
    const reviews = by(
      {
        ...base,
        openManualReviews: 2,
        pms: {
          provider: 'CLOCK_PMS',
          status: 'CONNECTED',
          lastTestResult: null,
          lastWebhookReceivedAt: new Date('2026-10-20T10:30:00Z'),
        },
      },
      'pms',
    );
    expect(reviews.status).toBe('attention');
    expect(reviews.headline).toBe('2 bookings waiting for a manual review.');
    expect(reviews.details.join(' ')).toContain('1 h ago');
    expect(reviews.action?.section).toBe('settings');
  });

  it('flags a switched-on gateway that is not connected, failed payments and no method at all', () => {
    expect(by({ ...base, paymentConnections: [] }, 'payments').headline).toBe(
      'pokpay is switched on but not connected.',
    );
    expect(by({ ...base, failedPayments24h: 1 }, 'payments').headline).toBe(
      '1 payment failed in the last 24 hours.',
    );
    const none = by(
      { ...base, gateways: { stripe: false, pokpay: false, payAtHotel: false } },
      'payments',
    );
    expect(none).toMatchObject({
      status: 'attention',
      headline: 'No payment method is switched on',
    });
  });

  it('flags reservations needing attention and email failures with a fix link', () => {
    expect(by({ ...base, bookingsNeedingAttention: 3 }, 'reservations')).toMatchObject({
      status: 'attention',
      headline: '3 reservations need attention',
    });
    const mail = by({ ...base, emailsFailed24h: 4, emailsStuckQueued: 1 }, 'emails');
    expect(mail.status).toBe('attention');
    expect(mail.details[0]).toBe('1 email waiting to send for over 30 minutes.');
    expect(mail.action?.section).toBe('emails');
  });
});
