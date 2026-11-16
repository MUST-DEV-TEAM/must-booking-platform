import { it, expect } from 'vitest';
import {
  bookingChangedSinceRequest,
  cancellationRefundOutcome,
  needsApproval,
} from './booking-requests.service';
it('allows only authorized, unpaid individual holds to bypass policy review', () => {
  const e = {
    status: 'PAYMENT_PENDING',
    paid: '0.00',
    isFree: false,
    policySource: 'MUST' as const,
  };
  expect(needsApproval(['bookings.cancel'], e, 'none')).toBe(false);
  expect(needsApproval([], e, 'none')).toBe(true);
  expect(needsApproval(['bookings.cancel'], { ...e, paid: '1.00' }, 'none')).toBe(true);
  expect(needsApproval(['bookings.cancel'], { ...e, status: 'CONFIRMED' }, 'none')).toBe(true);
  expect(needsApproval(['bookings.cancel'], { ...e, orderReference: 'shared' }, 'none')).toBe(true);
});

it('reports a cancellation refund as refunded, pending or not made, never as success when it is not done', () => {
  expect(cancellationRefundOutcome({ ok: true, value: { status: 'REFUNDED' } })).toEqual({
    ok: true,
    status: 'refunded',
  });
  expect(
    cancellationRefundOutcome({ ok: true, value: { status: 'REFUND_PENDING' } }),
  ).toMatchObject({
    ok: false,
    status: 'pending',
  });
  expect(
    cancellationRefundOutcome({
      ok: false,
      error: { code: 'REFUND_ALLOCATION_REVIEW_REQUIRED', message: 'Several payments.' },
    }),
  ).toEqual({
    ok: false,
    status: 'not_made',
    message: 'Several payments.',
    errorCode: 'REFUND_ALLOCATION_REVIEW_REQUIRED',
  });
});

it('names the in-person part of a cash plus card cancellation instead of calling it done (D5)', () => {
  const byHand = { amount: '100.00', currency: 'EUR' };
  const card = {
    ok: true as const,
    value: { status: 'REFUNDED', amount: { amount: '140.00', currency: 'EUR' } },
  };
  expect(cancellationRefundOutcome(card, byHand)).toEqual({
    ok: false,
    status: 'return_by_hand',
    message:
      'The online part (140.00 EUR) was refunded. Return 100.00 EUR to the guest by hand: it was paid in person.',
    returnByHand: byHand,
  });
  expect(cancellationRefundOutcome(null, byHand)).toMatchObject({
    status: 'return_by_hand',
    returnByHand: byHand,
  });
  expect(
    cancellationRefundOutcome({ ok: true, value: { status: 'REFUND_PENDING' } }, byHand),
  ).toMatchObject({
    status: 'pending',
    returnByHand: byHand,
  });
  expect(cancellationRefundOutcome(card, null)).toEqual({ ok: true, status: 'refunded' });
});

const frozen = {
  bookingId: 'b',
  reference: 'R',
  version: 1,
  status: 'CONFIRMED',
  ratePlan: 'Flex',
  timezone: 'Europe/Tirane',
  cutoffAt: '2030-07-09T22:00:00.000Z',
  isFree: true,
  currency: 'EUR',
  paid: '100.00',
  alreadyRefunded: '0.00',
  penalty: '0.00',
  eligible: '100.00',
  startsOn: '2030-07-10',
  endsOn: '2030-07-12',
  total: '100.00',
  method: 'manual',
  legacyPolicy: false,
  previewHash: 'h',
};

it('does not count a rising version, or the passing of time, as a change to a booking', () => {
  expect(bookingChangedSinceRequest({ ...frozen, version: 6 }, frozen)).toBe(false);
  expect(
    bookingChangedSinceRequest(
      { ...frozen, isFree: false, eligible: '0.00', previewHash: 'x' },
      frozen,
    ),
  ).toBe(false);
});

it('counts a change of state, dates, total or payments as a change', () => {
  for (const change of [
    { status: 'CANCELLED' },
    { startsOn: '2030-07-11' },
    { endsOn: '2030-07-13' },
    { total: '120.00' },
    { paid: '150.00' },
    { alreadyRefunded: '10.00' },
    { currency: 'USD' },
    { cutoffAt: '2030-07-10T22:00:00.000Z' },
  ])
    expect(bookingChangedSinceRequest({ ...frozen, ...change }, frozen)).toBe(true);
});

it('compares a request saved before dates and total were recorded on what it does have', () => {
  const { startsOn, endsOn, total, ...old } = frozen;
  void startsOn;
  void endsOn;
  void total;
  expect(bookingChangedSinceRequest({ ...frozen, startsOn: '2031-01-01', version: 9 }, old)).toBe(
    false,
  );
  expect(bookingChangedSinceRequest({ ...frozen, paid: '1.00' }, old)).toBe(true);
});
