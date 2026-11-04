import { describe, expect, it } from 'vitest';

import {
  isoWeekday,
  newReservationReference,
  pickBestTable,
  slotTimes,
  tableStatusAt,
  type StatusBooking,
} from './venue-reservation-logic';

describe('isoWeekday', () => {
  it('numbers Monday as 1 and Sunday as 7', () => {
    expect(isoWeekday('2026-11-02')).toBe(1);
    expect(isoWeekday('2026-11-05')).toBe(4);
    expect(isoWeekday('2026-11-08')).toBe(7);
  });
});

describe('slotTimes', () => {
  it('lists bookable times from opening to the last booking before closing', () => {
    expect(slotTimes('19:00', '23:00', 30, 60)).toEqual([
      '19:00',
      '19:30',
      '20:00',
      '20:30',
      '21:00',
      '21:30',
      '22:00',
    ]);
  });
  it('honours a slot length of an hour and no last-booking margin', () => {
    expect(slotTimes('12:00', '15:00', 60, 0)).toEqual(['12:00', '13:00', '14:00', '15:00']);
  });
  it('has no times when the margin is longer than the opening hours', () => {
    expect(slotTimes('12:00', '13:00', 30, 120)).toEqual([]);
  });
});

describe('pickBestTable', () => {
  const t = (label: string, minSeats: number, maxSeats: number) => ({
    id: label,
    label,
    minSeats,
    maxSeats,
  });
  it('picks the smallest table the party fits, so big tables stay free', () => {
    const tables = [t('T3', 4, 8), t('T1', 2, 4), t('T2', 2, 6)];
    expect(pickBestTable(tables, 3)?.label).toBe('T1');
    expect(pickBestTable(tables, 5)?.label).toBe('T2');
    expect(pickBestTable(tables, 7)?.label).toBe('T3');
  });
  it('respects a table minimum, and breaks ties by label in natural order', () => {
    expect(pickBestTable([t('T10', 2, 4), t('T2', 2, 4)], 2)?.label).toBe('T2');
    expect(pickBestTable([t('T1', 4, 8)], 2)).toBeNull();
  });
  it('returns null when nothing fits', () => {
    expect(pickBestTable([t('T1', 2, 4)], 9)).toBeNull();
    expect(pickBestTable([], 2)).toBeNull();
  });
});

describe('newReservationReference', () => {
  it('is short, starts with R and avoids look-alike characters', () => {
    for (let i = 0; i < 50; i++) expect(newReservationReference()).toMatch(/^R[A-HJ-NP-Z2-9]{6}$/);
  });
});

describe('tableStatusAt', () => {
  const at = new Date('2026-11-05T19:30:00Z');
  const booking = (
    status: StatusBooking['status'],
    start: string,
    end: string,
    extra: Partial<StatusBooking> = {},
  ): StatusBooking => ({
    id: `${status}-${start}`,
    status,
    startsAt: new Date(`2026-11-05T${start}:00Z`),
    endsAt: new Date(`2026-11-05T${end}:00Z`),
    guestName: 'Guest',
    partySize: 2,
    ...extra,
  });

  it('is free with nothing booked, and tells what is next', () => {
    const next = booking('confirmed', '21:00', '22:30');
    expect(tableStatusAt(true, [next], at)).toMatchObject({ status: 'free', next });
  });

  it('is reserved while a booking covers the time and the guests have not been seated', () => {
    const current = booking('confirmed', '19:00', '20:30');
    expect(tableStatusAt(true, [current], at)).toMatchObject({ status: 'reserved', current });
  });

  it('is seated while seated guests are inside their time', () => {
    const current = booking('seated', '19:00', '21:00');
    expect(tableStatusAt(true, [current], at)).toMatchObject({ status: 'seated', current });
  });

  it('is finishing in the last 15 minutes of a seated booking', () => {
    const current = booking('seated', '18:30', '19:40');
    expect(tableStatusAt(true, [current], at).status).toBe('finishing');
  });

  it('is overrunning when seated guests stay past their time', () => {
    const current = booking('seated', '18:00', '19:15');
    expect(tableStatusAt(true, [current], at).status).toBe('overrun');
  });

  it('ignores cancelled, completed and no-show bookings', () => {
    const rows = [
      booking('cancelled', '19:00', '20:30'),
      booking('completed', '19:00', '20:30'),
      booking('no_show', '19:00', '20:30'),
    ];
    expect(tableStatusAt(true, rows, at)).toMatchObject({ status: 'free', next: undefined });
  });

  it('is blocked when the table is switched off', () => {
    expect(tableStatusAt(false, [], at).status).toBe('blocked');
  });

  it('treats a booking that ends exactly now as already over', () => {
    expect(tableStatusAt(true, [booking('confirmed', '18:00', '19:30')], at).status).toBe('free');
  });

  it('picks the earliest upcoming booking as next', () => {
    const later = booking('confirmed', '22:00', '23:00');
    const sooner = booking('confirmed', '20:30', '21:30');
    expect(tableStatusAt(true, [later, sooner], at).next).toBe(sooner);
  });
});

it('uses higher priority only among equally sized best fits', () => {
  const tables = [
    { id: '1', label: 'T1', minSeats: 1, maxSeats: 4, priority: 0 },
    { id: '2', label: 'T2', minSeats: 1, maxSeats: 4, priority: 20 },
    { id: '3', label: 'T3', minSeats: 1, maxSeats: 8, priority: 100 },
  ];
  expect(pickBestTable(tables, 2)?.id).toBe('2');
});
