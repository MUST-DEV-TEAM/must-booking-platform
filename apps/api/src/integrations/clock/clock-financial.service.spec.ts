import { describe, it, expect } from 'vitest';
import {
  ClockFinancialCurrencyError,
  ClockFinancialDataError,
  financialSnapshot,
} from './clock-financial.service';
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

// Real shapes read from Clock on 2026-11-06. Clock keeps each bill (folio) in its own currency and records a
// payment in the currency the guest paid, plus its value converted into the bill's currency (fixed_value_*).
const money = (cents: number, currency: string) => ({ cents, currency });
describe('Clock bills and payments in more than one currency', () => {
  it('accepts a payment made in ALL on an EUR booking, using its EUR value for the bill', () => {
    const result = financialSnapshot(
      {
        booking: { balance: money(0, 'EUR') },
        folios: [
          {
            detail: { id: 1, deposit: false, value: money(44688, 'EUR'), balance: money(0, 'EUR') },
            credits: [
              {
                id: 7,
                value_cents: 4245360,
                currency: 'ALL',
                fixed_value_cents: 44688,
                fixed_value_currency: 'EUR',
                payment_type: 'card',
                reference: null,
              },
            ],
          },
        ],
      },
      identity,
    );
    expect(result.paid).toEqual({ amount: '446.88', currency: 'EUR' });
    expect(result.balance.amount).toBe('0.00');
    expect(result.folios[0].payments[0].amount).toEqual({ amount: '42453.60', currency: 'ALL' });
  });

  it('adds a payment in the bill currency and a payment converted into it on the same bill', () => {
    const result = financialSnapshot(
      {
        booking: { balance: money(0, 'EUR') },
        folios: [
          {
            detail: { id: 1, deposit: false, value: money(73000, 'EUR'), balance: money(0, 'EUR') },
            credits: [
              {
                id: 1,
                value_cents: 4873500,
                currency: 'ALL',
                fixed_value_cents: 51300,
                fixed_value_currency: 'EUR',
                payment_type: 'card',
              },
              {
                id: 2,
                value_cents: 21700,
                currency: 'EUR',
                fixed_value_cents: 21700,
                fixed_value_currency: 'EUR',
                payment_type: 'bank',
              },
            ],
          },
        ],
      },
      identity,
    );
    expect(result.paid.amount).toBe('730.00');
  });

  // The Empire booking of 2026-11-06: an ALL booking whose deposit bill Clock holds in EUR (1 EUR = 90 ALL).
  const empire = () => ({
    booking: { balance: money(4312040, 'ALL') },
    folios: [
      {
        detail: {
          id: 1,
          deposit: false,
          value: money(2156000, 'ALL'),
          balance: money(2156000, 'ALL'),
        },
        credits: [],
      },
      {
        detail: {
          id: 2,
          deposit: true,
          value: money(23956, 'EUR'),
          balance: money(23956, 'EUR'),
          local_currency: 'ALL',
          fixed_currency_rate: 90,
        },
        credits: [
          {
            id: 10,
            value_cents: 2156000,
            currency: 'ALL',
            fixed_value_cents: 23956,
            fixed_value_currency: 'EUR',
            payment_type: 'on-line',
          },
          {
            id: 11,
            value_cents: -2156000,
            currency: 'ALL',
            fixed_value_cents: -23956,
            fixed_value_currency: 'EUR',
            payment_type: 'on-line',
          },
        ],
      },
    ],
  });

  it('accepts an ALL booking whose deposit bill is held in EUR, and reports totals in ALL', () => {
    const result = financialSnapshot(empire(), identity);
    expect(result.balance).toEqual({ amount: '43120.40', currency: 'ALL' });
    expect(result.paid).toEqual({ amount: '21560.00', currency: 'ALL' });
    expect(result.refunded).toEqual({ amount: '21560.00', currency: 'ALL' });
    expect(result.folios[1].balance).toEqual({ amount: '239.56', currency: 'EUR' });
  });

  it('still refuses a bill in another currency when Clock gives no rate to relate it to the booking', () => {
    const d = empire();
    delete (d.folios[1].detail as Record<string, unknown>).fixed_currency_rate;
    expect(() => financialSnapshot(d, identity)).toThrow(ClockFinancialCurrencyError);
  });

  it('still refuses a payment in another currency that has no converted value', () => {
    const d = empire();
    delete (d.folios[1].credits[0] as Record<string, unknown>).fixed_value_cents;
    expect(() => financialSnapshot(d, identity)).toThrow('incomplete');
  });

  it('still notices when the converted bills do not add up to the booking balance', () => {
    const d = empire();
    d.booking.balance = money(4312040 + 500, 'ALL');
    expect(() => financialSnapshot(d, identity)).toThrow('changed');
  });

  it('tolerates one minor unit of rounding per converted bill, and no more', () => {
    const rounded = empire();
    rounded.booking.balance = money(4312040 + 1, 'ALL');
    expect(() => financialSnapshot(rounded, identity)).not.toThrow();
    const off = empire();
    off.booking.balance = money(4312040 + 2, 'ALL');
    expect(() => financialSnapshot(off, identity)).toThrow('changed');
  });

  it('shows a cause in the logs: every refusal is a ClockFinancialDataError with a fixed message', () => {
    const d = empire();
    delete (d.folios[1].credits[0] as Record<string, unknown>).fixed_value_cents;
    try {
      financialSnapshot(d, identity);
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(ClockFinancialDataError);
      expect((error as Error).name).toBe('ClockFinancialDataError');
    }
    expect(new ClockFinancialCurrencyError()).toBeInstanceOf(ClockFinancialDataError);
  });
});
