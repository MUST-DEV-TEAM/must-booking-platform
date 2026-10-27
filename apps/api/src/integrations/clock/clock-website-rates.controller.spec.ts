import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { ClockWebsiteRatesController } from './clock-website-rates.controller';

const rate = (externalRateId: string, label: string) => ({
  externalRateId,
  name: label,
  label,
  mealNames: [],
  maxAdults: null,
  maxChildren: null,
});
const request = { tenantContext: { tenantId: 't1', propertyId: 'p1', userId: 'u1' } };

function setup(hidden: string[] = [], changed = true) {
  const availability = {
    ratesForAllRoomTypesDetailed: vi.fn().mockResolvedValue({
      ok: true,
      value: new Map([['rt-1', [rate('2', 'Full board'), rate('1', 'Bed & breakfast')]]]),
    }),
  };
  const websiteRates = {
    hiddenRateIds: vi.fn().mockResolvedValue(new Set(hidden)),
    setOnWebsite: vi.fn().mockResolvedValue(changed),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const controller = new ClockWebsiteRatesController(
    availability as never,
    websiteRates as never,
    audit as never,
  );
  return { controller, websiteRates, audit };
}

describe('ClockWebsiteRatesController', () => {
  it('lists every published rate as on the website unless staff switched it off', async () => {
    const { controller } = setup(['2']);
    const { roomTypes } = await controller.get('p1', request);
    expect(roomTypes['rt-1'].map((r) => [r.label, r.onWebsite])).toEqual([
      ['Bed & breakfast', true],
      ['Full board', false],
    ]);
  });

  it('switches a rate off, remembers who did it and writes an audit entry', async () => {
    const { controller, websiteRates, audit } = setup();
    await expect(controller.set('p1', '2', { onWebsite: false }, request)).resolves.toEqual({
      externalRateId: '2',
      onWebsite: false,
    });
    expect(websiteRates.setOnWebsite).toHaveBeenCalledWith('t1', 'p1', '2', false, 'u1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'rates.website_visibility_changed',
        targetId: '2',
        details: { rateName: 'Full board', onWebsite: false },
      }),
    );
  });

  it('writes no audit entry when nothing changed, and refuses a rate Clock does not publish', async () => {
    const unchanged = setup([], false);
    await unchanged.controller.set('p1', '2', { onWebsite: true }, request);
    expect(unchanged.audit.record).not.toHaveBeenCalled();

    const { controller, websiteRates } = setup();
    await expect(controller.set('p1', '999', { onWebsite: false }, request)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(controller.set('p1', '2', { onWebsite: 'no' }, request)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(websiteRates.setOnWebsite).not.toHaveBeenCalled();
  });
});
