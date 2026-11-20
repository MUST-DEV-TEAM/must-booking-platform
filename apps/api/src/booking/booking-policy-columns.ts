import { Prisma } from '@prisma/client';

/** The columns every booking-rule check reads, aliased to BookingRulePolicy. One list, one place. */
export const bookingPolicyColumns = Prisma.raw(
  [
    'timezone',
    'min_stay_nights AS "minStayNights"',
    'max_stay_nights AS "maxStayNights"',
    'advance_booking_days AS "advanceBookingDays"',
    'min_notice_hours AS "minNoticeHours"',
    'season_open_from AS "seasonOpenFrom"',
    'season_open_to AS "seasonOpenTo"',
    'arrival_days AS "arrivalDays"',
    'departure_days AS "departureDays"',
    'same_day_booking_allowed AS "sameDayBookingAllowed"',
    'same_day_cutoff_time AS "sameDayCutoffTime"',
    'max_guests_per_booking AS "maxGuestsPerBooking"',
    'max_rooms_per_booking AS "maxRoomsPerBooking"',
  ].join(', '),
);
