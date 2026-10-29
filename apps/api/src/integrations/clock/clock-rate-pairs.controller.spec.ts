import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ClockRatePairsController } from './clock-rate-pairs.controller';

const req = { tenantContext: { tenantId: 't', propertyId: 'p', userId: 'u' } };
function setup(
  options: { hidden?: boolean; coded?: boolean; missing?: boolean; mismatch?: boolean } = {},
) {
  const promo = { externalRateId: 'promo' };
  const compare = { externalRateId: 'normal', requiresCode: !!options.coded };
  const rooms = new Map([['rt', options.missing || options.mismatch ? [promo] : [promo, compare]]]);
  if (options.mismatch) rooms.set('other', [compare]);
  const availability = {
    ratesForAllRoomTypesDetailed: vi.fn().mockResolvedValue({ ok: true, value: rooms }),
  };
  const hidden = {
    hiddenRateIds: vi.fn().mockResolvedValue(new Set(options.hidden ? ['normal'] : [])),
  };
  const pairs = {
    pairs: vi.fn().mockResolvedValue({ promo: 'normal' }),
    setPair: vi.fn().mockResolvedValue(true),
  };
  return {
    controller: new ClockRatePairsController(
      availability as never,
      hidden as never,
      pairs as never,
    ),
    pairs,
  };
}

describe('Clock rate pairing validation', () => {
  it('reads, sets and clears a property-scoped pair', async () => {
    const { controller, pairs } = setup();
    expect(await controller.get('p', req)).toEqual({ pairs: { promo: 'normal' } });
    expect(await controller.set('p', 'promo', { compareRateId: 'normal' }, req)).toEqual({
      promoRateId: 'promo',
      compareRateId: 'normal',
    });
    expect(pairs.setPair).toHaveBeenCalledWith('t', 'p', 'promo', 'normal', 'u');
    await controller.set('p', 'promo', { compareRateId: null }, req);
    expect(pairs.setPair).toHaveBeenLastCalledWith('t', 'p', 'promo', null, 'u');
  });
  it.each([{ hidden: true }, { coded: true }, { missing: true }, { mismatch: true }])(
    'rejects non-public or cross-room references %j',
    async (options) => {
      const { controller, pairs } = setup(options);
      await expect(
        controller.set('p', 'promo', { compareRateId: 'normal' }, req),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(pairs.setPair).not.toHaveBeenCalled();
    },
  );
  it.each([undefined, '', 123, 'promo'])(
    'rejects malformed or self-pair comparison %s',
    async (compareRateId) => {
      const { controller, pairs } = setup();
      await expect(controller.set('p', 'promo', { compareRateId }, req)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(pairs.setPair).not.toHaveBeenCalled();
    },
  );
});
