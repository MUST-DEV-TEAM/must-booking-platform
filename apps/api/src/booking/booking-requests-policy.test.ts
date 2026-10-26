import { it, expect } from 'vitest';
import { needsApproval } from './booking-requests.service';
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
