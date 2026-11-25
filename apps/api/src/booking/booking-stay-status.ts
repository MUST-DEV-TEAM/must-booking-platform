/** The guest's arrival status on a stay the hotel manages itself (no PMS holds the stay). */
export const STAY_STATUSES = ['expected', 'checked_in', 'checked_out', 'no_show'] as const;
export type StayStatus = (typeof STAY_STATUSES)[number];

/** Each status and where staff may move it next. Undo steps are included: a mis-click must be fixable. */
const NEXT: Record<StayStatus, StayStatus[]> = {
  expected: ['checked_in', 'no_show'],
  checked_in: ['checked_out', 'expected'],
  checked_out: ['checked_in'],
  no_show: ['expected'],
};

export function isStayStatus(value: unknown): value is StayStatus {
  return typeof value === 'string' && (STAY_STATUSES as readonly string[]).includes(value);
}

/**
 * Why a move is not allowed, or null when it is. Checking in or marking a no-show needs the arrival day to
 * have come, so a reservation for next month cannot be marked as arrived.
 */
export function stayStatusProblem(input: {
  from: StayStatus;
  to: StayStatus;
  startsOn: string;
  today: string;
}): string | null {
  if (!NEXT[input.from].includes(input.to))
    return `A stay that is ${input.from.replace('_', ' ')} cannot be set to ${input.to.replace('_', ' ')}.`;
  if ((input.to === 'checked_in' || input.to === 'no_show') && input.startsOn > input.today)
    return 'The arrival day has not come yet.';
  return null;
}

/**
 * What staff are told when a guest did not arrive, from the hotel's no-show rule (G-54). MUST never charges
 * a guest for a no-show (no card is held for it), so the rule becomes a task for staff, not a payment.
 * `null` when the rule is "charge nothing".
 */
export function noShowFollowUp(
  rule: string | null,
  firstNight: { amount: string; currency: string } | null,
): string | null {
  if (rule === 'charge_nothing') return null;
  if (rule === 'charge_first_night')
    return firstNight
      ? `The guest did not arrive. The hotel's rule is to charge the first night (${firstNight.amount} ${firstNight.currency}). MUST does not charge guests, so collect it yourself.`
      : "The guest did not arrive. The hotel's rule is to charge the first night, but this booking has no recorded nightly price. Work out the amount and collect it yourself; MUST does not charge guests.";
  return "The guest did not arrive. The hotel's rule is to review each no-show: decide whether to charge anything. MUST does not charge guests.";
}
