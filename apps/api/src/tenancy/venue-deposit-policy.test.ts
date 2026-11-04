import { describe, expect, it } from 'vitest';
import {
  depositMinor,
  parseDepositRules,
  priceDeposit,
  type DepositRule,
} from './venue-deposit-policy';
const service = '11111111-1111-4111-8111-111111111111';
const area = '22222222-2222-4222-8222-222222222222';
const rule: DepositRule = {
  serviceId: null,
  areaId: null,
  mode: 'per_booking',
  amount: '20.00',
  minParty: 1,
  freeCancelHours: 24,
};
describe('restaurant deposit pricing', () => {
  it('uses restaurant, then service, then area without adding charges', () => {
    const rules = [
      rule,
      { ...rule, serviceId: service, amount: '15.00' },
      { ...rule, serviceId: service, areaId: area, mode: 'per_guest' as const, amount: '0.29' },
    ];
    expect(priceDeposit(rules, service, area, 3).total).toBe('0.87');
    expect(priceDeposit(rules, service, 'elsewhere', 3).total).toBe('15.00');
    expect(priceDeposit(rules, 'brunch', area, 3).total).toBe('20.00');
  });
  it('lets an exact no-deposit rule waive inherited rates and respects minimum party', () => {
    expect(
      priceDeposit(
        [rule, { ...rule, serviceId: service, mode: 'none', amount: '0.00' }],
        service,
        area,
        4,
      ).total,
    ).toBe('0.00');
    expect(priceDeposit([{ ...rule, minParty: 5 }], service, area, 4).total).toBe('0.00');
    expect(priceDeposit([], service, area, 4).total).toBe('0.00');
  });
  it('validates exact amounts, scope uniqueness and bounds', () => {
    expect(depositMinor('0.29')).toBe(29n);
    expect(
      parseDepositRules({ version: 0, rules: [{ ...rule, amount: '20' }] }).rules[0]?.amount,
    ).toBe('20.00');
    for (const rules of [
      [rule, rule],
      [{ ...rule, areaId: area }],
      [{ ...rule, amount: '1.234' }],
      [{ ...rule, minParty: 0 }],
      [{ ...rule, mode: 'none' }],
      [{ ...rule, freeCancelHours: -1 }],
    ])
      expect(() => parseDepositRules({ version: 0, rules })).toThrow();
  });
});
