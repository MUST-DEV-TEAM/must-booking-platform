import { describe, expect, it, vi } from 'vitest';

import { PromoCodeService } from './promo-code.service';
import { QuoteService } from './quote.service';

const base = {
  total: { amount: '210.00', currency: 'EUR' },
  nightlyRates: [
    { date: '2027-07-10', amount: '100.00', currency: 'EUR' },
    { date: '2027-07-11', amount: '110.00', currency: 'EUR' },
  ],
};
const input = {
  roomTypeId: 'rt1',
  ratePlanId: 'rp1',
  startsOn: '2027-07-10',
  endsOn: '2027-07-12',
  adults: 2,
  children: 0,
};

function make(promoRow: Record<string, unknown> | null) {
  const promos = new PromoCodeService({
    withTenantTransaction: vi.fn(async (_scope: unknown, work: (tx: unknown) => unknown) =>
      work({ $queryRaw: vi.fn(async () => (promoRow ? [promoRow] : [])) }),
    ),
  } as never);
  const service = Object.assign(Object.create(QuoteService.prototype), { promos }) as QuoteService;
  // The base price is not what is being tested here.
  (service as unknown as { priceBase: () => Promise<typeof base> }).priceBase = async () => base;
  return service;
}

const row = (extra: Record<string, unknown> = {}) => ({
  id: 'p1',
  code: 'SUMMER10',
  kind: 'PERCENT',
  value: '10.00',
  currency: null,
  bookFrom: null,
  bookUntil: null,
  stayFrom: null,
  stayUntil: null,
  minNights: null,
  roomTypeIds: null,
  maxRedemptions: null,
  redemptions: 0,
  active: true,
  ...extra,
});

describe('quote with a promo code', () => {
  it('takes the hotel code off the price, spreads it over the nights and keeps the original price', async () => {
    const service = make(row());

    const priced = await service.priceWithNightlyRates('t', 'p', {
      ...input,
      promoCode: 'summer10',
    });

    expect(priced.total).toEqual({ amount: '189.00', currency: 'EUR' });
    expect(priced.nightlyRates.map((night) => night.amount)).toEqual(['90.00', '99.00']);
    expect(priced.promo).toMatchObject({
      code: 'SUMMER10',
      source: 'own',
      discount: { amount: '21.00' },
      originalTotal: { amount: '210.00' },
    });
  });

  it('leaves the price alone when no code was entered', async () => {
    const priced = await make(row()).priceWithNightlyRates('t', 'p', input);

    expect(priced.total).toEqual(base.total);
    expect(priced.promo).toBeUndefined();
  });

  it('refuses an unknown or expired code with one message', async () => {
    await expect(
      make(null).priceWithNightlyRates('t', 'p', { ...input, promoCode: 'NOPE' }),
    ).rejects.toThrow('This code is not valid for this stay.');
    await expect(
      make(row({ active: false })).priceWithNightlyRates('t', 'p', {
        ...input,
        promoCode: 'SUMMER10',
      }),
    ).rejects.toThrow('This code is not valid for this stay.');
  });

  it('binds the code to the signed quote, so a booking cannot swap it', () => {
    const service = make(row());
    const signer = service as unknown as {
      sign(payload: unknown): string;
      sessionBinding(sessionId: string): string;
    };
    const payload = {
      version: 1,
      tenantId: 't',
      propertyId: 'p',
      ...input,
      ratePlanId: 'rp1',
      promoCode: 'SUMMER10',
      guestCount: 2,
      total: { amount: '189.00', currency: 'EUR' },
      nightlyRates: [
        { date: '2027-07-10', amount: '90.00' },
        { date: '2027-07-11', amount: '99.00' },
      ],
      expiresAt: '2999-01-01T00:00:00.000Z',
      sessionBinding: signer.sessionBinding('s1'),
    };
    const token = signer.sign(payload);
    const expected = {
      tenantId: 't',
      propertyId: 'p',
      roomTypeId: 'rt1',
      ratePlanId: 'rp1',
      startsOn: '2027-07-10',
      endsOn: '2027-07-12',
      adults: 2,
      children: 0,
      guestCount: 2,
      total: { amount: '189.00', currency: 'EUR' },
    };

    expect(service.validate(token, 's1', { ...expected, promoCode: 'SUMMER10' })).toBeNull();
    expect(service.validate(token, 's1', { ...expected, promoCode: 'OTHER' })?.code).toBe(
      'QUOTE_MISMATCH',
    );
    expect(service.validate(token, 's1', expected)?.code).toBe('QUOTE_MISMATCH');
  });
});
