import type { ReservationStatus, SettableStatus, StaffSource, TableState } from './reservation-api';

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'muted' | 'secondary';

export const STATUS_DISPLAY: Record<ReservationStatus, { label: string; tone: Tone }> = {
  pending_payment: { label: 'Awaiting deposit', tone: 'warning' },
  confirmed: { label: 'Confirmed', tone: 'info' },
  seated: { label: 'Seated', tone: 'success' },
  completed: { label: 'Finished', tone: 'muted' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
  no_show: { label: 'No-show', tone: 'danger' },
};

export const SOURCE_OPTIONS: Array<{ value: StaffSource; label: string }> = [
  { value: 'phone', label: 'Phone call' },
  { value: 'walk_in', label: 'Walk-in' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'viber', label: 'Viber' },
  { value: 'messenger', label: 'Messenger' },
  { value: 'email', label: 'Email' },
  { value: 'hotel_reception', label: 'Hotel reception' },
  { value: 'google', label: 'Google' },
  { value: 'tripadvisor', label: 'TripAdvisor' },
  { value: 'other', label: 'Other' },
];

export const TABLE_STATE_DISPLAY: Record<TableState, { label: string; tone: string }> = {
  free: { label: 'Free', tone: 'bg-success-surface border-success text-success' },
  reserved: { label: 'Reserved', tone: 'bg-info-surface border-info text-info' },
  seated: { label: 'Seated', tone: 'bg-warning-surface border-warning text-warning' },
  finishing: { label: 'Finishing soon', tone: 'bg-secondary border-primary text-foreground' },
  overrun: {
    label: 'Over time',
    tone: 'bg-destructive-surface border-destructive text-destructive',
  },
  blocked: { label: 'Not in use', tone: 'bg-muted border-border text-muted-foreground' },
};

/** What staff can do next with a booking, in the order the buttons appear. */
export function nextActions(
  status: ReservationStatus,
  requiresDeposit = false,
): Array<{
  status: SettableStatus;
  label: string;
  destructive?: boolean;
}> {
  switch (status) {
    case 'pending_payment':
      return [
        ...(requiresDeposit ? [] : [{ status: 'confirmed' as const, label: 'Confirm' }]),
        { status: 'cancelled', label: 'Cancel', destructive: true },
      ];
    case 'confirmed':
      return [
        { status: 'seated', label: 'Seat' },
        { status: 'no_show', label: 'No-show', destructive: true },
        { status: 'cancelled', label: 'Cancel', destructive: true },
      ];
    case 'seated':
      return [{ status: 'completed', label: 'Finish' }];
    default:
      return [];
  }
}

/** Today's date in a time zone as YYYY-MM-DD. */
export function dateInZone(timeZone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** Moves a YYYY-MM-DD date by whole days. */
export function addDays(date: string, days: number): string {
  const moved = new Date(`${date}T00:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}

/** "19:30" for an instant, in the restaurant's time zone. */
export function timeInZone(iso: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

/** The date part of an instant, in the restaurant's time zone. */
export function dayOfInstant(iso: string | Date, timeZone: string): string {
  return dateInZone(timeZone, new Date(iso));
}

/** "Fri 6 Nov" for a YYYY-MM-DD date. */
export function dayLabel(date: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${date}T00:00:00Z`));
}

/** Minutes since midnight for "HH:MM". */
export function minutesOf(time: string): number {
  const [h = '0', m = '0'] = time.split(':');
  return Number(h) * 60 + Number(m);
}

/** The instant for a restaurant-local date and minute-of-day. Uses the zone's offset at that time. */
export function instantAt(date: string, minutes: number, timeZone: string): Date {
  const guess = new Date(`${date}T00:00:00Z`).getTime() + minutes * 60_000;
  // Find the zone offset at the guessed instant and correct for it (one pass is enough but for DST edges).
  let result = guess;
  for (let i = 0; i < 2; i += 1) {
    const shown = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(result));
    const part = (type: string) => Number(shown.find((p) => p.type === type)?.value ?? 0);
    const asUtc = Date.UTC(
      part('year'),
      part('month') - 1,
      part('day'),
      part('hour'),
      part('minute'),
    );
    result += guess - asUtc;
  }
  return new Date(result);
}
