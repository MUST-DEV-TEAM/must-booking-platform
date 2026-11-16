import { it, expect } from 'vitest';
import { cancellationRefundOutcome, needsApproval } from './booking-requests.service';
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
