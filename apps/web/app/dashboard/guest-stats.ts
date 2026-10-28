import { formatMoney } from '../../lib/money';
import { isDead, minorUnits, outstandingAmount, summarize } from './payment-status';
import type { Reservation } from './reservations';

export type MoneyByCurrency = Array<{ currency: string; amount: string }>;

export type GuestStats = {
  guestId: string;
  /** Every booking linked to the guest, cancelled ones included. */
  bookings: number;
  cancelled: number;
  /** Bookings that are or were real stays (not cancelled, expired or failed). */
  stays: number;
  /** Two or more real stays means a returning guest. */
  kind: 'returning' | 'first-time';
  net: MoneyByCurrency;
  outstanding: MoneyByCurrency;
  /** The first currency's totals as plain numbers, for sorting and "has a balance" checks. */
  netValue: number;
  outstandingValue: number;
  hasBalance: boolean;
  /** A stay that has started and not ended yet. */
  current?: { startsOn: string; endsOn: string };
  /** The soonest stay that has not started yet. */
  next?: { startsOn: string; endsOn: string };
  /** The latest stay that is over. */
  last?: { startsOn: string; endsOn: string };
  firstBookedAt?: string;
};

/**
 * What the property knows about each guest, worked out from the booking list the dashboard already
 * loads: stay counts, money, and when they last stayed or will next stay. `today` is `YYYY-MM-DD`.
 */
export function guestStatsById(bookings: Reservation[], today: string): Map<string, GuestStats> {
  const byGuest = new Map<string, Reservation[]>();
  for (const booking of bookings) {
    if (!booking.guestId) continue;
    const list = byGuest.get(booking.guestId) ?? [];
    list.push(booking);
    byGuest.set(booking.guestId, list);
  }
  const stats = new Map<string, GuestStats>();
  for (const [guestId, list] of byGuest) {
    const real = list.filter((booking) => booking.status === 'CONFIRMED');
    const totals = summarize(list).byCurrency;
    const outstanding = totals
      .map((row) => ({ currency: row.currency, amount: row.outstanding }))
      .filter((row) => minorUnits(row.amount) > 0n);
    const stay = (booking: Reservation) => ({ startsOn: booking.startsOn, endsOn: booking.endsOn });
    const sortedByStart = [...real].sort((a, b) => a.startsOn.localeCompare(b.startsOn));
    const current = sortedByStart.find(
      (booking) => booking.startsOn <= today && today < booking.endsOn,
    );
    const next = sortedByStart.find((booking) => booking.startsOn > today);
    const last = [...sortedByStart].reverse().find((booking) => booking.endsOn <= today);
    const net = totals.map((row) => ({ currency: row.currency, amount: row.net }));
    stats.set(guestId, {
      guestId,
      bookings: list.length,
      cancelled: list.filter((booking) => booking.status === 'CANCELLED').length,
      stays: real.length,
      kind: real.length >= 2 ? 'returning' : 'first-time',
      net,
      outstanding,
      netValue: Number(net[0]?.amount ?? 0),
      outstandingValue: Number(outstanding[0]?.amount ?? 0),
      hasBalance: list.some(
        (booking) => !isDead(booking) && minorUnits(outstandingAmount(booking)) > 0n,
      ),
      current: current && stay(current),
      next: next && stay(next),
      last: last && stay(last),
      firstBookedAt: list
        .map((booking) => booking.createdAt)
        .filter(Boolean)
        .sort()[0],
    });
  }
  return stats;
}

/** "€10.00 · $5.00" for a list of per-currency amounts, or a dash when there is nothing. */
export function formatMoneyList(list: MoneyByCurrency): string {
  if (list.length === 0) return '—';
  return list.map(({ currency, amount }) => formatMoney(amount, currency)).join(' · ');
}

// Names and emails are free text: a cell that starts with one of these would be run as a formula
// by a spreadsheet, so it is defused with a leading quote.
function csvCell(value: string | number | null | undefined): string {
  const text = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

type CsvGuest = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  mostRecentStartsOn?: string;
};

/** The guests as CSV, with the figures the directory shows for each. */
export function guestsCsv(guests: CsvGuest[], stats: Map<string, GuestStats>): string {
  const header = [
    'Name',
    'Email',
    'Phone',
    'Stays',
    'Cancelled',
    'Type',
    'Last stay',
    'Next stay',
    'Net paid',
    'Still owed',
  ];
  const rows = guests.map((guest) => {
    const entry = stats.get(guest.id);
    return [
      [guest.firstName, guest.lastName].filter(Boolean).join(' ') || guest.email,
      guest.email,
      guest.phone ?? '',
      entry?.stays ?? 0,
      entry?.cancelled ?? 0,
      entry?.kind === 'returning' ? 'Returning' : 'First-time',
      guest.mostRecentStartsOn ?? '',
      entry?.next?.startsOn ?? '',
      entry ? formatMoneyList(entry.net) : '',
      entry ? formatMoneyList(entry.outstanding) : '',
    ]
      .map(csvCell)
      .join(',');
  });
  return [header.join(','), ...rows].join('\r\n');
}
