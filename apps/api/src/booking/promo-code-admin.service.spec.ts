import { describe, expect, it } from 'vitest';

import { parsePromoCodeInput, promoStatus } from './promo-code-admin.service';

const good = { code: 'summer10', kind: 'PERCENT', value: 10 };

describe('parsePromoCodeInput', () => {
  it('accepts a simple percentage code and upper-cases it', () => {
    expect(parsePromoCodeInput(good, 'EUR')).toMatchObject({
      code: 'SUMMER10',
      kind: 'PERCENT',
      value: '10.00',
      currency: null,
      roomTypeIds: null,
      active: true,
    });
  });

  it('gives a fixed amount the hotel currency', () => {
    expect(parsePromoCodeInput({ ...good, kind: 'FIXED', value: '25' }, 'ALL')).toMatchObject({
      kind: 'FIXED',
      value: '25.00',
      currency: 'ALL',
    });
  });

  it.each([
    ['no code', { ...good, code: '' }],
    ['a code with odd characters', { ...good, code: 'a b!' }],
    ['no discount type', { ...good, kind: 'OTHER' }],
    ['a zero discount', { ...good, value: 0 }],
    ['more than 100 percent', { ...good, value: 150 }],
    [
      'booking dates in the wrong order',
      { ...good, bookFrom: '2027-05-01', bookUntil: '2027-04-01' },
    ],
    [
      'a stay window in the wrong order',
      { ...good, stayFrom: '2027-08-01', stayUntil: '2027-07-01' },
    ],
    ['a bad date', { ...good, stayFrom: 'tomorrow' }],
    ['a room type that is not an id', { ...good, roomTypeIds: ['not-an-id'] }],
    ['a minimum of zero nights', { ...good, minNights: 0 }],
  ])('refuses %s', (_name, body) => {
    expect(() => parsePromoCodeInput(body, 'EUR')).toThrow();
  });
});

describe('promoStatus', () => {
  const code = {
    active: true,
    maxRedemptions: null as number | null,
    redemptions: 0,
    bookFrom: null as string | null,
    bookUntil: null as string | null,
    stayUntil: null as string | null,
  };
  const today = '2027-03-01';

  it.each([
    ['a plain code is active', {}, 'ACTIVE'],
    [
      'a switched-off code is off, whatever else is true',
      { active: false, maxRedemptions: 1, redemptions: 1 },
      'OFF',
    ],
    ['a code with all its uses taken is used up', { maxRedemptions: 5, redemptions: 5 }, 'USED_UP'],
    ['a code past its last booking day is expired', { bookUntil: '2027-02-28' }, 'EXPIRED'],
    ['a code whose stay window is over is expired', { stayUntil: '2027-02-01' }, 'EXPIRED'],
    ['a code that opens later is not open yet', { bookFrom: '2027-04-01' }, 'SCHEDULED'],
    ['a code with uses left is active', { maxRedemptions: 5, redemptions: 4 }, 'ACTIVE'],
  ])('%s', (_name, extra, expected) => {
    expect(promoStatus({ ...code, ...extra }, today)).toBe(expected);
  });
});
