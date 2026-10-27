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
