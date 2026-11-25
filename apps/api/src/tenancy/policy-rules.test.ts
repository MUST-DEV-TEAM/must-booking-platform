import { BadRequestException } from '@nestjs/common';
import {
  checkPolicies,
  checkMoneyAmount,
  normaliseMoney,
  staleDependents,
} from '@must/domain-contracts';
import { describe, expect, it } from 'vitest';

import { checkHotelSettings, hotelInput, policyCleanup } from './hotel-settings';

describe('money amounts', () => {
  it('normalises to two decimals and accepts a comma', () => {
    expect(normaliseMoney('15')).toBe('15.00');
    expect(normaliseMoney('7,5')).toBe('7.50');
    expect(normaliseMoney('')).toBeNull();
    expect(normaliseMoney(null)).toBeNull();
  });
  it('refuses zero, negatives, too many decimals and absurd sizes', () => {
    for (const bad of ['0', '-3', '1.234', 'abc', '100000'])
      expect(checkMoneyAmount(bad), bad).not.toBeNull();
    expect(checkMoneyAmount('99999.99')).toBeNull();
    expect(checkMoneyAmount('')).toBeNull();
  });
});

describe('checkPolicies', () => {
  it('needs check-in until to be later than check-in from, and from to exist', () => {
    expect(checkPolicies({ checkInTime: '15:00', checkInUntil: '14:00' }).checkInUntil).toMatch(
      /later/,
    );
    expect(checkPolicies({ checkInTime: '15:00', checkInUntil: '15:00' }).checkInUntil).toMatch(
      /later/,
    );
    expect(checkPolicies({ checkInUntil: '22:00' }).checkInUntil).toMatch(/from time first/);
    expect(checkPolicies({ checkInTime: '15:00', checkInUntil: '23:00' })).toEqual({});
  });
  it('needs check-out from to be earlier than check-out by', () => {
    expect(checkPolicies({ checkOutTime: '11:00', checkOutFrom: '11:00' }).checkOutFrom).toMatch(
      /earlier/,
    );
    expect(checkPolicies({ checkOutTime: '11:00', checkOutFrom: '07:00' })).toEqual({});
  });
  it('asks for a price and a maximum when cots or extra beds are offered', () => {
    expect(checkPolicies({ cotsPolicy: 'not_available' })).toEqual({});
    expect(checkPolicies({ cotsPolicy: 'free', cotsMax: 1 })).toEqual({});
    expect(checkPolicies({ cotsPolicy: 'free' }).cotsMax).toBeDefined();
    expect(checkPolicies({ cotsPolicy: 'paid', cotsMax: 2 }).cotsFee).toBeDefined();
    expect(checkPolicies({ extraBedsPolicy: 'paid', extraBedsFee: '20', extraBedsMax: 1 })).toEqual(
      {},
    );
  });
  it('asks for a pet fee only when pets are welcome and the fee is not free', () => {
    expect(
      checkPolicies({ petsPolicy: 'allowed', petsFeeType: 'per_night' }).petsFee,
    ).toBeDefined();
    expect(checkPolicies({ petsPolicy: 'not_allowed', petsFeeType: 'per_night' })).toEqual({});
    expect(checkPolicies({ petsPolicy: 'allowed', petsFeeType: 'free' })).toEqual({});
  });
  it('needs at least one accepted document when ID is asked for', () => {
    expect(checkPolicies({ idAtArrival: 'all_adults', idDocuments: [] }).idDocuments).toBeDefined();
    expect(checkPolicies({ idAtArrival: 'not_required', idDocuments: [] })).toEqual({});
    expect(checkPolicies({ idAtArrival: 'main_guest', idDocuments: ['passport'] })).toEqual({});
  });
  it('needs a method and a refund time with a damage deposit', () => {
    const problems = checkPolicies({ damageDepositAmount: '100' });
    expect(problems.damageDepositMethod).toBeDefined();
    expect(problems.damageDepositRefundDays).toBeDefined();
    expect(
      checkPolicies({
        damageDepositAmount: '100',
        damageDepositMethod: 'card',
        damageDepositRefundDays: 7,
      }),
    ).toEqual({});
  });
});

describe('staleDependents', () => {
  it('clears what no longer applies and nothing else', () => {
    expect(
      staleDependents({
        cotsPolicy: 'free',
        cotsFee: '10.00',
        cotsMax: 2,
        extraBedsPolicy: 'paid',
        extraBedsFee: '5.00',
        extraBedsMax: 1,
      }),
    ).toEqual({ cotsFee: null });
    expect(
      staleDependents({
        petsPolicy: 'not_allowed',
        petsFeeType: 'per_stay',
        petsFee: '20.00',
        petsMax: 2,
      }),
    ).toEqual({ petsFeeType: null, petsMax: null, petsFee: null });
    expect(staleDependents({ idAtArrival: 'not_required', idDocuments: ['passport'] })).toEqual({
      idDocuments: [],
    });
    expect(
      staleDependents({
        damageDepositMethod: 'cash',
        damageDepositRefundDays: 5,
        damageDepositAmount: null,
      }),
    ).toEqual({ damageDepositMethod: null, damageDepositRefundDays: null });
  });
  it('policyCleanup leaves a field alone that the same save sets', () => {
    expect(
      policyCleanup({ cotsPolicy: 'free', cotsFee: '10.00', cotsMax: 1 }, ['cotsPolicy']),
    ).toEqual({ cotsFee: null });
    expect(
      policyCleanup({ cotsPolicy: 'free', cotsFee: '10.00' }, ['cotsPolicy', 'cotsFee']),
    ).toEqual({});
    expect(policyCleanup({ cotsPolicy: 'free', cotsFee: '10.00' }, ['name'])).toEqual({});
  });
});

describe('hotelInput for policies', () => {
  it('stores a normalised price and accepted documents', () => {
    expect(hotelInput({ cotsFee: '7,5', idDocuments: ['passport', 'national_id'] })).toEqual({
      cotsFee: '7.50',
      idDocuments: ['national_id', 'passport'],
    });
  });
  it('refuses a bad price, a document that is not on the list and an unknown choice', () => {
    expect(() => hotelInput({ cotsFee: '-1' })).toThrow(BadRequestException);
    expect(() => hotelInput({ idDocuments: ['library_card'] })).toThrow(BadRequestException);
    expect(() => hotelInput({ smokingPolicy: 'sometimes' })).toThrow(BadRequestException);
    expect(() => hotelInput({ cotsPolicy: null })).toThrow(BadRequestException);
    expect(() => hotelInput({ cotsMax: 4 })).toThrow(BadRequestException);
    expect(() => hotelInput({ petsMax: 0 })).toThrow(BadRequestException);
    expect(() => hotelInput({ damageDepositRefundDays: 31 })).toThrow(BadRequestException);
  });
  it('allows empty optional choices and keeps the length limits', () => {
    expect(hotelInput({ smokingPolicy: '', petsFeeType: null })).toEqual({
      smokingPolicy: null,
      petsFeeType: null,
    });
    expect(() => hotelInput({ otherHouseRules: 'x'.repeat(1001) })).toThrow(BadRequestException);
    expect(() => hotelInput({ lateArrivalInstructions: 'x'.repeat(501) })).toThrow(
      BadRequestException,
    );
  });
  it('checkHotelSettings runs the cross-field rules on the merged values', () => {
    expect(() =>
      checkHotelSettings({ checkInTime: '15:00', checkInUntil: '10:00' } as never, [
        'checkInUntil',
      ]),
    ).toThrow(/later/);
    expect(() =>
      checkHotelSettings({ checkInTime: '15:00', checkInUntil: '10:00' } as never, ['name']),
    ).not.toThrow();
  });
});
