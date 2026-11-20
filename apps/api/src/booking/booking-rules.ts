import { inSeason } from '@must/domain-contracts';
import { evaluateRestrictions, type BookingRestriction } from './inventory-restriction-rules';
export { restrictionLifecycle, restrictionConflicts } from './inventory-restriction-rules';
export type {
  BookingRestriction,
  RestrictionType,
  RestrictionLifecycle,
} from './inventory-restriction-rules';
export type BookingRuleChannel = 'guest' | 'staff' | 'block';
export type BookingRuleViolation = {
  code: string;
  message: string;
  /** `date`: the limit comes from a per-date restriction (Rates & Pricing), which is never overridden. */
  source?: 'date';
};
/**
 * The hotel's own website-style limits. Reception may override these with a reason; they are never
 * overridden for guests. Safety rules (past dates, availability, room capacity, overlaps, unpublished
 * rooms) and per-date restrictions are not on this list and can never be overridden.
 */
export const OVERRIDABLE_RULE_CODES: ReadonlySet<string> = new Set([
  'MIN_STAY',
  'MAX_STAY',
  'ADVANCE_BOOKING_LIMIT',
  'MIN_NOTICE',
  'OUTSIDE_SEASON',
  'ARRIVAL_DAY_NOT_ALLOWED',
  'DEPARTURE_DAY_NOT_ALLOWED',
  'SAME_DAY_CLOSED',
  'MAX_GUESTS_PER_BOOKING',
  'MAX_ROOMS_PER_BOOKING',
]);
export const isOverridableRule = (error: { code: string; source?: string }) =>
  OVERRIDABLE_RULE_CODES.has(error.code) && error.source !== 'date';
export const CHECK_IN_PAST_MESSAGE = 'Check-in cannot be in the past.';
export type BookingRulePolicy = {
  timezone?: string | null;
  minStayNights?: number | null;
  maxStayNights?: number | null;
  advanceBookingDays?: number | null;
  /** Guests must book at least this many hours before the check-in day starts (hotel time). */
  minNoticeHours?: number | null;
  /** The yearly season the hotel takes bookings in, as MM-DD; empty means all year. */
  seasonOpenFrom?: string | null;
  seasonOpenTo?: string | null;
  /** ISO weekdays (Monday 1 to Sunday 7) guests may arrive and depart on; empty means every day. */
  arrivalDays?: number[] | null;
  departureDays?: number[] | null;
  sameDayBookingAllowed?: boolean;
  sameDayCutoffTime?: string | null;
  maxGuestsPerBooking?: number | null;
  maxRoomsPerBooking?: number | null;
};
export type RuleConflict = { startsOn: string; endsOn: string; kind: 'booking' | 'block' };
export const BLOCK_RESERVATION_MESSAGE =
  'Reservations are already booked on these dates. Move or cancel them first; a block never cancels a reservation.';

export function validRuleDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
export function ruleNights(startsOn: string, endsOn: string): number {
  return (Date.parse(endsOn) - Date.parse(startsOn)) / 86_400_000;
}
export function ruleRangesOverlap(
  a: Pick<RuleConflict, 'startsOn' | 'endsOn'>,
  b: Pick<RuleConflict, 'startsOn' | 'endsOn'>,
): boolean {
  return a.startsOn < b.endsOn && a.endsOn > b.startsOn;
}
export function effectiveMinimumStay(
  propertyMinimum?: number | null,
  providerMinimum?: number | null,
): number | null {
  const minimum = Math.max(propertyMinimum ?? 0, providerMinimum ?? 0);
  return minimum > 0 ? minimum : null;
}
/** The least restrictive minimum among the provider's open rates, matching the existing calendar projection. */
export function minimumStayForOpenRates(values: number[]): number | null {
  return values.length ? Math.min(...values) : null;
}
export function rangeViolation(startsOn: string, endsOn: string): BookingRuleViolation | null {
  if (!validRuleDate(startsOn) || !validRuleDate(endsOn))
    return { code: 'INVALID_DATE', message: 'Choose valid start and end dates.' };
  if (endsOn <= startsOn)
    return { code: 'INVALID_RANGE', message: 'End date must be after start date.' };
  return null;
}
/** All booking and block policy decisions are pure; callers load inventory and conflict facts. */
export function evaluateBookingRules(input: {
  channel: BookingRuleChannel;
  startsOn: string;
  endsOn: string;
  policy?: BookingRulePolicy;
  now?: Date;
  adults?: number;
  children?: number;
  maxOccupancy?: number;
  roomCount?: number;
  roomActive?: boolean;
  roomTypeStatus?: string;
  availableUnits?: number;
  conflicts?: RuleConflict[];
  restrictions?: BookingRestriction[];
  /** Staff only: the limits on OVERRIDABLE_RULE_CODES are skipped and reported in `overridden`. */
  overrideRules?: boolean;
}): {
  valid: boolean;
  errors: BookingRuleViolation[];
  /** The overridable rules that were skipped because staff overrode them. */
  overridden?: BookingRuleViolation[];
  effectiveMinStayNights?: number | null;
  effectiveMaxStayNights?: number | null;
} {
  const invalid = rangeViolation(input.startsOn, input.endsOn);
  if (invalid) return { valid: false, errors: [invalid] };
  const errors: BookingRuleViolation[] = [];
  let policy = input.policy ?? {};
  const today = propertyClock(policy.timezone, input.now).date;
  const nights = ruleNights(input.startsOn, input.endsOn);
  if (input.startsOn < today)
    errors.push({
      code: input.channel === 'block' ? 'BLOCK_IN_PAST' : 'CHECK_IN_PAST',
      message:
        input.channel === 'block' ? 'A block cannot start in the past.' : CHECK_IN_PAST_MESSAGE,
    });
  if (input.channel !== 'block') {
    const restrictions = evaluateRestrictions(
      input.restrictions ?? [],
      input.startsOn,
      input.endsOn,
      today,
    );
    errors.push(...restrictions.errors);
    policy = {
      ...policy,
      minStayNights: restrictions.minimumStay ?? policy.minStayNights,
      maxStayNights: restrictions.maximumStay ?? policy.maxStayNights,
    };
    if (policy.minStayNights != null && nights < policy.minStayNights)
      errors.push({
        code: 'MIN_STAY',
        message: `A minimum stay of ${policy.minStayNights} nights is required.`,
        ...(restrictions.minimumStay != null ? { source: 'date' as const } : {}),
      });
    if (policy.maxStayNights != null && nights > policy.maxStayNights)
      errors.push({
        code: 'MAX_STAY',
        message: `A maximum stay of ${policy.maxStayNights} nights is allowed.`,
        ...(restrictions.maximumStay != null ? { source: 'date' as const } : {}),
      });
    if (
      policy.advanceBookingDays != null &&
      ruleNights(today, input.startsOn) > policy.advanceBookingDays
    )
      errors.push({
        code: 'ADVANCE_BOOKING_LIMIT',
        message: `Bookings can be made at most ${policy.advanceBookingDays} days in advance.`,
      });
    errors.push(...windowViolations(input.startsOn, input.endsOn, policy, input.now));
    const sameDay = sameDayBookingViolation(input.startsOn, policy, input.now);
    if (sameDay) errors.push(sameDay);
    if (
      policy.maxGuestsPerBooking != null &&
      (input.adults ?? 1) + (input.children ?? 0) > policy.maxGuestsPerBooking
    )
      errors.push({
        code: 'MAX_GUESTS_PER_BOOKING',
        message: `A booking can include no more than ${policy.maxGuestsPerBooking} guests, including children.`,
      });
    if (policy.maxRoomsPerBooking != null && (input.roomCount ?? 1) > policy.maxRoomsPerBooking)
      errors.push({
        code: 'MAX_ROOMS_PER_BOOKING',
        message: `A booking can include no more than ${policy.maxRoomsPerBooking} rooms.`,
      });
    // Preserve the existing safety gates for every new booking, including staff bookings.
    if (input.roomTypeStatus !== undefined && input.roomTypeStatus !== 'PUBLISHED')
      errors.push({ code: 'ROOM_TYPE_NOT_AVAILABLE', message: 'Room type is not published.' });
    if (input.roomActive === false)
      errors.push({ code: 'ROOM_NOT_AVAILABLE', message: 'Room is not active.' });
    if (
      input.maxOccupancy !== undefined &&
      (input.adults ?? 1) + (input.children ?? 0) > input.maxOccupancy
    )
      errors.push({
        code: 'CAPACITY_EXCEEDED',
        message: `The room allows at most ${input.maxOccupancy} guests, including children.`,
      });
    if (input.availableUnits !== undefined && input.availableUnits < 1)
      errors.push({
        code: 'NO_AVAILABILITY',
        message: 'The selected rooms are unavailable for these dates.',
      });
  }
  const conflicts = (input.conflicts ?? []).filter((conflict) =>
    ruleRangesOverlap(input, conflict),
  );
  if (input.channel === 'block') {
    if (conflicts.some((conflict) => conflict.kind === 'booking'))
      errors.push({ code: 'BLOCK_RESERVATION_CONFLICT', message: BLOCK_RESERVATION_MESSAGE });
  } else {
    if (conflicts.some((conflict) => conflict.kind === 'booking'))
      errors.push({
        code: 'BOOKING_CONFLICT',
        message: 'The selected range overlaps an existing reservation.',
      });
    if (conflicts.some((conflict) => conflict.kind === 'block'))
      errors.push({
        code: 'AVAILABILITY_BLOCK_CONFLICT',
        message: 'The selected range overlaps an availability block.',
      });
  }
  const overridden =
    input.overrideRules === true && input.channel === 'staff'
      ? errors.filter(isOverridableRule)
      : [];
  if (overridden.length)
    errors.splice(0, errors.length, ...errors.filter((e) => !overridden.includes(e)));
  return {
    valid: errors.length === 0,
    errors,
    ...(overridden.length ? { overridden } : {}),
    ...(input.restrictions?.length && input.channel !== 'block'
      ? {
          effectiveMinStayNights: policy.minStayNights ?? null,
          effectiveMaxStayNights: policy.maxStayNights ?? null,
        }
      : {}),
  };
}

/** Today's date and minutes-since-midnight on the property's own clock (UTC when unset/invalid). */
export function propertyClock(
  timezone: string | null | undefined,
  now: Date = new Date(),
): { date: string; minutes: number } {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone || 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(now)
        .map((part) => [part.type, part.value]),
    ) as Record<string, string>;
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute),
    };
  } catch {
    return propertyClock('UTC', now);
  }
}

export function isSameDayBookingClosed(
  startsOn: string,
  rule: {
    timezone: string | null;
    sameDayBookingAllowed: boolean;
    sameDayCutoffTime: string | null;
  },
  now: Date = new Date(),
): boolean {
  const clock = propertyClock(rule.timezone, now);
  if (startsOn !== clock.date) return false;
  if (!rule.sameDayBookingAllowed) return true;
  const cutoff = /^(\d{1,2}):(\d{2})$/.exec(rule.sameDayCutoffTime ?? '');
  return cutoff !== null && clock.minutes >= Number(cutoff[1]) * 60 + Number(cutoff[2]);
}

export function sameDayBookingViolation(
  startsOn: string,
  policy: BookingRulePolicy,
  now?: Date,
): BookingRuleViolation | null {
  return isSameDayBookingClosed(
    startsOn,
    {
      timezone: policy.timezone ?? null,
      sameDayBookingAllowed: policy.sameDayBookingAllowed ?? true,
      sameDayCutoffTime: policy.sameDayCutoffTime ?? null,
    },
    now,
  )
    ? {
        code: 'SAME_DAY_CLOSED',
        message: 'Same-day bookings are closed for today. Please choose a later check-in date.',
      }
    : null;
}

const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];
const isoWeekday = (date: string) => ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const SEASON_NIGHT_LIMIT = 400;

/** Notice, season and arrival or departure day rules for one stay (the hotel's own calendar). */
export function windowViolations(
  startsOn: string,
  endsOn: string,
  policy: BookingRulePolicy,
  now?: Date,
): BookingRuleViolation[] {
  const errors: BookingRuleViolation[] = [];
  const clock = propertyClock(policy.timezone, now);
  if (policy.minNoticeHours != null && policy.minNoticeHours > 0) {
    const minutesUntilCheckInDay = ruleNights(clock.date, startsOn) * 1440 - clock.minutes;
    if (minutesUntilCheckInDay < policy.minNoticeHours * 60)
      errors.push({
        code: 'MIN_NOTICE',
        message: `Bookings must be made at least ${policy.minNoticeHours} hours before the check-in day.`,
      });
  }
  if (policy.seasonOpenFrom && policy.seasonOpenTo) {
    let night = startsOn;
    for (let i = 0; i < SEASON_NIGHT_LIMIT && night < endsOn; i += 1) {
      if (!inSeason(night.slice(5), policy.seasonOpenFrom, policy.seasonOpenTo)) {
        errors.push({
          code: 'OUTSIDE_SEASON',
          message: `Closed for the season. Bookings are open from ${policy.seasonOpenFrom.replace('-', '/')} to ${policy.seasonOpenTo.replace('-', '/')} (month/day).`,
        });
        break;
      }
      night = addDays(night, 1);
    }
  }
  const arrivals = policy.arrivalDays ?? [];
  if (arrivals.length > 0 && arrivals.length < 7 && !arrivals.includes(isoWeekday(startsOn)))
    errors.push({
      code: 'ARRIVAL_DAY_NOT_ALLOWED',
      message: `Arrivals are only possible on ${arrivals
        .slice()
        .sort()
        .map((day) => WEEKDAY_NAMES[day - 1])
        .join(', ')}.`,
    });
  const departures = policy.departureDays ?? [];
  if (departures.length > 0 && departures.length < 7 && !departures.includes(isoWeekday(endsOn)))
    errors.push({
      code: 'DEPARTURE_DAY_NOT_ALLOWED',
      message: `Departures are only possible on ${departures
        .slice()
        .sort()
        .map((day) => WEEKDAY_NAMES[day - 1])
        .join(', ')}.`,
    });
  return errors;
}
