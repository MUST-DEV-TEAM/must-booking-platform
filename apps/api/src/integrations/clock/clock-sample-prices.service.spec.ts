import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClockSamplePricesService } from './clock-sample-prices.service';

const price = (amount: string) => ({ amount, currency: 'EUR' });

function setup(freeFromCall: number | null) {
  const database = {
    withTenantTransaction: vi.fn((_scope, run) =>
      run({ $queryRawUnsafe: vi.fn().mockResolvedValue([{ id: 'rt-1' }, { id: 'rt-2' }]) }),
    ),
  };
  let searches = 0;
  const clock = {
    getStaySearch: vi.fn().mockImplementation(async () => {
      searches += 1;
      const free = freeFromCall !== null && searches >= freeFromCall;
      return {
        results: {},
        details: {
          'rt-1': free
            ? { available: true, price: price('200.00'), freeRooms: 2 }
            : { available: false, reason: 'sold_out' },
          'rt-2': { available: false, reason: 'sold_out' },
        },
      };
    }),
    listOffersForStay: vi
      .fn()
      .mockImplementation(async (_t, _p, query: { roomTypeId: string }) => ({
        ok: true,
        value:
          query.roomTypeId === 'rt-1'
            ? [
                { rateId: '1', total: price('200.00') },
                { rateId: '2', total: price('300.00') },
              ]
            : [],
      })),
  };
  return { service: new ClockSamplePricesService(database as never, clock as never), clock };
}

describe('ClockSamplePricesService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-27T10:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('uses the nearest two-night stay that has a free room, and prices every rate as staff see them', async () => {
    const { service, clock } = setup(2);
    const sample = await service.sample('t1', 'p1');
    // Tomorrow is sold out, so the stay a week later is used.
    expect(sample).toMatchObject({
      startsOn: '2026-11-04',
      endsOn: '2026-11-06',
      adults: 2,
      nights: 2,
    });
    expect(sample.roomTypes['rt-1']).toEqual([
      { rateId: '1', total: price('200.00') },
      { rateId: '2', total: price('300.00') },
    ]);
    expect(sample.roomTypes['rt-2']).toEqual([]);
    // Staff see every rate, including any switched off for the website.
    expect(clock.listOffersForStay).toHaveBeenCalledWith(
      't1',
      'p1',
      expect.objectContaining({ channel: 'staff', adultCount: 2 }),
    );
  });

  it('reports no sample when none of the nearby stays has a free room, and remembers the answer for a few minutes', async () => {
    const { service, clock } = setup(null);
    const sample = await service.sample('t1', 'p1');
    expect(sample.startsOn).toBeNull();
    expect(sample.roomTypes).toEqual({});
    expect(clock.listOffersForStay).not.toHaveBeenCalled();
    const calls = clock.getStaySearch.mock.calls.length;
    await service.sample('t1', 'p1');
    expect(clock.getStaySearch.mock.calls.length).toBe(calls);
  });
});
