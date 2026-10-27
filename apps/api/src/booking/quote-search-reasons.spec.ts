import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { QuoteService } from './quote.service';

const open = '11111111-1111-4111-8111-111111111111';
const soldOut = '22222222-2222-4222-8222-222222222222';
const shortStay = '33333333-3333-4333-8333-333333333333';
const unchecked = '44444444-4444-4444-8444-444444444444';

function clockService() {
  const service = Object.create(QuoteService.prototype) as Record<string, unknown>;
  service.normalizeOccupancy = (input: Record<string, unknown>) => ({
    ...input,
    adults: 2,
    children: 0,
    guestCount: 2,
  });
  service.validStayInput = () => undefined;
  service.enforceBookingRules = async (
    _tenant: string,
    _property: string,
    input: { roomTypeId: string },
  ) => {
    if (input.roomTypeId === shortStay)
      throw new BadRequestException({ code: 'MIN_STAY', message: 'Minimum stay is 3 nights.' });
  };
  service.connections = {
    activePmsConnectionCredentials: async () => ({ provider: 'CLOCK_PMS' }),
  };
  service.clockAvailability = {
    getStaySearch: async () => ({
      results: {
        [open]: { ok: true, value: { amount: '220.00', currency: 'EUR' } },
        [soldOut]: { ok: false, error: { message: 'none' } },
      },
      details: {
        [open]: { available: true, price: { amount: '220.00', currency: 'EUR' }, freeRooms: 2 },
        [soldOut]: { available: false, reason: 'sold_out' },
      },
    }),
  };
  return service as unknown as QuoteService;
}

const input = { startsOn: '2027-07-10', endsOn: '2027-07-12', adults: 2, children: 0 };
const item = (roomTypeId: string) => ({ key: roomTypeId, roomTypeId, currency: 'EUR' });

describe('display prices say why a room type cannot be booked', () => {
  it('gives the price and rooms left when it can be sold, and the reason when it cannot', async () => {
    const prices = await clockService().displayPrices(
      't',
      'p',
      input,
      [open, soldOut, shortStay, unchecked].map(item),
    );
    const by = Object.fromEntries(prices.map((price) => [price.roomTypeId, price]));
    expect(by[open]).toMatchObject({
      available: true,
      total: { amount: '220.00', currency: 'EUR' },
      freeRooms: 2,
    });
    expect(by[soldOut]).toMatchObject({ available: false, reason: 'sold_out' });
    // The hotel's own rule said no, and its reason wins.
    expect(by[shortStay]).toMatchObject({ available: false, reason: 'min_stay' });
    // Clock gave no answer for this one: unknown, not "unavailable", so no reason is claimed.
    expect(by[unchecked]).toMatchObject({ available: false });
    expect(by[unchecked]).not.toHaveProperty('reason');
  });
});

describe('alternative dates when nothing can be booked', () => {
  function withAvailability(openStarts: Record<string, string>) {
    const service = Object.create(QuoteService.prototype) as Record<string, unknown>;
    service.displayPrices = async (_t: string, _p: string, stay: { startsOn: string }) => {
      const amount = openStarts[stay.startsOn];
      return amount
        ? [{ key: 'a', roomTypeId: open, available: true, total: { amount, currency: 'EUR' } }]
        : [{ key: 'a', roomTypeId: open, available: false, reason: 'sold_out' }];
    };
    return service as unknown as QuoteService;
  }

  it('suggests the nearest dates that work, closest first, keeping the number of nights', async () => {
    const service = withAvailability({
      '2027-07-13': '250.00',
      '2027-07-09': '200.00',
      '2027-07-07': '180.00',
    });
    const found = await service.alternativeDates('t', 'p', input, [item(open)]);
    expect(found.map((entry) => [entry.startsOn, entry.endsOn, entry.shiftDays])).toEqual([
      ['2027-07-09', '2027-07-11', -1],
      ['2027-07-07', '2027-07-09', -3],
      ['2027-07-13', '2027-07-15', 3],
    ]);
    expect(found[0].fromPrice).toEqual({ amount: '200.00', currency: 'EUR' });
  });

  it('never suggests dates in the past and gives nothing when the dates are invalid', async () => {
    const service = withAvailability({ '2020-01-01': '100.00', '2020-01-03': '100.00' });
    const past = { ...input, startsOn: '2020-01-02', endsOn: '2020-01-04' };
    expect(await service.alternativeDates('t', 'p', past, [item(open)])).toEqual([]);
    expect(
      await service.alternativeDates('t', 'p', { ...input, endsOn: 'nope' }, [item(open)]),
    ).toEqual([]);
  });
});
