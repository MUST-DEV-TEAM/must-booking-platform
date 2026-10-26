import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { buildBookingSearch, parseBookingSearchQuery, VIEW_SQL } from './booking-search';

describe('parseBookingSearchQuery', () => {
  it('uses sensible defaults', () => {
    expect(parseBookingSearchQuery({})).toMatchObject({
      view: 'all',
      search: '',
      statuses: [],
      payment: null,
      source: null,
      dateType: 'stay',
      sort: 'stay',
      direction: 'desc',
      page: 1,
      pageSize: 25,
    });
  });

  it('parses a comma separated status list and rejects unknown statuses', () => {
    expect(parseBookingSearchQuery({ status: 'CONFIRMED,CANCELLED' }).statuses).toEqual([
      'CONFIRMED',
      'CANCELLED',
    ]);
    expect(() => parseBookingSearchQuery({ status: 'CONFIRMED,NOPE' })).toThrow(
      BadRequestException,
    );
  });

  it.each([
    [{ view: 'everything' }],
    [{ payment: 'maybe' }],
    [{ sort: 'drop table' }],
    [{ page: '0' }],
    [{ pageSize: '500' }],
    [{ from: '2026-13-40' }],
    [{ from: '2026-10-20', to: '2026-10-10' }],
    [{ search: 'x'.repeat(101) }],
  ])('rejects invalid input %j', (input) => {
    expect(() => parseBookingSearchQuery(input)).toThrow(BadRequestException);
  });
});

describe('buildBookingSearch', () => {
  it('never puts user text in the SQL, only in parameters', () => {
    const query = parseBookingSearchQuery({
      search: "x'; DROP TABLE bookings;--",
      from: '2026-10-01',
    });
    const built = buildBookingSearch(query);
    expect(built.where).not.toContain('DROP');
    expect(built.params).toContain("%x'; DROP TABLE bookings;--%");
    expect(built.params).toContain('2026-10-01');
  });

  it('escapes LIKE wildcards in the search text', () => {
    const built = buildBookingSearch(parseBookingSearchQuery({ search: '50%_off' }));
    expect(built.params[0]).toBe('%50\\%\\_off%');
  });

  it('numbers parameters from $3 because $1 and $2 are tenant and property', () => {
    const built = buildBookingSearch(
      parseBookingSearchQuery({
        search: 'ana',
        payment: 'paid',
        from: '2026-10-01',
        to: '2026-10-31',
      }),
    );
    expect(built.where).toContain('$3');
    expect(built.where).toContain('$4');
    expect(built.where).not.toContain('$1');
    expect(built.params).toHaveLength(4);
  });

  it('applies the chosen saved view and a stay overlap for stay dates', () => {
    const built = buildBookingSearch(
      parseBookingSearchQuery({ view: 'in_house', from: '2026-10-10', to: '2026-10-12' }),
    );
    expect(built.where).toContain(VIEW_SQL.in_house);
    expect(built.where).toContain('x.starts_on <= $3::date');
    expect(built.where).toContain('x.ends_on > $4::date');
  });

  it('only sorts by known columns, with a stable tiebreak', () => {
    const built = buildBookingSearch(parseBookingSearchQuery({ sort: 'guest', direction: 'asc' }));
    expect(built.orderBy).toMatch(/ASC, x\.created_at DESC, x\.id DESC$/);
  });

  it('treats the UNKNOWN source as bookings with no recorded source', () => {
    const built = buildBookingSearch(parseBookingSearchQuery({ source: 'UNKNOWN' }));
    expect(built.where).toContain('x.source IS NULL');
    expect(built.params).toHaveLength(0);
  });
});
