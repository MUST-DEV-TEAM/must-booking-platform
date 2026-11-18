import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { refusedBookingStatus, throwIfBookingRefused } from './refused-booking';

describe('refusedBookingStatus', () => {
  it.each([
    'AVAILABILITY_FAILED',
    'AUTO_ASSIGNMENT_UNAVAILABLE',
    'CHECKOUT_HOLD_ACTIVE',
    'CHECKOUT_EXPIRED',
    'IDEMPOTENCY_IN_PROGRESS',
  ])('answers 409 when the stay is taken or the request is already running (%s)', (code) =>
    expect(refusedBookingStatus({ code })).toBe(409),
  );

  it.each([
    'QUOTE_MISMATCH',
    'QUOTE_EXPIRED',
    'PRICE_CHANGED',
    'MIN_STAY',
    'INVALID_BOOKING_COMMAND',
    'ANYTHING_ELSE',
  ])('answers 422 for every other refusal (%s) and never a 5xx', (code) =>
    expect(refusedBookingStatus({ code })).toBe(422),
  );
});

describe('throwIfBookingRefused', () => {
  it('lets a created booking through unchanged', () => {
    const created = { ok: true, value: { id: 'b1' } };
    expect(throwIfBookingRefused(created)).toBe(created);
  });

  it('throws the refusal with the same body, so clients still read error.message', () => {
    const refused = {
      ok: false,
      error: { code: 'AVAILABILITY_FAILED', message: 'The selected room is no longer available.' },
    };
    try {
      throwIfBookingRefused(refused);
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(409);
      expect((error as HttpException).getResponse()).toEqual(refused);
    }
  });
});
