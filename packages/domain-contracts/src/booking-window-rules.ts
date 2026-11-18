/**
 * The rules for the hotel-wide booking limits, written once. The Booking rules form shows these
 * messages as the owner types and the API refuses the same values (settings redesign plan, S4).
 */
export const WEEKDAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
] as const;

export type BookingLimitKey =
  | 'minStayNights'
  | 'maxStayNights'
  | 'advanceBookingDays'
  | 'minNoticeHours'
  | 'maxGuestsPerBooking'
  | 'maxRoomsPerBooking';

/** Allowed whole-number ranges. A field left empty means "no limit". */
export const BOOKING_LIMIT_RANGES: Record<
  BookingLimitKey,
  { min: number; max: number; unit: string }
> = {
  minStayNights: { min: 1, max: 30, unit: 'nights' },
  maxStayNights: { min: 1, max: 365, unit: 'nights' },
  advanceBookingDays: { min: 1, max: 730, unit: 'days' },
  minNoticeHours: { min: 0, max: 720, unit: 'hours' },
  maxGuestsPerBooking: { min: 1, max: 50, unit: 'guests' },
  maxRoomsPerBooking: { min: 1, max: 20, unit: 'rooms' },
};

export function checkBookingLimit(key: BookingLimitKey, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const range = BOOKING_LIMIT_RANGES[key];
  return Number.isInteger(value) && (value as number) >= range.min && (value as number) <= range.max
    ? null
    : `Enter a whole number from ${range.min} to ${range.max} ${range.unit}, or leave it empty.`;
}

const MONTH_LENGTHS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** "MM-DD" that exists in a leap year, such as 06-15. */
export function validMonthDay(value: string): boolean {
  const match = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.exec(value);
  return !!match && Number(match[2]) <= MONTH_LENGTHS[Number(match[1]) - 1]!;
}

export function checkSeason(
  from: string | null | undefined,
  to: string | null | undefined,
): string | null {
  if (!from && !to) return null;
  if (!from || !to)
    return 'Enter both the opening and closing dates, or leave both empty to be open all year.';
  if (!validMonthDay(from) || !validMonthDay(to)) return 'Choose real dates for the season.';
  if (from === to) return 'The closing date must differ from the opening date.';
  return null;
}

/** Whether a month-day falls inside the season; a season may run over the new year (Nov to Mar). */
export function inSeason(
  monthDay: string,
  from: string | null | undefined,
  to: string | null | undefined,
): boolean {
  if (!from || !to) return true;
  return from <= to ? monthDay >= from && monthDay <= to : monthDay >= from || monthDay <= to;
}

export function checkWeekdays(value: unknown): string | null {
  return Array.isArray(value) &&
    value.length >= 1 &&
    value.every((day) => Number.isInteger(day) && day >= 1 && day <= 7) &&
    new Set(value).size === value.length
    ? null
    : 'Choose at least one day.';
}

/** Cross-field rules; returns messages by field. */
export function checkBookingWindow(values: {
  minStayNights?: number | null;
  maxStayNights?: number | null;
  seasonOpenFrom?: string | null;
  seasonOpenTo?: string | null;
}): Partial<Record<'maxStayNights' | 'seasonOpenTo', string>> {
  const out: Partial<Record<'maxStayNights' | 'seasonOpenTo', string>> = {};
  if (
    values.minStayNights != null &&
    values.maxStayNights != null &&
    values.minStayNights > values.maxStayNights
  )
    out.maxStayNights = 'The maximum stay cannot be shorter than the minimum stay.';
  const season = checkSeason(values.seasonOpenFrom, values.seasonOpenTo);
  if (season) out.seasonOpenTo = season;
  return out;
}
