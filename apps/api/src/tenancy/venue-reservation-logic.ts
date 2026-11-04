import { randomInt } from 'node:crypto';

/** ISO weekday of a calendar date (YYYY-MM-DD): 1 = Monday ... 7 = Sunday. */
export function isoWeekday(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  const sunday0 = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
  return ((sunday0 + 6) % 7) + 1;
}

function minutes(time: string): number {
  const [hours, mins] = time.split(':').map(Number);
  return hours! * 60 + mins!;
}

function clock(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Bookable times of a service: from opening, every `slotMinutes`, up to the last booking before closing. */
export function slotTimes(
  opensAt: string,
  closesAt: string,
  slotMinutes: number,
  lastBookingMinutesBeforeClose: number,
): string[] {
  const last = minutes(closesAt) - lastBookingMinutesBeforeClose;
  const times: string[] = [];
  for (let t = minutes(opensAt); t <= last; t += slotMinutes) times.push(clock(t));
  return times;
}

export type FittingTable = {
  id: string;
  label: string;
  minSeats: number;
  maxSeats: number;
  priority?: number;
};

/** The smallest table the party fits (so big tables stay free), then by label in natural order. */
export function pickBestTable<T extends FittingTable>(
  tables: readonly T[],
  partySize: number,
): T | null {
  const fitting = tables.filter(
    (table) => table.minSeats <= partySize && partySize <= table.maxSeats,
  );
  fitting.sort(
    (a, b) =>
      a.maxSeats - b.maxSeats ||
      (b.priority ?? 0) - (a.priority ?? 0) ||
      a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }),
  );
  return fitting[0] ?? null;
}

const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A short reference to read out on the phone: R plus six characters, no look-alikes. */
export function newReservationReference(): string {
  let reference = 'R';
  for (let i = 0; i < 6; i += 1)
    reference += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return reference;
}

export type BookingStatus =
  'pending_payment' | 'confirmed' | 'seated' | 'completed' | 'cancelled' | 'no_show';

export type StatusBooking = {
  id: string;
  status: BookingStatus;
  startsAt: Date;
  endsAt: Date;
  guestName: string;
  partySize: number;
};

export type TableStatus = 'free' | 'reserved' | 'seated' | 'finishing' | 'overrun' | 'blocked';

const FINISHING_MINUTES = 15;

/** What a table looks like at a moment, from the bookings that use it. */
export function tableStatusAt(
  active: boolean,
  bookings: readonly StatusBooking[],
  at: Date,
): { status: TableStatus; current?: StatusBooking; next?: StatusBooking } {
  if (!active) return { status: 'blocked' };
  const live = bookings.filter(
    (b) => b.status === 'pending_payment' || b.status === 'confirmed' || b.status === 'seated',
  );
  const now = at.getTime();
  const seated = live.find((b) => b.status === 'seated' && b.startsAt.getTime() <= now);
  const covering = live.find(
    (b) => b.status !== 'seated' && b.startsAt.getTime() <= now && now < b.endsAt.getTime(),
  );
  const next = live
    .filter((b) => b.startsAt.getTime() > now && b !== seated)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];

  if (seated) {
    const left = seated.endsAt.getTime() - now;
    if (left <= 0) return { status: 'overrun', current: seated, next };
    if (left <= FINISHING_MINUTES * 60_000) return { status: 'finishing', current: seated, next };
    return { status: 'seated', current: seated, next };
  }
  if (covering) return { status: 'reserved', current: covering, next };
  return { status: 'free', next };
}
