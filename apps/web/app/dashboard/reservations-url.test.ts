import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FILTERS,
  differsOnlyBySearch,
  filtersToParams,
  paramsToFilters,
  withFilterParams,
} from './reservations-url';

describe('reservation filters in the address', () => {
  it('writes nothing for the defaults', () => {
    expect(filtersToParams(DEFAULT_FILTERS, '').toString()).toBe('');
  });

  it('round-trips a full set of filters', () => {
    const filters = {
      ...DEFAULT_FILTERS,
      view: 'unpaid',
      status: 'CONFIRMED',
      payment: 'pay_at_hotel',
      source: 'DIRECT',
      dateType: 'arrival',
      from: '2026-10-01',
      to: '2026-10-31',
      sort: 'total',
      direction: 'asc' as const,
      page: 3,
      pageSize: 50,
    };
    const params = filtersToParams(filters, 'ana');
    expect(paramsToFilters(new URLSearchParams(params.toString()))).toEqual({ filters, search: 'ana' });
  });

  it('ignores malformed values instead of failing', () => {
    const { filters } = paramsToFilters(
      new URLSearchParams('rpage=abc&rsize=9999&rfrom=2026-13-99x&rto=2026-10-01&rdir=sideways&rv=%3Cscript%3E'),
    );
    expect(filters.page).toBe(1);
    expect(filters.pageSize).toBe(25);
    expect(filters.from).toBeNull();
    expect(filters.direction).toBe('desc');
    expect(filters.view).toBe('all');
  });

  it('drops a reversed date range', () => {
    const { filters } = paramsToFilters(new URLSearchParams('rfrom=2026-10-20&rto=2026-10-10'));
    expect(filters.from).toBeNull();
    expect(filters.to).toBeNull();
  });

  it('keeps the other dashboard parameters when it writes its own', () => {
    const next = withFilterParams(
      '?propertyId=p1&section=reservations&payment=b1&rv=old',
      { ...DEFAULT_FILTERS, view: 'upcoming' },
      '',
    );
    const params = new URLSearchParams(next);
    expect(params.get('propertyId')).toBe('p1');
    expect(params.get('section')).toBe('reservations');
    expect(params.get('payment')).toBe('b1');
    expect(params.get('rv')).toBe('upcoming');
  });

  it('treats a change of search text alone as a replace, anything else as a push', () => {
    expect(differsOnlyBySearch('?a=1&rq=x', '?a=1&rq=xy')).toBe(true);
    expect(differsOnlyBySearch('?a=1&rv=unpaid', '?a=1')).toBe(false);
  });
});
