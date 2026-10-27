import { describe, expect, it } from 'vitest';

import { ownerWeeklySummaryEmail, type OwnerWeeklySummary } from './scheduled-email-content';
import { isMonday } from './scheduled-email.service';

const summary: OwnerWeeklySummary = {
  date: '2027-07-12',
  weekStart: '2027-07-05',
  weekEnd: '2027-07-11',
  newBookings: { count: 4, revenue: [{ amount: '1200.00', currency: 'EUR' }] },
  cancellations: 1,
  guestsHosted: 9,
  upcomingArrivals: 12,
};

describe('owner weekly summary', () => {
  it('knows which days are Mondays', () => {
    expect(isMonday('2027-07-12')).toBe(true);
    expect(isMonday('2027-07-13')).toBe(false);
  });

  it('shows the week’s numbers and what is coming', () => {
    const email = ownerWeeklySummaryEmail(
      summary,
      'owner@hotel.test',
      { name: 'Empire Beach Resort' } as never,
      'https://app.test/dashboard',
    );
    expect(email).toMatchObject({ eventType: 'owner.weekly_summary', to: 'owner@hotel.test' });
    expect(email.subject).toContain('4 new bookings');
    expect(email.text).toContain('Cancellations: 1');
    expect(email.text).toContain('Stays completed: 9');
    expect(email.text).toContain('Arrivals in the next 7 days: 12');
    expect(email.html).toContain('Weekly summary');
  });
});
