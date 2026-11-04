import { parseFloorQuery } from './venue-reservation-input';

import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import {
  parseAvailabilityQuery,
  parseListQuery,
  parseReservationCreate,
  parseReservationUpdate,
  parseStatusChange,
} from './venue-reservation-input';

const create = {
  date: '2026-11-06',
  time: '19:30',
  partySize: 4,
  guestName: ' Ana Hoxha ',
  guestPhone: '+355 69 000 0000',
  guestEmail: ' Ana@Example.test ',
  notes: ' Window seat ',
};

describe('parseReservationCreate', () => {
  it('tidies the values and defaults the source to other', () => {
    expect(parseReservationCreate(create)).toEqual({
      date: '2026-11-06',
      time: '19:30',
      partySize: 4,
      guestName: 'Ana Hoxha',
      guestPhone: '+355 69 000 0000',
      guestEmail: 'ana@example.test',
      notes: 'Window seat',
      source: 'other',
      tableId: null,
      durationMinutes: null,
    });
  });

  it('needs only the date, time, party size and a name', () => {
    expect(
      parseReservationCreate({ date: '2026-11-06', time: '12:00', partySize: 2, guestName: 'Bo' }),
    ).toMatchObject({ guestPhone: null, guestEmail: null, notes: null });
  });

  it.each([
    'phone',
    'walk_in',
    'whatsapp',
    'instagram',
    'facebook',
    'viber',
    'messenger',
    'email',
    'hotel_reception',
    'google',
    'tripadvisor',
    'other',
  ])('accepts the source %s', (source) => {
    expect(parseReservationCreate({ ...create, source }).source).toBe(source);
  });

  it.each([
    ['a missing name', { ...create, guestName: ' ' }],
    ['a name over 200 characters', { ...create, guestName: 'x'.repeat(201) }],
    ['a date that is not a real day', { ...create, date: '2026-02-30' }],
    ['a date in the wrong format', { ...create, date: '06/11/2026' }],
    ['a time that is not HH:MM', { ...create, time: '7pm' }],
    ['a party of 0', { ...create, partySize: 0 }],
    ['a party over 500', { ...create, partySize: 501 }],
    ['a fractional party', { ...create, partySize: 2.5 }],
    ['a bad email', { ...create, guestEmail: 'nope' }],
    ['an unknown source', { ...create, source: 'carrier-pigeon' }],
    ['the website as a staff source', { ...create, source: 'website' }],
    ['a table id that is not a UUID', { ...create, tableId: 'T1' }],
    ['a stay shorter than 30 minutes', { ...create, durationMinutes: 10 }],
    ['notes over 1000 characters', { ...create, notes: 'x'.repeat(1001) }],
    ['a body that is not an object', 'hello'],
  ])('rejects %s', (_label, body) => {
    expect(() => parseReservationCreate(body)).toThrow(BadRequestException);
  });
});

describe('parseReservationUpdate', () => {
  it('returns only what was sent', () => {
    expect(parseReservationUpdate({ partySize: 6, notes: 'Birthday' })).toEqual({
      partySize: 6,
      notes: 'Birthday',
    });
  });
  it('lets a note or phone be cleared', () => {
    expect(parseReservationUpdate({ notes: '', guestPhone: '' })).toEqual({
      notes: null,
      guestPhone: null,
    });
  });
  it('rejects an empty update', () => {
    expect(() => parseReservationUpdate({})).toThrow(BadRequestException);
  });
  it('rejects a time without a date being ambiguous only when malformed', () => {
    expect(() => parseReservationUpdate({ time: '25:00' })).toThrow(BadRequestException);
  });
});

describe('parseStatusChange', () => {
  it.each(['confirmed', 'seated', 'completed', 'cancelled', 'no_show'])('accepts %s', (status) => {
    expect(parseStatusChange({ status })).toEqual({ status, note: null });
  });
  it('keeps a trimmed note', () => {
    expect(parseStatusChange({ status: 'cancelled', note: ' Guest called ' })).toEqual({
      status: 'cancelled',
      note: 'Guest called',
    });
  });
  it.each([
    { status: 'pending_payment' },
    { status: 'maybe' },
    {},
    { status: 'seated', note: 'x'.repeat(501) },
  ])('rejects %j', (body) => {
    expect(() => parseStatusChange(body)).toThrow(BadRequestException);
  });
});

describe('parseListQuery', () => {
  it('defaults to a single day with a sensible limit', () => {
    expect(parseListQuery({ from: '2026-11-06' })).toEqual({
      from: '2026-11-06',
      to: '2026-11-06',
      statuses: null,
      q: null,
      limit: 300,
    });
  });
  it('reads a range, statuses and a search', () => {
    expect(
      parseListQuery({
        from: '2026-11-06',
        to: '2026-11-12',
        status: 'confirmed,seated',
        q: ' ana ',
        limit: '50',
      }),
    ).toEqual({
      from: '2026-11-06',
      to: '2026-11-12',
      statuses: ['confirmed', 'seated'],
      q: 'ana',
      limit: 50,
    });
  });
  it.each([
    ['no start date', {}],
    ['an end before the start', { from: '2026-11-06', to: '2026-11-01' }],
    ['a range over 62 days', { from: '2026-11-01', to: '2027-02-01' }],
    ['an unknown status', { from: '2026-11-06', status: 'maybe' }],
    ['a limit over 500', { from: '2026-11-06', limit: '501' }],
  ])('rejects %s', (_label, query) => {
    expect(() => parseListQuery(query)).toThrow(BadRequestException);
  });
});

describe('parseAvailabilityQuery', () => {
  it('reads the date, party size and defaults to the staff channel', () => {
    expect(parseAvailabilityQuery({ date: '2026-11-06', partySize: '4' })).toEqual({
      date: '2026-11-06',
      partySize: 4,
      channel: 'staff',
      areaId: null,
    });
  });
  it('accepts the online channel and an area', () => {
    const areaId = 'b2222222-2222-4222-8222-222222222222';
    expect(
      parseAvailabilityQuery({ date: '2026-11-06', partySize: '2', channel: 'online', areaId }),
    ).toMatchObject({ channel: 'online', areaId });
  });
  it.each([
    ['no date', { partySize: '2' }],
    ['no party size', { date: '2026-11-06' }],
    ['a party of 0', { date: '2026-11-06', partySize: '0' }],
    ['an unknown channel', { date: '2026-11-06', partySize: '2', channel: 'fax' }],
    ['a bad area id', { date: '2026-11-06', partySize: '2', areaId: 'terrace' }],
  ])('rejects %s', (_label, query) => {
    expect(() => parseAvailabilityQuery(query)).toThrow(BadRequestException);
  });
});

describe('floor interval input', () => {
  it('keeps at and default-now working', () => {
    const now = new Date('2026-11-03T19:00:00Z');
    expect(parseFloorQuery({}, now)).toEqual({ at: now, to: null });
    expect(parseFloorQuery({ at: now.toISOString() })).toEqual({ at: now, to: null });
  });
  it('accepts a bounded instant period', () => {
    expect(parseFloorQuery({ from: '2026-11-03T19:00:00Z', to: '2026-11-03T20:00:00Z' })).toEqual({
      at: new Date('2026-11-03T19:00:00Z'),
      to: new Date('2026-11-03T20:00:00Z'),
    });
  });
  it.each([
    { from: '2026-11-03T19:00:00Z' },
    { to: '2026-11-03T20:00:00Z' },
    { from: 'invalid', to: 'invalid' },
    { at: '2026-11-03T19:00:00Z', from: '2026-11-03T19:00:00Z', to: '2026-11-03T20:00:00Z' },
    { from: '2026-11-03T19:00:00Z', to: '2026-11-03T19:00:00Z' },
    { from: '2026-11-03T19:00:00Z', to: '2026-11-06T19:00:00Z' },
    { at: '2026-11-03T19:00:00' },
  ])('rejects malformed or ambiguous intervals %j', (query) =>
    expect(() => parseFloorQuery(query)).toThrow(),
  );
});
