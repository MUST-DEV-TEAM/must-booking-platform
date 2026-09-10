import { describe, expect, it, vi } from 'vitest';

import { ClockRateRankingService } from './clock-rate-ranking.service';

function makeService() {
  const transaction = {
    $queryRawUnsafe: vi.fn(),
    $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
  };
  const database = { withTenantTransaction: vi.fn((_context, callback) => callback(transaction)) };
  return { service: new ClockRateRankingService(database as never), transaction, database };
}

describe('ClockRateRankingService', () => {
  it('returns the stored ranking in rank order', async () => {
    const { service, transaction } = makeService();
    transaction.$queryRawUnsafe.mockResolvedValue([
      { externalRateId: '803405', rank: 0 },
      { externalRateId: '803406', rank: 1 },
    ]);

    const ranking = await service.getRanking('t1', 'p1', 'rt1');

    expect(ranking).toEqual([
      { externalRateId: '803405', rank: 0 },
      { externalRateId: '803406', rank: 1 },
    ]);
  });

  it('rankOrder returns just the ordered ids', async () => {
    const { service, transaction } = makeService();
    transaction.$queryRawUnsafe.mockResolvedValue([
      { externalRateId: '803405', rank: 0 },
      { externalRateId: '803406', rank: 1 },
    ]);

    const order = await service.rankOrder('t1', 'p1', 'rt1');

    expect(order).toEqual(['803405', '803406']);
  });

  it('rankOrder is empty when no ranking has been set yet', async () => {
    const { service, transaction } = makeService();
    transaction.$queryRawUnsafe.mockResolvedValue([]);

    expect(await service.rankOrder('t1', 'p1', 'rt1')).toEqual([]);
  });

  it('setRanking replaces the whole list: deletes existing rows then inserts the new order with rank = array index', async () => {
    const { service, transaction } = makeService();

    await service.setRanking('t1', 'p1', 'rt1', ['803406', '803405']);

    expect(transaction.$executeRawUnsafe).toHaveBeenCalledTimes(3); // 1 delete + 2 inserts
    expect(transaction.$executeRawUnsafe).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('DELETE FROM clock_rate_rankings'),
      't1',
      'p1',
      'rt1',
    );
    expect(transaction.$executeRawUnsafe).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO clock_rate_rankings'),
      't1',
      'p1',
      'rt1',
      '803406',
      0,
    );
    expect(transaction.$executeRawUnsafe).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('INSERT INTO clock_rate_rankings'),
      't1',
      'p1',
      'rt1',
      '803405',
      1,
    );
  });

  it('setRanking with an empty list clears the ranking (delete only, no inserts)', async () => {
    const { service, transaction } = makeService();

    await service.setRanking('t1', 'p1', 'rt1', []);

    expect(transaction.$executeRawUnsafe).toHaveBeenCalledTimes(1);
  });
});
