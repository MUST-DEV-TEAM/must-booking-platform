import { describe, expect, it, vi } from 'vitest';

const { reportOperationalFailure } = vi.hoisted(() => ({ reportOperationalFailure: vi.fn() }));
vi.mock('../../observability/error-tracking', () => ({ reportOperationalFailure }));

import { ClockPaymentReconciliationService } from './clock-payment-reconciliation.service';

const credentials = { host: 'h', accountId: '1', subscriptionId: '2', apiUser: 'u', apiKey: 'k' };

const paidBooking = {
  id: 'booking-1',
  externalBookingId: '38149736',
  externalReference: 'must-order-abc-room1',
  currency: 'EUR',
  paidAmount: '250.00',
};

function makeService(bookings: unknown[], clockResponses: unknown[]) {
  const transaction = { $queryRaw: vi.fn().mockResolvedValue(bookings) };
  const database = { withTenantTransaction: vi.fn((_context, callback) => callback(transaction)) };
  const connections = {
    activePmsConnectionCredentials: vi
      .fn()
      .mockResolvedValue({ connectionId: 'connection', provider: 'CLOCK_PMS', credentials }),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const manualReview = { record: vi.fn().mockResolvedValue(undefined) };
  const client = {
    request: vi.fn().mockImplementation(() => {
      const body = clockResponses.shift();
      return Promise.resolve({ status: 200, body });
    }),
  };
  const rateLimiter = { consume: vi.fn().mockResolvedValue({ allowed: true }) };
  const circuitBreaker = { assertClosed: vi.fn(), recordSuccess: vi.fn(), recordFailure: vi.fn() };
  return {
    service: new ClockPaymentReconciliationService(
      database as never,
      connections as never,
      audit as never,
      manualReview as never,
      client as never,
      rateLimiter as never,
      circuitBreaker as never,
    ),
    client,
    audit,
    manualReview,
  };
}

const since = new Date('2026-08-04T00:00:00Z');

describe('ClockPaymentReconciliationService', () => {
  it('finds no mismatch when the deposit folio has a matching credit_item', async () => {
    const { service, manualReview, audit } = makeService(
      [paidBooking],
      [
        [76090570, 76090571], // GET /bookings/{id}/folios/
        { id: 76090570, deposit: false }, // general folio, not a deposit folio
        { id: 76090571, deposit: true }, // deposit folio
        [{ id: 1, reference: 'must-order-abc-room1', value_cents: 25000, currency: 'EUR' }],
      ],
    );

    await expect(service.check('tenant', 'property', since)).resolves.toEqual({
      bookingsChecked: 1,
      findings: [],
    });
    expect(manualReview.record).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'clock_payment_reconciliation.checked',
        details: { bookingsChecked: 1, findingCounts: {} },
      }),
    );
  });

  it('flags a booking with no deposit folio at all', async () => {
    const { service, manualReview } = makeService(
      [paidBooking],
      [[76090570], { id: 76090570, deposit: false }],
    );

    await expect(service.check('tenant', 'property', since)).resolves.toEqual({
      bookingsChecked: 1,
      findings: [{ type: 'DEPOSIT_FOLIO_MISSING', bookingId: 'booking-1' }],
    });
    expect(manualReview.record).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'PAYMENT_BOOKING_MISMATCH',
        referenceId: 'booking-1',
      }),
    );
  });

  it('flags a deposit folio with no credit_item matching the booking reference', async () => {
    const { service, manualReview } = makeService(
      [paidBooking],
      [[76090571], { id: 76090571, deposit: true }, []],
    );

    await expect(service.check('tenant', 'property', since)).resolves.toEqual({
      bookingsChecked: 1,
      findings: [
        { type: 'CREDIT_ITEM_MISSING', bookingId: 'booking-1', depositFolioIds: ['76090571'] },
      ],
    });
    expect(manualReview.record).toHaveBeenCalledOnce();
  });

  it('flags a credit_item amount that does not match what MUST actually charged', async () => {
    const { service, manualReview } = makeService(
      [paidBooking],
      [
        [76090571],
        { id: 76090571, deposit: true },
        [{ id: 1, reference: 'must-order-abc-room1', value_cents: 10000, currency: 'EUR' }],
      ],
    );

    await expect(service.check('tenant', 'property', since)).resolves.toEqual({
      bookingsChecked: 1,
      findings: [
        {
          type: 'CREDIT_ITEM_AMOUNT_MISMATCH',
          bookingId: 'booking-1',
          expectedAmount: '250.00',
          expectedCurrency: 'EUR',
          postedAmount: '100.00',
          postedCurrency: 'EUR',
        },
      ],
    });
    expect(manualReview.record).toHaveBeenCalledOnce();
  });

  it('does nothing and checks no bookings when none are in scope', async () => {
    const { service, manualReview, audit } = makeService([], []);

    await expect(service.check('tenant', 'property', since)).resolves.toEqual({
      bookingsChecked: 0,
      findings: [],
    });
    expect(manualReview.record).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ details: { bookingsChecked: 0, findingCounts: {} } }),
    );
  });

  it('reports and rethrows on an unexpected failure', async () => {
    const { service } = makeService([paidBooking], []);
    await expect(service.check('tenant', 'property', since)).rejects.toThrow();
    expect(reportOperationalFailure).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ operation: 'payment-reconciliation-check' }),
    );
  });
});
