'use client';
import { createContext, useContext, type ReactNode } from 'react';

/**
 * How this hotel writes dates, times and numbers (Settings, Profile, Formats). Every screen formats through
 * these helpers so the hotel's choice applies everywhere. The defaults are the formats the dashboard used
 * before the setting existed: 24-hour times, day first, 1,234.56.
 */
export type HotelFormats = {
  dateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
  timeFormat: '24h' | '12h';
  weekStart: 'monday' | 'sunday';
  numberFormat: 'comma_dot' | 'dot_comma';
  /** The hotel's time zone; moments are shown as the hotel's clock reads them. */
  timeZone?: string;
};

export const DEFAULT_HOTEL_FORMATS: HotelFormats = {
  dateFormat: 'DD/MM/YYYY',
  timeFormat: '24h',
  weekStart: 'monday',
  numberFormat: 'comma_dot',
};

let current: HotelFormats = DEFAULT_HOTEL_FORMATS;
const Context = createContext<HotelFormats>(DEFAULT_HOTEL_FORMATS);

/** What a property record carries (any value may be missing or old); anything unknown falls back to the default. */
export function hotelFormatsFrom(
  source:
    | {
        dateFormat?: string | null;
        timeFormat?: string | null;
        weekStart?: string | null;
        numberFormat?: string | null;
        timezone?: string | null;
      }
    | null
    | undefined,
): HotelFormats {
  const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(value as T) ? (value as T) : fallback;
  return {
    dateFormat: pick(
      source?.dateFormat,
      ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'],
      DEFAULT_HOTEL_FORMATS.dateFormat,
    ),
    timeFormat: pick(source?.timeFormat, ['24h', '12h'], DEFAULT_HOTEL_FORMATS.timeFormat),
    weekStart: pick(source?.weekStart, ['monday', 'sunday'], DEFAULT_HOTEL_FORMATS.weekStart),
    numberFormat: pick(
      source?.numberFormat,
      ['comma_dot', 'dot_comma'],
      DEFAULT_HOTEL_FORMATS.numberFormat,
    ),
    timeZone: source?.timezone || undefined,
  };
}

/** Provides the hotel's formats to the screens below, and to the plain functions that format outside React. */
export function HotelFormatProvider({
  value,
  children,
}: {
  value: HotelFormats;
  children: ReactNode;
}) {
  // Plain helpers (tables, exports) read this too; it is set while rendering so they never lag a render behind.
  current = value;
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useHotelFormats = () => useContext(Context);
export const hotelFormats = () => current;

type Moment = string | number | Date | null | undefined;
type Style = 'numeric' | 'medium' | 'short';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type Parts = { y: string; m: string; d: string; hh?: string; mm?: string };

/** The calendar day (and clock time) of a moment, as read in the hotel's time zone. A plain day stays as it is. */
function partsOf(value: Moment, withTime: boolean, formats: HotelFormats): Parts | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' && DAY.test(value))
    return { y: value.slice(0, 4), m: value.slice(5, 7), d: value.slice(8, 10) };
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  let zone = formats.timeZone;
  const read = (timeZone?: string) =>
    Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(date)
        .map((part) => [part.type, part.value]),
    ) as Record<string, string>;
  let p: Record<string, string>;
  try {
    p = read(zone);
  } catch {
    zone = undefined;
    p = read(undefined);
  }
  return withTime
    ? { y: p.year!, m: p.month!, d: p.day!, hh: p.hour!, mm: p.minute! }
    : { y: p.year!, m: p.month!, d: p.day! };
}

function composeDay(p: Parts, style: Style, format: HotelFormats['dateFormat']): string {
  const day = String(Number(p.d));
  const month = MONTHS[Number(p.m) - 1] ?? p.m;
  if (format === 'YYYY-MM-DD') return style === 'short' ? `${p.m}-${p.d}` : `${p.y}-${p.m}-${p.d}`;
  if (format === 'MM/DD/YYYY') {
    if (style === 'numeric') return `${p.m}/${p.d}/${p.y}`;
    return style === 'medium' ? `${month} ${day}, ${p.y}` : `${month} ${day}`;
  }
  if (style === 'numeric') return `${p.d}/${p.m}/${p.y}`;
  return style === 'medium' ? `${day} ${month} ${p.y}` : `${day} ${month}`;
}

function composeTime(p: Parts, format: HotelFormats['timeFormat']): string {
  if (format === '24h') return `${p.hh}:${p.mm}`;
  const hour = Number(p.hh);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${p.mm} ${hour < 12 ? 'AM' : 'PM'}`;
}

/**
 * A date the way this hotel writes it: 03/11/2026 (numeric), 3 Nov 2026 (medium) or 3 Nov (short), following
 * the hotel's order. Returns an empty string for a missing or invalid value.
 */
export function formatDate(value: Moment, style: Style = 'numeric', formats = current): string {
  const parts = partsOf(value, false, formats);
  return parts ? composeDay(parts, style, formats.dateFormat) : '';
}

/** A time of day the way this hotel writes it: 14:30, or 2:30 PM. */
export function formatTime(value: Moment, formats = current): string {
  const parts = partsOf(value, true, formats);
  return parts?.hh ? composeTime(parts, formats.timeFormat) : '';
}

/** A moment as date and time, in the hotel's time zone: "03/11/2026 14:30". */
export function formatDateTime(value: Moment, style: Style = 'numeric', formats = current): string {
  const parts = partsOf(value, true, formats);
  return parts?.hh
    ? `${composeDay(parts, style, formats.dateFormat)} ${composeTime(parts, formats.timeFormat)}`
    : '';
}

/** The locale that writes numbers the hotel's way: 1,234.56 or 1.234,56. */
export const numberLocale = (formats = current) =>
  formats.numberFormat === 'dot_comma' ? 'de-DE' : 'en-US';

/** A number the way this hotel writes it; `options` are the usual Intl number options. */
export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions,
  formats = current,
): string {
  return new Intl.NumberFormat(numberLocale(formats), options).format(value);
}
