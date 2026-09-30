import { describe, expect, it, vi } from 'vitest';

import { PaymentLedgerService } from './payment-ledger.service';

const context = { tenantId: 't-1', propertyId: 'p-1' };
const bookingId = '9b686501-e318-4f6d-9c5e-6bcfe3ff5ed5';

// The service issues three queries in order: booking exists, payments, audit events.
function serviceReturning(...results: unknown[][]) {
  const queryRaw = vi.fn();
  for (const result of results) queryRaw.mockResolvedValueOnce(result);
  const database = {
    withTenantTransaction: vi.fn((_context: unknown, callback: (tx: unknown) => unknown) =>
      callback({ $queryRaw: queryRaw }),
    ),
  };
  return {
    service: new PaymentLedgerService(database as never),
    queryRaw,
    database,
  };
}

describe('PaymentLedgerService', () => {
  it('returns null without touching the database for an id that is not a UUID', async () => {
    const { service, database } = serviceReturning();
    await expect(service.ledger(context, "x'; DROP TABLE payments;--")).resolves.toBeNull();
    expect(database.withTenantTransaction).not.toHaveBeenCalled();
  });

  it('returns null when the booking is not in this property', async () => {
    const { service, queryRaw } = serviceReturning([]);
    await expect(service.ledger(context, bookingId)).resolves.toBeNull();
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('lists the payments in order and names who issued a refund', async () => {
    const { service } = serviceReturning(
      [{ id: bookingId }],
      [
        {
          id: 'pay-1',
          kind: 'CHARGE',
          provider: 'pokpay',
          method: null,
          externalPaymentId: 'order-1',
          status: 'PAID',
          amount: '250.00',
          currency: 'EUR',
          note: null,
          createdAt: new Date('2026-09-30T20:36:00Z'),
        },
        {
          id: 'pay-2',
          kind: 'REFUND',
          provider: 'pokpay',
          method: null,
          externalPaymentId: 'refund-1',
          status: 'REFUNDED',
          amount: '50.00',
          currency: 'EUR',
          note: 'goodwill',
          createdAt: new Date('2026-10-01T09:00:00Z'),
        },
      ],
      [
        {
          action: 'payment.refunded',
          createdAt: new Date('2026-10-01T09:00:01Z'),
          actorEmail: 'reception@hotel.test',
          details: {
            refundExternalPaymentId: 'refund-1',
            amount: { amount: '50.00', currency: 'EUR' },
          },
        },
      ],
    );

    const ledger = await service.ledger(context, bookingId);

    expect(ledger?.entries.map((entry) => [entry.kind, entry.amount, entry.actorEmail])).toEqual([
      ['CHARGE', '250.00', null],
      ['REFUND', '50.00', 'reception@hotel.test'],
    ]);
    expect(ledger?.entries[0].createdAt).toBe('2026-09-30T20:36:00.000Z');
    expect(ledger?.events).toHaveLength(1);
  });

  it('shows only whitelisted audit details, never a provider payload', async () => {
    const { service } = serviceReturning(
      [{ id: bookingId }],
      [],
      [
        {
          action: 'booking.clock_deposit_posted',
          createdAt: new Date('2026-09-30T20:36:29Z'),
          actorEmail: null,
          details: {
            folioId: 77312461,
            paymentSubType: 'PokPay',
            rawProviderResponse: { token: 'secret' },
            apiKey: 'must-not-leak',
          },
        },
      ],
    );

    const ledger = await service.ledger(context, bookingId);

    expect(ledger?.events[0].details).toEqual({ folioId: 77312461, paymentSubType: 'PokPay' });
  });
});
