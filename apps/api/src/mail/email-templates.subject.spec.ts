import { describe, expect, it } from 'vitest';
import { EMAIL_TEMPLATES } from './email-templates';

describe('confirmation email subjects', () => {
  it('uses one subject format for both booking confirmations', () => {
    expect(EMAIL_TEMPLATES.booking_confirmed_pay_at_hotel.subject).toBe(
      EMAIL_TEMPLATES.booking_confirmed.subject,
    );
  });
});
