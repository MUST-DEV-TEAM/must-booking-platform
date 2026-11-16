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
