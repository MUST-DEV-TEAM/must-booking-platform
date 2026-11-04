import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { parseVenueCreate, parseVenueUpdate } from './venue-input';

describe('parseVenueCreate', () => {
  it('accepts a short description', () => {
    expect(
      parseVenueCreate({ name: 'Grill', description: ' Grilled fish by the sea ' }),
    ).toMatchObject({
      name: 'Grill',
      description: 'Grilled fish by the sea',
    });
  });
  it('rejects a description over 1000 characters', () => {
    expect(() => parseVenueCreate({ name: 'Grill', description: 'x'.repeat(1001) })).toThrow(
      BadRequestException,
    );
  });
});

describe('parseVenueUpdate: booking rules', () => {
  it('accepts every rule within its limits', () => {
    expect(
      parseVenueUpdate({
        advanceBookingDays: 90,
        maxOnlinePartySize: 10,
        holdMinutes: 15,
        lastBookingMinutesBeforeClose: 45,
        diningMinutes: 120,
      }),
    ).toEqual({
      advanceBookingDays: 90,
      maxOnlinePartySize: 10,
      holdMinutes: 15,
      lastBookingMinutesBeforeClose: 45,
      diningMinutes: 120,
    });
  });

  it.each([
    ['advance booking of 0 days', { advanceBookingDays: 0 }],
    ['advance booking of more than a year', { advanceBookingDays: 366 }],
    ['an online party size of 0', { maxOnlinePartySize: 0 }],
    ['a hold of 4 minutes', { holdMinutes: 4 }],
    ['a hold of more than an hour', { holdMinutes: 61 }],
    ['a negative last-booking time', { lastBookingMinutesBeforeClose: -1 }],
    ['a dining time of 10 minutes', { diningMinutes: 10 }],
    ['fractional days', { advanceBookingDays: 10.5 }],
    ['text instead of a number', { holdMinutes: '10' }],
  ])('rejects %s', (_label, body) => {
    expect(() => parseVenueUpdate(body)).toThrow(BadRequestException);
  });
});

describe('parseVenueUpdate: deposit rule', () => {
  it('accepts a percentage, a fixed amount, or none', () => {
    expect(parseVenueUpdate({ depositMode: 'percent', depositValue: 30 })).toEqual({
      depositMode: 'percent',
      depositValue: '30.00',
    });
    expect(parseVenueUpdate({ depositMode: 'fixed', depositValue: '12.5' })).toEqual({
      depositMode: 'fixed',
      depositValue: '12.50',
    });
    expect(parseVenueUpdate({ depositMode: 'none' })).toEqual({ depositMode: 'none' });
  });

  it('keeps the deposit amount as exact text with two decimals, never a float', () => {
    expect(parseVenueUpdate({ depositValue: '0.10' })).toEqual({ depositValue: '0.10' });
  });

  it.each([
    ['an unknown mode', { depositMode: 'half' }],
    ['a negative amount', { depositValue: -1 }],
    ['an amount with three decimals', { depositValue: '1.234' }],
    ['an amount that is not a number', { depositValue: 'lots' }],
    ['a percentage over 100', { depositMode: 'percent', depositValue: 101 }],
    ['a party minimum of 0', { depositMinParty: 0 }],
    ['a free-cancellation time over 30 days', { freeCancelHours: 721 }],
  ])('rejects %s', (_label, body) => {
    expect(() => parseVenueUpdate(body)).toThrow(BadRequestException);
  });

  it('accepts free cancellation of 0 hours (always charged) up to 30 days', () => {
    expect(parseVenueUpdate({ freeCancelHours: 0 })).toEqual({ freeCancelHours: 0 });
    expect(parseVenueUpdate({ freeCancelHours: 720 })).toEqual({ freeCancelHours: 720 });
  });
});
