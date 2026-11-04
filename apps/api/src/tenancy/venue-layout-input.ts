import { BadRequestException } from '@nestjs/common';

export type AreaInput = { name: string; sortOrder: number; mapWidth: number; mapHeight: number };
export type TableShape = 'square' | 'round' | 'rect';
export type TableInput = {
  label: string;
  minSeats: number;
  maxSeats: number;
  mapX: number;
  mapY: number;
  mapWidth: number;
  mapHeight: number;
  shape: TableShape;
  notes: string | null;
  features: string[];
  onlineBookable: boolean;
  priority: number;
};
export type TablePosition = {
  tableId: string;
  mapX: number;
  mapY: number;
  mapWidth?: number;
  mapHeight?: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHAPES: readonly TableShape[] = ['square', 'round', 'rect'];
export const TABLE_FEATURES = ['window', 'outdoor', 'accessible', 'quiet', 'high_chair'] as const;
const MAP_MIN = 400;
const MAP_MAX = 3000;
const MAX_POSITIONS = 500;
const MAX_COMBINABLE = 100;

function record(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw new BadRequestException('A JSON object is required.');
  return raw as Record<string, unknown>;
}

function name(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '')
    throw new BadRequestException(`${field} is required.`);
  const trimmed = value.trim();
  if (trimmed.length > max)
    throw new BadRequestException(`${field} must be at most ${max} characters.`);
  return trimmed;
}

function integer(value: unknown, field: string, min: number, max: number, fallback?: number) {
  const present = value !== undefined && value !== null;
  if (!present) {
    if (fallback === undefined) throw new BadRequestException(`${field} is required.`);
    return fallback;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
    throw new BadRequestException(`${field} must be a whole number from ${min} to ${max}.`);
  return value;
}

export function parseAreaInput(raw: unknown): AreaInput {
  const body = record(raw);
  return {
    name: name(body.name, 'Name', 100),
    sortOrder: integer(body.sortOrder, 'Sort order', 0, 10_000, 0),
    mapWidth: integer(body.mapWidth, 'Map width', MAP_MIN, MAP_MAX, 1000),
    mapHeight: integer(body.mapHeight, 'Map height', MAP_MIN, MAP_MAX, 700),
  };
}

export function parseAreaUpdate(raw: unknown): Partial<AreaInput> & { active?: boolean } {
  const body = record(raw);
  const input: Partial<AreaInput> & { active?: boolean } = {};
  if ('name' in body) input.name = name(body.name, 'Name', 100);
  if ('sortOrder' in body) input.sortOrder = integer(body.sortOrder, 'Sort order', 0, 10_000);
  if ('mapWidth' in body) input.mapWidth = integer(body.mapWidth, 'Map width', MAP_MIN, MAP_MAX);
  if ('mapHeight' in body)
    input.mapHeight = integer(body.mapHeight, 'Map height', MAP_MIN, MAP_MAX);
  if ('active' in body) {
    if (typeof body.active !== 'boolean')
      throw new BadRequestException('Active must be true or false.');
    input.active = body.active;
  }
  if (Object.keys(input).length === 0) throw new BadRequestException('Nothing to update.');
  return input;
}

/** A whole table, checked against the canvas of the area it sits in. */
export function parseTableInput(
  raw: unknown,
  area: { mapWidth: number; mapHeight: number },
): TableInput {
  const body = record(raw);
  const minSeats = integer(body.minSeats, 'Minimum seats', 1, 500);
  const maxSeats = integer(body.maxSeats, 'Maximum seats', 1, 500);
  if (maxSeats < minSeats)
    throw new BadRequestException('Maximum seats cannot be less than minimum seats.');
  const shape = body.shape === undefined || body.shape === null ? 'square' : body.shape;
  if (typeof shape !== 'string' || !SHAPES.includes(shape as TableShape))
    throw new BadRequestException('Shape must be square, round or rect.');
  if (body.notes != null && (typeof body.notes !== 'string' || body.notes.trim().length > 1000))
    throw new BadRequestException('Notes must be at most 1000 characters.');
  const features = body.features ?? [];
  if (!Array.isArray(features) || features.some((tag) => !TABLE_FEATURES.includes(tag)))
    throw new BadRequestException('Choose supported table features.');
  if (body.onlineBookable !== undefined && typeof body.onlineBookable !== 'boolean')
    throw new BadRequestException('Online booking must be true or false.');
  const width = integer(body.mapWidth, 'Table width', 1, MAP_MAX, shape === 'rect' ? 120 : 80);
  const height = integer(body.mapHeight, 'Table height', 1, MAP_MAX, 80);
  const input: TableInput = {
    label: name(body.label, 'Label', 30),
    minSeats,
    maxSeats,
    mapX: integer(body.mapX, 'Map x', 0, MAP_MAX, 0),
    mapY: integer(body.mapY, 'Map y', 0, MAP_MAX, 0),
    mapWidth: shape === 'rect' && width === height ? Math.round(width * 1.5) : width,
    mapHeight: shape === 'rect' ? height : width,
    shape: shape as TableShape,
    notes: typeof body.notes === 'string' ? body.notes.trim() || null : null,
    features: [...new Set(features)] as string[],
    onlineBookable: (body.onlineBookable as boolean | undefined) ?? true,
    priority: integer(body.priority, 'Priority', 0, 1000, 0),
  };
  if (input.mapX + input.mapWidth > area.mapWidth || input.mapY + input.mapHeight > area.mapHeight)
    throw new BadRequestException('The table must stay inside the area map.');
  return input;
}

export type PlacedRect = { x: number; y: number; w: number; h: number };

const FIRST_SPOT = 20;
const SCAN_STEP = 10;
const TABLE_GAP = 10;

/**
 * The first spot (reading left to right, top to bottom) where a new table fits without touching
 * another table, keeping a small gap. Null when the area has no room left.
 */
export function findFreeSpot(
  existing: readonly PlacedRect[],
  size: { w: number; h: number },
  canvas: { width: number; height: number },
): { x: number; y: number } | null {
  for (let y = FIRST_SPOT; y + size.h <= canvas.height; y += SCAN_STEP)
    for (let x = FIRST_SPOT; x + size.w <= canvas.width; x += SCAN_STEP) {
      const blocked = existing.some(
        (table) =>
          x < table.x + table.w + TABLE_GAP &&
          x + size.w + TABLE_GAP > table.x &&
          y < table.y + table.h + TABLE_GAP &&
          y + size.h + TABLE_GAP > table.y,
      );
      if (!blocked) return { x, y };
    }
  return null;
}

export function parseTableActive(raw: unknown): boolean | undefined {
  const body = record(raw);
  if (!('active' in body)) return undefined;
  if (typeof body.active !== 'boolean')
    throw new BadRequestException('Active must be true or false.');
  return body.active;
}

export function parsePositionsInput(raw: unknown): TablePosition[] {
  const list = record(raw).positions;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_POSITIONS)
    throw new BadRequestException(`Send between 1 and ${MAX_POSITIONS} table positions.`);
  const seen = new Set<string>();
  return list.map((item) => {
    const entry = record(item);
    if (typeof entry.tableId !== 'string' || !UUID.test(entry.tableId))
      throw new BadRequestException('Every position needs a valid table id.');
    const tableId = entry.tableId.toLowerCase();
    if (seen.has(tableId))
      throw new BadRequestException('A table can be moved only once at a time.');
    seen.add(tableId);
    return {
      tableId,
      mapX: integer(entry.mapX, 'Map x', 0, MAP_MAX),
      mapY: integer(entry.mapY, 'Map y', 0, MAP_MAX),
      ...(entry.mapWidth === undefined
        ? {}
        : { mapWidth: integer(entry.mapWidth, 'Table width', 20, MAP_MAX) }),
      ...(entry.mapHeight === undefined
        ? {}
        : { mapHeight: integer(entry.mapHeight, 'Table height', 20, MAP_MAX) }),
    };
  });
}

/** The unique, lower-cased ids of the tables a table may be pushed together with. */
export function parseCombinableInput(raw: unknown): string[] {
  const list = record(raw).tableIds;
  if (!Array.isArray(list) || list.length > MAX_COMBINABLE)
    throw new BadRequestException(`tableIds must be a list of at most ${MAX_COMBINABLE} ids.`);
  const ids = list.map((id) => {
    if (typeof id !== 'string' || !UUID.test(id))
      throw new BadRequestException('Every table id must be valid.');
    return id.toLowerCase();
  });
  return [...new Set(ids)];
}
