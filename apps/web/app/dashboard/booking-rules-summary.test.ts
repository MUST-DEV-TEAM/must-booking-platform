import { describe, expect, it } from 'vitest';

import { ruleOwnerLabel } from './booking-rules-owners';
import { describeBookingRules } from './booking-rules-summary';
import type { Property } from './settings-areas';

const base = { id: 'p', name: 'Hotel' } as unknown as Property;

describe('describeBookingRules', () => {
  it('describes an unrestricted hotel in plain words', () => {
    expect(describeBookingRules(base)).toEqual([
      'Guests can stay any number of nights.',
      'Open for bookings all year.',
      'Guests can arrive on any day.',
      'Bookings are confirmed instantly.',
    ]);
  });

  it('describes stay, window, season, days, group and confirmation limits', () => {
    const lines = describeBookingRules({
      ...base,
      minStayNights: 2,
      maxStayNights: 5,
      minNoticeHours: 24,
      advanceBookingDays: 365,
      seasonOpenFrom: '04-15',
      seasonOpenTo: '10-31',
      arrivalDays: [5, 6],
      departureDays: [7],
      sameDayCutoffTime: '18:00',
      maxGuestsPerBooking: 8,
      maxRoomsPerBooking: 4,
      groupRequestForm: true,
      confirmationMode: 'on_request',
      onRequestHours: 12,
    } as Property);
    expect(lines).toEqual([
      'Guests can stay 2 to 5 nights.',
      'Bookings close 24 hours before arrival and open 365 days ahead.',
      'Open for bookings from 15 April to 31 October each year.',
      'Guests can only arrive on Friday, Saturday.',
      'Guests can only leave on Sunday.',
      'Same-day bookings close at 18:00.',
      'A booking can have up to 8 guests and 4 rooms; bigger groups send a request.',
      'Bookings are confirmed on request, answered within 12 hours.',
    ]);
  });
});

describe('ruleOwnerLabel', () => {
  it('says who decides, depending on whether a PMS is connected', () => {
    expect(ruleOwnerLabel('Length of stay', false)).toBe('Set in MUST');
    expect(ruleOwnerLabel('Length of stay', true)).toContain('stricter');
    expect(ruleOwnerLabel('Confirmation', true)).toContain('connected PMS');
    expect(ruleOwnerLabel('Advanced', true)).toContain('Standalone');
    expect(ruleOwnerLabel('Something else', true)).toBeUndefined();
  });
});
