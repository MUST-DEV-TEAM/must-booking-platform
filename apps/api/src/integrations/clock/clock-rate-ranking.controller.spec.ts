import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { ClockRateRankingController } from './clock-rate-ranking.controller';

const request = { tenantContext: { tenantId: 't1' } };

function makeController(overrides: {
  rates?: Array<{ externalRateId: string; name: string; maxAdults: number | null; maxChildren: number | null }>;
  ratesFailure?: string;
  ranking?: Array<{ externalRateId: string; rank: number }>;
} = {}) {
  const availability = {
    ratesForRoomTypeDetailed: vi.fn().mockResolvedValue(
      overrides.ratesFailure
        ? { ok: false, error: { message: overrides.ratesFailure } }
        : { ok: true, value: overrides.rates ?? [] },
    ),
  };
  const rankings = {
    getRanking: vi.fn().mockResolvedValue(overrides.ranking ?? []),
    setRanking: vi.fn().mockResolvedValue(undefined),
  };
  const controller = new ClockRateRankingController(availability as never, rankings as never);
  return { controller, availability, rankings };
}

describe('ClockRateRankingController.get', () => {
  it('sorts ranked rates first (by rank) then unranked rates by name', async () => {
    const { controller } = makeController({
      rates: [
        { externalRateId: 'z-unranked', name: 'Zebra Rate', maxAdults: null, maxChildren: null },
        { externalRateId: 'r1', name: 'Rank One', maxAdults: 2, maxChildren: 1 },
        { externalRateId: 'a-unranked', name: 'Alpha Rate', maxAdults: null, maxChildren: null },
        { externalRateId: 'r0', name: 'Rank Zero', maxAdults: 4, maxChildren: 2 },
      ],
      ranking: [
        { externalRateId: 'r0', rank: 0 },
        { externalRateId: 'r1', rank: 1 },
      ],
    });

    const result = await controller.get('p1', 'rt1', request);

    expect(result.rates.map((rate) => rate.externalRateId)).toEqual([
      'r0',
      'r1',
      'a-unranked',
      'z-unranked',
    ]);
    expect(result.rates[0]).toEqual({
      externalRateId: 'r0',
      name: 'Rank Zero',
      maxAdults: 4,
      maxChildren: 2,
      rank: 0,
    });
    expect(result.rates[2].rank).toBeNull();
  });

  it('throws when Clock reports a configuration error (e.g. no confirmed catalog mapping)', async () => {
    const { controller } = makeController({ ratesFailure: 'This room type has no confirmed Clock catalog mapping.' });

    await expect(controller.get('p1', 'rt1', request)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ClockRateRankingController.set', () => {
  it('rejects a rate id that is not among the room type’s current, published Clock rates', async () => {
    const { controller, rankings } = makeController({
      rates: [{ externalRateId: 'r0', name: 'Rank Zero', maxAdults: null, maxChildren: null }],
    });

    await expect(
      controller.set('p1', 'rt1', { externalRateIds: ['r0', 'not-a-real-rate'] }, request),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(rankings.setRanking).not.toHaveBeenCalled();
  });

  it('rejects a duplicate rate id in the submitted order', async () => {
    const { controller, rankings } = makeController({
      rates: [{ externalRateId: 'r0', name: 'Rank Zero', maxAdults: null, maxChildren: null }],
    });

    await expect(
      controller.set('p1', 'rt1', { externalRateIds: ['r0', 'r0'] }, request),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(rankings.setRanking).not.toHaveBeenCalled();
  });

  it('rejects a malformed body', async () => {
    const { controller, rankings } = makeController();

    await expect(controller.set('p1', 'rt1', { externalRateIds: 'not-an-array' }, request)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(rankings.setRanking).not.toHaveBeenCalled();
  });

  it('stores the validated order and returns the refreshed ranking', async () => {
    const { controller, rankings } = makeController({
      rates: [
        { externalRateId: 'r0', name: 'Rank Zero', maxAdults: null, maxChildren: null },
        { externalRateId: 'r1', name: 'Rank One', maxAdults: null, maxChildren: null },
      ],
      ranking: [
        { externalRateId: 'r1', rank: 0 },
        { externalRateId: 'r0', rank: 1 },
      ],
    });

    const result = await controller.set('p1', 'rt1', { externalRateIds: ['r1', 'r0'] }, request);

    expect(rankings.setRanking).toHaveBeenCalledWith('t1', 'p1', 'rt1', ['r1', 'r0']);
    expect(result.rates.map((rate) => rate.externalRateId)).toEqual(['r1', 'r0']);
  });
});
