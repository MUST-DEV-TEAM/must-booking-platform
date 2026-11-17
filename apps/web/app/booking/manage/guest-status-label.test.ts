import { describe, expect, it } from 'vitest';
import { guestStatusLabel } from './guest-status-label';

describe('guestStatusLabel', () => {
  it('shows plain words, not the raw status', () => {
    expect(guestStatusLabel('CONFIRMED')).toBe('Confirmed');
    expect(guestStatusLabel('PAYMENT_PENDING')).toBe('Waiting for payment');
  });

  it('never shows capitals-with-underscores for a status it does not know', () => {
    expect(guestStatusLabel('SOMETHING_NEW')).toBe('Something new');
  });
});
