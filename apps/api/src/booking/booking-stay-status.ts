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
