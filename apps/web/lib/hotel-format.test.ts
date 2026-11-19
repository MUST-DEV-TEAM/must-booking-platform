import { describe, expect, it } from 'vitest';

import {
  DEFAULT_HOTEL_FORMATS,
  formatDate,
  formatDateTime,
  formatNumber,
  formatTime,
  hotelFormatsFrom,
} from './hotel-format';

const iso = hotelFormatsFrom({ dateFormat: 'YYYY-MM-DD', timeFormat: '24h' });
const us = hotelFormatsFrom({
  dateFormat: 'MM/DD/YYYY',
  timeFormat: '12h',
  numberFormat: 'dot_comma',
});
const moment = '2026-11-03T13:05:00Z';

describe('hotel formats', () => {
  it('writes a plain day in the hotel order and never shifts it by a time zone', () => {
    expect(formatDate('2026-11-03', 'numeric', DEFAULT_HOTEL_FORMATS)).toBe('03/11/2026');
    expect(formatDate('2026-11-03', 'numeric', us)).toBe('11/03/2026');
    expect(formatDate('2026-11-03', 'numeric', iso)).toBe('2026-11-03');
    expect(formatDate('2026-11-03', 'medium', DEFAULT_HOTEL_FORMATS)).toBe('3 Nov 2026');
    expect(formatDate('2026-11-03', 'medium', us)).toBe('Nov 3, 2026');
    expect(formatDate('2026-11-03', 'short', DEFAULT_HOTEL_FORMATS)).toBe('3 Nov');
    expect(formatDate('2026-11-03', 'medium', iso)).toBe('2026-11-03');
  });

  it('reads a moment on the hotel clock, in 24-hour or 12-hour time', () => {
    const tirane = { ...DEFAULT_HOTEL_FORMATS, timeZone: 'Europe/Tirane' };
    expect(formatTime(moment, tirane)).toBe('14:05');
    expect(formatDateTime(moment, 'numeric', tirane)).toBe('03/11/2026 14:05');
    expect(formatTime(moment, { ...us, timeZone: 'Europe/Tirane' })).toBe('2:05 PM');
    expect(formatTime('2026-11-03T00:30:00Z', { ...us, timeZone: 'UTC' })).toBe('12:30 AM');
    expect(formatDateTime(moment, 'medium', { ...us, timeZone: 'America/New_York' })).toBe(
      'Nov 3, 2026 8:05 AM',
    );
  });

  it('gives an empty string for a missing or invalid value, and an unknown zone does not crash', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDate('not a date')).toBe('');
    expect(formatTime(undefined)).toBe('');
    expect(formatTime(moment, { ...DEFAULT_HOTEL_FORMATS, timeZone: 'Mars/Base' })).toMatch(
      /^\d\d:\d\d$/,
    );
  });

  it('writes numbers with the hotel separators', () => {
    expect(formatNumber(1234.5, { minimumFractionDigits: 2 }, DEFAULT_HOTEL_FORMATS)).toBe(
      '1,234.50',
    );
    expect(formatNumber(1234.5, { minimumFractionDigits: 2 }, us)).toBe('1.234,50');
  });

  it('falls back to the defaults for missing or unknown settings', () => {
    expect(hotelFormatsFrom(null)).toEqual({ ...DEFAULT_HOTEL_FORMATS, timeZone: undefined });
    expect(hotelFormatsFrom({ dateFormat: 'DD.MM.YY', timeFormat: '99' }).dateFormat).toBe(
      'DD/MM/YYYY',
    );
  });
});
