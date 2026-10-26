import { describe, expect, it, vi } from 'vitest';

import {
  PROMO_NOT_VALID,
  PromoCodeService,
  discountMinor,
  discountNights,
  normalizePromoCode,
} from './promo-code.service';

const row = (extra: Record<string, unknown> = {}) =>
  ({
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
  }) as never;

const stay = {
  roomTypeId: 'rt1',
  startsOn: '2027-07-10',
  endsOn: '2027-07-12',
  total: { amount: '210.00', currency: 'EUR' },
  today: '2027-03-01',
};
const service = new PromoCodeService({} as never);

describe('promo code rules', () => {
  it('takes a percentage off and keeps the original price', () => {
    const result = service.check(row(), stay);

    expect(result).toMatchObject({
      applies: true,
      total: { amount: '189.00', currency: 'EUR' },
      promo: {
        code: 'SUMMER10',
        discount: { amount: '21.00', currency: 'EUR' },
        originalTotal: { amount: '210.00', currency: 'EUR' },
      },
    });
  });

  it('takes a fixed amount off but never below zero', () => {
    const fixed = row({ kind: 'FIXED', value: '300.00', currency: 'EUR' });

    expect(service.check(fixed, stay)).toMatchObject({
      applies: true,
      total: { amount: '0.00' },
      promo: { discount: { amount: '210.00' } },
    });
  });

  it.each([
    ['is switched off', { active: false }],
    ['is not yet open for booking', { bookFrom: '2027-04-01' }],
    ['is no longer open for booking', { bookUntil: '2027-02-01' }],
    ['starts before the stay window', { stayFrom: '2027-08-01' }],
    ['ends after the stay window', { stayUntil: '2027-07-11' }],
    ['needs more nights', { minNights: 3 }],
    ['is for other room types', { roomTypeIds: ['other'] }],
    ['has been used up', { maxRedemptions: 5, redemptions: 5 }],
    ['is a fixed amount in another currency', { kind: 'FIXED', value: '20.00', currency: 'GBP' }],
  ])('does not apply when it %s, with the same message every time', (_name, extra) => {
    expect(service.check(row(extra), stay)).toEqual({ applies: false, reason: PROMO_NOT_VALID });
  });

  it('rounds a percentage to the cent', () => {
    expect(discountMinor({ kind: 'PERCENT', value: '12.50' } as never, 3333n)).toBe(417n);
  });
});

describe('reserveUse', () => {
  const scope = { tenantId: 't', propertyId: 'p' };
  const txWith = (ok: boolean | undefined) => ({
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async () => (ok === undefined ? [] : [{ ok }])),
  });

  it('takes a lock for the code, then says whether a use is left', async () => {
    const tx = txWith(true);

    await expect(service.reserveUse(tx as never, scope, 'SUMMER10')).resolves.toBe(true);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('refuses when the limit is used up, the code is off, or it does not exist', async () => {
    await expect(service.reserveUse(txWith(false) as never, scope, 'SUMMER10')).resolves.toBe(
      false,
    );
    await expect(service.reserveUse(txWith(undefined) as never, scope, 'NOPE')).resolves.toBe(
      false,
    );
  });
});

describe('discountNights', () => {
  it('spreads the discount over the nights so they add up to the discounted total', () => {
    const nights = [
      { date: '2027-07-10', amount: '100.00', currency: 'EUR' },
      { date: '2027-07-11', amount: '110.00', currency: 'EUR' },
    ] as never;

    const discounted = discountNights(nights, 21000n, 2100n) as unknown as Array<{
      amount: string;
    }>;

    expect(discounted.map((night) => night.amount)).toEqual(['90.00', '99.00']);
  });
});

describe('normalizePromoCode', () => {
  it('upper-cases, ignores empty input and refuses odd characters', () => {
    expect(normalizePromoCode(' summer10 ')).toBe('SUMMER10');
    expect(normalizePromoCode('')).toBeNull();
    expect(normalizePromoCode(undefined)).toBeNull();
    expect(() => normalizePromoCode('bad code!')).toThrow(PROMO_NOT_VALID);
  });
});
