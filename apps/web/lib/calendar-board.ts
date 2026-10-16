/**
 * Date and layout helpers for the calendar board (the tape chart of reservations). Everything works
 * on plain "YYYY-MM-DD" days so time zones never shift a reservation by a day.
 */

const DAY_MS = 86_400_000;

const toUtc = (iso: string) => new Date(`${iso}T00:00:00Z`).getTime();

export function addDays(iso: string, amount: number): string {
  return new Date(toUtc(iso) + amount * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function diffDays(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

export function windowDays(start: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => addDays(start, index));
}

export type BarGeometry = {
  /** Where the bar starts, as a share of the window width (0 to 1). */
  left: number;
  /** How wide it is, as a share of the window width. */
  width: number;
  /** The reservation begins before the window starts. */
  cutAtStart: boolean;
  /** The reservation ends after the window ends. */
  cutAtEnd: boolean;
};

/**
 * Where a stay is drawn. A guest arrives in the afternoon and leaves in the morning, so the bar
 * starts in the middle of the check-in day and ends in the middle of the check-out day. Returns null
 * when the stay does not touch the window.
 */
export function barGeometry(
  startsOn: string,
  endsOn: string,
  windowStart: string,
  dayCount: number,
): BarGeometry | null {
  const startIndex = diffDays(windowStart, startsOn);
  const endIndex = diffDays(windowStart, endsOn);
  if (endIndex < 0 || startIndex >= dayCount) return null;
  const from = Math.max(startIndex + 0.5, 0);
  const to = Math.min(endIndex + 0.5, dayCount);
  if (to <= from) return null;
  return {
    left: from / dayCount,
    width: (to - from) / dayCount,
    cutAtStart: startIndex + 0.5 < 0,
    cutAtEnd: endIndex + 0.5 > dayCount,
  };
}

/**
 * Puts stays that overlap in time on separate lines (lane 0, 1, 2…) so bars never draw on top of
 * each other. A stay may start on the day the previous one ends.
 */
export function packLanes<T extends { startsOn: string; endsOn: string }>(
  items: readonly T[],
): Array<{ item: T; lane: number }> {
  const sorted = [...items].sort(
    (a, b) => a.startsOn.localeCompare(b.startsOn) || a.endsOn.localeCompare(b.endsOn),
  );
  const laneEnds: string[] = [];
  return sorted.map((item) => {
    let lane = laneEnds.findIndex((end) => end <= item.startsOn);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.endsOn);
    } else laneEnds[lane] = item.endsOn;
    return { item, lane };
  });
}

/** True when the stay occupies the given night (the check-out day itself is not a night). */
export function occupiesNight(startsOn: string, endsOn: string, night: string): boolean {
  return startsOn <= night && night < endsOn;
}

/** What a reservation looks like on the board, from the hotel's stay status and its own state. */
export type StayState =
  | 'expected'
  | 'in_house'
  | 'checked_out'
  | 'no_show'
  | 'awaiting_payment'
  | 'needs_attention'
  | 'cancelled';

export const STAY_STATE_LABELS: Record<StayState, string> = {
  expected: 'Expected',
  in_house: 'In house',
  checked_out: 'Checked out',
  no_show: 'No show',
  awaiting_payment: 'Awaiting payment',
  needs_attention: 'Needs attention',
  cancelled: 'Cancelled',
};

const ATTENTION = new Set([
  'MANUAL_REVIEW',
  'PAYMENT_FAILED',
  'AVAILABILITY_FAILED',
  'PMS_REJECTED',
  'PMS_UNKNOWN_RESULT',
]);

/**
 * The state shown for a reservation. The hotel system's own stay status wins (Clock reports
 * expected, checked in, checked out, no show and cancelled). Without one, the dates decide: not
 * arrived yet is expected, between arrival and departure is in house, past departure is checked out.
 */
export function stayState(
  row: { status: string; pmsStayStatus: string | null; startsOn: string; endsOn: string },
  today: string,
): StayState {
  if (row.status === 'CANCELLED' || row.pmsStayStatus === 'canceled') return 'cancelled';
  if (row.status === 'PAYMENT_PENDING') return 'awaiting_payment';
  if (ATTENTION.has(row.status)) return 'needs_attention';
  if (row.pmsStayStatus === 'no_show') return 'no_show';
  if (row.pmsStayStatus === 'checked_out') return 'checked_out';
  if (row.pmsStayStatus === 'checked_in') return 'in_house';
  if (row.pmsStayStatus === 'expected') return 'expected';
  if (row.endsOn <= today) return 'checked_out';
  if (row.startsOn <= today) return 'in_house';
  return 'expected';
}
