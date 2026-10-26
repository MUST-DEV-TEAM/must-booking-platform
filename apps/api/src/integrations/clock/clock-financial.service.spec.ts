import { describe, it, expect } from 'vitest';
import { financialSnapshot } from './clock-financial.service';
const amount = (cents: number) => ({ cents, currency: 'EUR' });
const identity = {
  bookingId: 'local',
  bookingVersion: 3,
  localPaid: '0.00',
  localRefunded: '0.00',
  connectionId: 'connection',
  fetchedAt: new Date().toISOString(),
};
const data = () => ({
  booking: { balance: amount(-170000) },
  folios: [
    {
      detail: { id: 1, deposit: true, value: amount(0), balance: amount(-340000) },
      credits: [
        { id: 1, value_cents: 170000, currency: 'EUR', payment_type: 'on-line', reference: 'one' },
        { id: 2, value_cents: 170000, currency: 'EUR', payment_type: 'on-line', reference: 'two' },
      ],
    },
    {
      detail: { id: 2, deposit: false, value: amount(170000), balance: amount(170000) },
      credits: [],
    },
  ],
});
describe('verified Clock financial projection', () => {
  it('preserves a credit balance and both real payments without adding local ledger amounts', () => {
    const result = financialSnapshot(data(), identity);
    expect(result.balance.amount).toBe('-1700.00');
    expect(result.paid.amount).toBe('3400.00');
    expect(result.folios[0].payments).toHaveLength(2);
  });
  it('excludes voided payments, keeps refunds and does not count transfers as new guest money', () => {
    const d = data();
    d.folios[0].credits = [
      { id: 1, value_cents: 50000, currency: 'EUR', payment_type: 'cash', reference: 'a' },
      { id: 2, value_cents: -20000, currency: 'EUR', payment_type: 'cash', reference: 'b' },
      { id: 3, value_cents: 30000, currency: 'EUR', payment_type: 'transfer', reference: 'c' },
      {
        id: 4,
        value_cents: 30000,
        currency: 'EUR',
        payment_type: 'cash',
        reference: 'd',
        voided_at: '2026-01-01',
      } as never,
    ];
    d.folios[0].detail.balance = amount(-60000);
    d.booking.balance = amount(110000);
    const result = financialSnapshot(d, identity);
    expect(result.paid.amount).toBe('500.00');
    expect(result.refunded.amount).toBe('200.00');
  });
  it('refuses mixed currencies or repeated external payment identities', () => {
    const d = data();
    d.folios[0].credits[1].currency = 'USD';
    expect(() => financialSnapshot(d, identity)).toThrow('incomplete');
    d.folios[0].credits[1].currency = 'EUR';
    d.folios[0].credits[1].id = 1;
    expect(() => financialSnapshot(d, identity)).toThrow('repeated');
  });
  it('rejects a concurrent folio change instead of publishing an inconsistent snapshot', () => {
    const d = data();
    d.folios[0].detail.balance = amount(-330000);
    expect(() => financialSnapshot(d, identity)).toThrow('changed');
  });
  it('blocks contradictory folio currencies with an actionable retryable reason', () => {
    const d = data();
    d.folios[0].detail.balance.currency = 'ALL';
    expect(() => financialSnapshot(d, identity)).toThrow('inconsistent currencies');
  });
  it('refuses missing balance instead of inventing zero', () => {
    const d = data();
    d.booking.balance = undefined as never;
    expect(() => financialSnapshot(d, identity)).toThrow('missing');
  });
});
