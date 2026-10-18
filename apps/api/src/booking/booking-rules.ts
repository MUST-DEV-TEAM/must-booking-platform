export type BookingRuleChannel = 'guest' | 'staff' | 'block';
export type BookingRuleViolation = { code: string; message: string };
export const CHECK_IN_PAST_MESSAGE = 'Check-in cannot be in the past.';
export type BookingRulePolicy = {
  timezone?: string | null;
  minStayNights?: number | null;
  maxStayNights?: number | null;
  advanceBookingDays?: number | null;
  sameDayBookingAllowed?: boolean;
  sameDayCutoffTime?: string | null;
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
  roomActive?: boolean;
  roomTypeStatus?: string;
  availableUnits?: number;
  conflicts?: RuleConflict[];
}): { valid: boolean; errors: BookingRuleViolation[] } {
  const invalid = rangeViolation(input.startsOn, input.endsOn);
  if (invalid) return { valid: false, errors: [invalid] };
  const errors: BookingRuleViolation[] = [];
  const policy = input.policy ?? {};
  const today = propertyClock(policy.timezone, input.now).date;
  const nights = ruleNights(input.startsOn, input.endsOn);
  if (input.startsOn < today)
    errors.push({
      code: input.channel === 'block' ? 'BLOCK_IN_PAST' : 'CHECK_IN_PAST',
      message:
        input.channel === 'block' ? 'A block cannot start in the past.' : CHECK_IN_PAST_MESSAGE,
    });
  if (input.channel !== 'block') {
    if (policy.minStayNights != null && nights < policy.minStayNights)
      errors.push({
        code: 'MIN_STAY',
        message: `A minimum stay of ${policy.minStayNights} nights is required.`,
      });
    if (policy.maxStayNights != null && nights > policy.maxStayNights)
      errors.push({
        code: 'MAX_STAY',
        message: `A maximum stay of ${policy.maxStayNights} nights is allowed.`,
      });
    if (
      policy.advanceBookingDays != null &&
      ruleNights(today, input.startsOn) > policy.advanceBookingDays
    )
      errors.push({
        code: 'ADVANCE_BOOKING_LIMIT',
        message: `Bookings can be made at most ${policy.advanceBookingDays} days in advance.`,
      });
    const sameDay =
      input.channel === 'guest' ? sameDayBookingViolation(input.startsOn, policy, input.now) : null;
    if (sameDay) errors.push(sameDay);
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
  return { valid: errors.length === 0, errors };
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
