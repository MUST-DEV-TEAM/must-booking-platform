import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { AuditLogService } from './audit-log.service';
import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';

export type AccommodationImportKind = 'room-types' | 'rooms';
type CsvRow = Record<string, unknown>;
type ImportAction = 'create' | 'update' | 'invalid';
type ImportPreviewRow = {
  rowNumber: number;
  action: ImportAction;
  target: string;
  errors: string[];
};
type ImportPreview = {
  kind: AccommodationImportKind;
  rows: ImportPreviewRow[];
  summary: { create: number; update: number; errors: number };
  canConfirm: boolean;
};

type CurrentRoomType = {
  id: string;
  name: string;
  rules: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'HIDDEN';
};
type CurrentRoom = {
  id: string;
  name: string;
  rules: string | null;
  roomTypeId: string;
  isActive: boolean;
};
type CurrentCategory = { id: string; name: string };
type RoomTypeImport = {
  id: string | null;
  name: string;
  description: string | null;
  amenitiesIntro: string | null;
  rules: string | null;
  maxOccupancy: number;
  status: 'DRAFT' | 'PUBLISHED' | 'HIDDEN';
  categoryId: string | null;
};
type RoomImport = {
  id: string | null;
  roomTypeId: string;
  name: string;
  title: string | null;
  roomSize: string | null;
  rules: string | null;
  description: string | null;
  floor: number | null;
  viewType: string | null;
  isActive: boolean;
};
type PlannedRow = {
  preview: ImportPreviewRow;
  value?: RoomTypeImport | RoomImport;
  existingId?: string;
};
type ImportPlan = { preview: ImportPreview; rows: PlannedRow[] };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_IMPORT_ROWS = 500;

/** Validates property-scoped CSV imports and applies an accepted batch atomically. */
@Injectable()
export class AccommodationImportService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  preview(tenantId: string, propertyId: string, body: unknown): Promise<ImportPreview> {
    const request = this.request(body);
    return this.database.withTenantTransaction(
      { tenantId, propertyId },
      async (tx) =>
        (await this.plan(tx, tenantId, propertyId, request.kind, request.rows, false)).preview,
    );
  }

  confirm(
    tenantId: string,
    propertyId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<ImportPreview['summary']> {
    const request = this.request(body);
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const plan = await this.plan(tx, tenantId, propertyId, request.kind, request.rows, true);
      if (!plan.preview.canConfirm)
        throw new BadRequestException({
          message: 'Fix the CSV rows with errors before importing.',
          preview: plan.preview,
        });

      for (const row of plan.rows) {
        const value = row.value!;
        if (request.kind === 'room-types') {
          const roomType = value as RoomTypeImport;
          if (row.existingId) {
            await tx.$executeRaw`
              UPDATE room_types SET name = ${roomType.name}, description = ${roomType.description},
                amenities_intro = ${roomType.amenitiesIntro}, max_occupancy = ${roomType.maxOccupancy},
                rules = ${roomType.rules},
                status = ${roomType.status}::"RoomTypeStatus", category_id = ${roomType.categoryId}::uuid,
                updated_at = CURRENT_TIMESTAMP
              WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
                AND id = ${row.existingId}::uuid
            `;
          } else {
            await tx.$executeRaw`
              INSERT INTO room_types (id, tenant_id, property_id, name, description, amenities_intro, rules,
                main_image_url, gallery_image_urls, max_occupancy, status, category_id)
              VALUES (${randomUUID()}::uuid, ${tenantId}::uuid, ${propertyId}::uuid,
                ${roomType.name}, ${roomType.description}, ${roomType.amenitiesIntro}, ${roomType.rules}, NULL,
                ARRAY[]::varchar(2000)[], ${roomType.maxOccupancy},
                ${roomType.status}::"RoomTypeStatus", ${roomType.categoryId}::uuid)
            `;
          }
        } else {
          const room = value as RoomImport;
          if (row.existingId) {
            await tx.$executeRaw`
              UPDATE rooms SET name = ${room.name}, title = ${room.title}, room_size = ${room.roomSize},
                rules = ${room.rules}, description = ${room.description}, floor = ${room.floor},
                view_type = ${room.viewType}, is_active = ${room.isActive}, updated_at = CURRENT_TIMESTAMP
              WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
                AND id = ${row.existingId}::uuid
            `;
          } else {
            await tx.$executeRaw`
              INSERT INTO rooms (id, tenant_id, property_id, room_type_id, name, title, room_size,
                rules, description, floor, view_type, is_active)
              VALUES (${randomUUID()}::uuid, ${tenantId}::uuid, ${propertyId}::uuid,
                ${room.roomTypeId}::uuid, ${room.name}, ${room.title}, ${room.roomSize},
                ${room.rules}, ${room.description}, ${room.floor}, ${room.viewType}, ${room.isActive})
            `;
          }
        }
      }

      const importId = randomUUID();
      await this.audit.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId,
        action: 'accommodation.imported',
        targetType: 'accommodation_import',
        targetId: importId,
        details: { kind: request.kind, ...plan.preview.summary },
      });
      return plan.preview.summary;
    });
  }

  private async plan(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    kind: AccommodationImportKind,
    rows: CsvRow[],
    lockRows: boolean,
  ): Promise<ImportPlan> {
    const roomTypes = lockRows
      ? await tx.$queryRaw<CurrentRoomType[]>`
          SELECT id, name, rules, status::text AS status FROM room_types
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
          ORDER BY name FOR UPDATE
        `
      : await tx.$queryRaw<CurrentRoomType[]>`
          SELECT id, name, rules, status::text AS status FROM room_types
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
          ORDER BY name
        `;
    const rooms = lockRows
      ? await tx.$queryRaw<CurrentRoom[]>`
          SELECT id, name, rules, room_type_id AS "roomTypeId", is_active AS "isActive" FROM rooms
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
          ORDER BY name FOR UPDATE
        `
      : await tx.$queryRaw<CurrentRoom[]>`
          SELECT id, name, rules, room_type_id AS "roomTypeId", is_active AS "isActive" FROM rooms
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
          ORDER BY name
        `;
    const categories =
      kind === 'room-types'
        ? await tx.$queryRaw<CurrentCategory[]>`
            SELECT id, name FROM room_categories
            WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
          `
        : [];

    const planned =
      kind === 'room-types'
        ? this.planRoomTypes(rows, roomTypes, categories)
        : this.planRooms(rows, roomTypes, rooms);
    const previewRows = planned.map((row) => row.preview);
    const summary = {
      create: previewRows.filter((row) => row.action === 'create').length,
      update: previewRows.filter((row) => row.action === 'update').length,
      errors: previewRows.filter((row) => row.errors.length > 0).length,
    };
    return {
      rows: planned,
      preview: {
        kind,
        rows: previewRows,
        summary,
        canConfirm: summary.errors === 0,
      },
    };
  }

  private planRoomTypes(
    rows: CsvRow[],
    current: CurrentRoomType[],
    categories: CurrentCategory[],
  ): PlannedRow[] {
    const byId = new Map(current.map((item) => [item.id, item]));
    const byName = new Map(current.map((item) => [item.name, item]));
    const categoryIds = new Set(categories.map((category) => category.id));
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();

    return rows.map((source, index) => {
      const errors: string[] = [];
      const name = text(source.name).trim();
      const rawId = text(source.id).trim();
      const id = rawId || null;
      if (!name) errors.push('Name is required.');
      if (name.length > 200) errors.push('Name must be at most 200 characters.');
      if (id && !uuidPattern.test(id)) errors.push('ID must be a UUID.');
      if (id && !byId.has(id)) errors.push('ID was not found in this property.');
      const existing = id ? byId.get(id) : byName.get(name);
      if (id && existing && byName.has(name) && byName.get(name)!.id !== id)
        errors.push('Another room type already has this name.');
      if (seenNames.has(name)) errors.push('This name appears more than once in the CSV.');
      if (existing && seenIds.has(existing.id))
        errors.push('This room type appears more than once in the CSV.');
      seenNames.add(name);
      if (existing) seenIds.add(existing.id);

      const maxOccupancy = integer(text(source.maxOccupancy));
      if (maxOccupancy === null || maxOccupancy <= 0)
        errors.push('Maximum occupancy must be a positive integer.');
      const statusText = text(source.status).trim().toUpperCase();
      const status = statusText || existing?.status || 'PUBLISHED';
      if (status !== 'DRAFT' && status !== 'PUBLISHED' && status !== 'HIDDEN')
        errors.push('Status must be DRAFT, PUBLISHED, or HIDDEN.');
      const rawCategoryId = text(source.categoryId).trim();
      const categoryId = rawCategoryId || null;
      if (categoryId && !uuidPattern.test(categoryId)) errors.push('Category ID must be a UUID.');
      else if (categoryId && !categoryIds.has(categoryId))
        errors.push('Category ID was not found in this property.');

      const value: RoomTypeImport = {
        id,
        name,
        description: optionalText(source.description),
        amenitiesIntro: optionalText(source.amenitiesIntro),
        rules: importedRules(source, existing?.rules),
        maxOccupancy: maxOccupancy ?? 0,
        status: status as RoomTypeImport['status'],
        categoryId,
      };
      return {
        preview: {
          rowNumber: index + 2,
          action: errors.length ? 'invalid' : existing ? 'update' : 'create',
          target: name || '(blank name)',
          errors,
        },
        ...(errors.length === 0 ? { value, ...(existing ? { existingId: existing.id } : {}) } : {}),
      };
    });
  }

  private planRooms(
    rows: CsvRow[],
    currentTypes: CurrentRoomType[],
    currentRooms: CurrentRoom[],
  ): PlannedRow[] {
    const typesById = new Map(currentTypes.map((item) => [item.id, item]));
    const typesByName = new Map(currentTypes.map((item) => [item.name, item]));
    const roomsById = new Map(currentRooms.map((item) => [item.id, item]));
    const roomsByName = new Map(currentRooms.map((item) => [item.name, item]));
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();

    return rows.map((source, index) => {
      const errors: string[] = [];
      const name = text(source.name).trim();
      const rawId = text(source.id).trim();
      const id = rawId || null;
      if (!name) errors.push('Name is required.');
      if (name.length > 200) errors.push('Name must be at most 200 characters.');
      if (id && !uuidPattern.test(id)) errors.push('ID must be a UUID.');
      if (id && !roomsById.has(id)) errors.push('ID was not found in this property.');
      const existing = id ? roomsById.get(id) : roomsByName.get(name);
      if (id && existing && roomsByName.has(name) && roomsByName.get(name)!.id !== id)
        errors.push('Another room already has this name.');
      if (seenNames.has(name)) errors.push('This name appears more than once in the CSV.');
      if (existing && seenIds.has(existing.id))
        errors.push('This room appears more than once in the CSV.');
      seenNames.add(name);
      if (existing) seenIds.add(existing.id);

      const roomTypeIdText = text(source.roomTypeId).trim();
      const roomTypeName = text(source.roomTypeName).trim();
      const typeFromId = roomTypeIdText ? typesById.get(roomTypeIdText) : undefined;
      const typeFromName = roomTypeName ? typesByName.get(roomTypeName) : undefined;
      if (roomTypeIdText && !uuidPattern.test(roomTypeIdText))
        errors.push('Room type ID must be a UUID.');
      else if (roomTypeIdText && !typeFromId)
        errors.push('Room type ID was not found in this property.');
      if (!roomTypeIdText && !roomTypeName)
        errors.push('Room type ID or room type name is required.');
      if (roomTypeName && !typeFromName && !roomTypeIdText)
        errors.push('Room type name was not found in this property.');
      if (typeFromId && typeFromName && typeFromId.id !== typeFromName.id)
        errors.push('Room type ID and name refer to different room types.');
      const roomType = typeFromId ?? typeFromName;
      if (existing && roomType && existing.roomTypeId !== roomType.id)
        errors.push('An existing room cannot be moved to another room type by import.');

      const title = optionalText(source.title);
      const roomSize = optionalText(source.roomSize);
      const viewType = optionalText(source.viewType);
      if (title && title.length > 200) errors.push('Title must be at most 200 characters.');
      if (roomSize && roomSize.length > 50) errors.push('Room size must be at most 50 characters.');
      if (viewType && viewType.length > 100)
        errors.push('View type must be at most 100 characters.');
      const rawFloor = text(source.floor).trim();
      const floor = rawFloor === '' ? null : integer(rawFloor);
      if (rawFloor !== '' && (floor === null || floor < -10 || floor > 200))
        errors.push('Floor must be an integer between -10 and 200.');
      const rawActive = text(source.isActive).trim().toLowerCase();
      const isActive = rawActive === '' ? (existing?.isActive ?? true) : rawActive === 'true';
      if (rawActive !== '' && rawActive !== 'true' && rawActive !== 'false')
        errors.push('Active must be true or false.');

      const value: RoomImport = {
        id,
        roomTypeId: roomType?.id ?? '',
        name,
        title,
        roomSize,
        rules: importedRules(source, existing?.rules),
        description: optionalText(source.description),
        floor,
        viewType,
        isActive,
      };
      return {
        preview: {
          rowNumber: index + 2,
          action: errors.length ? 'invalid' : existing ? 'update' : 'create',
          target: name
            ? `${name} · ${roomType?.name ?? (roomTypeName || 'Unknown room type')}`
            : '(blank name)',
          errors,
        },
        ...(errors.length === 0 ? { value, ...(existing ? { existingId: existing.id } : {}) } : {}),
      };
    });
  }

  private request(body: unknown): { kind: AccommodationImportKind; rows: CsvRow[] } {
    const value = (body ?? {}) as Record<string, unknown>;
    const kind = value.kind;
    if (kind !== 'room-types' && kind !== 'rooms')
      throw new BadRequestException('kind must be room-types or rooms.');
    if (
      !Array.isArray(value.rows) ||
      value.rows.length === 0 ||
      value.rows.length > MAX_IMPORT_ROWS
    )
      throw new BadRequestException(`rows must contain between 1 and ${MAX_IMPORT_ROWS} CSV rows.`);
    if (value.rows.some((row) => typeof row !== 'object' || row === null || Array.isArray(row)))
      throw new BadRequestException('Each CSV row must be an object.');
    return { kind, rows: value.rows as CsvRow[] };
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function optionalText(value: unknown): string | null {
  const normalized = text(value).trim();
  return normalized || null;
}

/** A CSV without a rules column must keep the stored rules; a present, blank cell clears them. */
function importedRules(source: Record<string, unknown>, current: string | null | undefined) {
  return source.rules === undefined ? (current ?? null) : optionalText(source.rules);
}

function integer(value: string): number | null {
  if (!/^-?\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
