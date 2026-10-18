import { BadRequestException } from '@nestjs/common';
import { validRuleDate } from '../booking/booking-rules';
export const STOCK_CELL_LIMIT = 1000;
export const stockDay = (date: string, offset: number) =>
  new Date(Date.parse(date) + offset * 86400000).toISOString().slice(0, 10);
export type StockCell = { roomTypeId: string; date: string };
export function stockInvalid(message: string): never {
  throw new BadRequestException({ code: 'STOCK_INVALID', message });
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Normalize explicit cells or an exclusive-end rectangle before touching the database. */
export function stockInput(body: unknown) {
  const v = (body ?? {}) as Record<string, unknown>;
  const legacy = v.roomTypeId !== undefined;
  if (
    v.cells !== undefined &&
    (legacy || v.roomTypeIds !== undefined || v.startsOn !== undefined || v.endsOn !== undefined)
  )
    stockInvalid('Choose cells or a date rectangle, not both.');
  const operation = legacy ? 'set' : v.operation;
  if (!['set', 'add', 'subtract', 'reset'].includes(String(operation)))
    stockInvalid('Choose a stock operation.');
  const value = operation === 'reset' ? 0 : legacy ? v.availableUnits : v.value;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 2147483647)
    stockInvalid('Stock must be a non-negative integer up to 2147483647.');
  const weekdays = v.weekdays ?? [1, 2, 3, 4, 5, 6, 7];
  if (
    !Array.isArray(weekdays) ||
    !weekdays.length ||
    weekdays.some((d) => !Number.isInteger(d) || d < 1 || d > 7) ||
    new Set(weekdays).size !== weekdays.length
  )
    stockInvalid('Choose unique weekdays, Monday 1 through Sunday 7.');
  let cells: StockCell[] = [];
  if (v.cells !== undefined && !legacy) {
    if (!Array.isArray(v.cells) || v.cells.length > STOCK_CELL_LIMIT)
      stockInvalid('Choose at most 1000 cells.');
    cells = v.cells.map((c) => {
      if (!c || typeof c !== 'object') stockInvalid('Invalid stock cell.');
      return { roomTypeId: c.roomTypeId, date: c.date };
    });
  } else {
    const ids = legacy ? [v.roomTypeId] : v.roomTypeIds;
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > STOCK_CELL_LIMIT ||
      ids.some((id) => typeof id !== 'string' || !uuid.test(id)) ||
      new Set(ids.map((id) => String(id).toLowerCase())).size !== ids.length
    )
      stockInvalid('Choose unique room types.');
    if (
      typeof v.startsOn !== 'string' ||
      !validRuleDate(v.startsOn) ||
      typeof v.endsOn !== 'string' ||
      !validRuleDate(v.endsOn) ||
      v.endsOn <= v.startsOn
    )
      stockInvalid('Choose valid dates; the end date is exclusive.');
    const days = (Date.parse(v.endsOn) - Date.parse(v.startsOn)) / 86400000;
    if (days * ids.length > STOCK_CELL_LIMIT)
      stockInvalid('Choose at most 1000 cells before weekday filtering.');
    cells = ids.flatMap((roomTypeId) =>
      Array.from({ length: days }, (_, i) => ({
        roomTypeId: String(roomTypeId),
        date: stockDay(v.startsOn as string, i),
      })),
    );
  }
  if (
    !cells.length ||
    cells.some(
      (c) =>
        typeof c.roomTypeId !== 'string' ||
        !uuid.test(c.roomTypeId) ||
        typeof c.date !== 'string' ||
        !validRuleDate(c.date) ||
        c.date.startsWith('0000') ||
        c.date >= '9999-12-31',
    )
  )
    stockInvalid('Choose valid room types and dates.');
  cells = cells.map((c) => ({ ...c, roomTypeId: c.roomTypeId.toLowerCase() }));
  if (new Set(cells.map((c) => c.roomTypeId + ':' + c.date)).size !== cells.length)
    stockInvalid('Choose unique cells.');
  cells = cells
    .filter((c) => weekdays.includes(new Date(c.date + 'T00:00:00Z').getUTCDay() || 7))
    .sort((a, b) => a.roomTypeId.localeCompare(b.roomTypeId) || a.date.localeCompare(b.date));
  if (!cells.length) stockInvalid('No dates match the selected weekdays.');
  if (
    v.previewToken !== undefined &&
    (typeof v.previewToken !== 'string' || !/^[a-f0-9]{64}$/.test(v.previewToken))
  )
    stockInvalid('Invalid preview token.');
  return {
    cells,
    operation: operation as 'set' | 'add' | 'subtract' | 'reset',
    value,
    previewToken: v.previewToken as string | undefined,
  };
}
