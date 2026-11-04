import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditLogService } from './audit-log.service';
import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';
import {
  findFreeSpot,
  parseAreaInput,
  parseAreaUpdate,
  parseCombinableInput,
  parsePositionsInput,
  parseTableActive,
  parseTableInput,
  type PlacedRect,
  type TableInput,
} from './venue-layout-input';
import { loadVenuePlan, requireDining } from './venue-plan';

export type AreaView = {
  id: string;
  name: string;
  sortOrder: number;
  mapWidth: number;
  mapHeight: number;
  active: boolean;
};
export type TableView = TableInput & { id: string; areaId: string; active: boolean };
export type LayoutView = {
  areas: Array<AreaView & { tables: TableView[] }>;
  combinations: Array<{ tableAId: string; tableBId: string }>;
};

// Fixed column lists, embedded as SQL (not as bind parameters).
const AREA_COLUMNS = Prisma.raw(
  '"id", "name", "sort_order" AS "sortOrder", "map_width" AS "mapWidth", "map_height" AS "mapHeight", "active"',
);
const TABLE_COLUMNS = Prisma.raw(
  '"notes", "features", "online_bookable" AS "onlineBookable", "priority", "id", "area_id" AS "areaId", "label", "min_seats" AS "minSeats", "max_seats" AS "maxSeats", "map_x" AS "mapX", "map_y" AS "mapY", "map_width" AS "mapWidth", "map_height" AS "mapHeight", "shape", "active"',
);

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2010' &&
    (error as { meta?: { code?: string } }).meta?.code === '23505'
  );
}

@Injectable()
export class VenueLayoutService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  /** Everything the map screen needs in one response. */
  async get(tenantId: string, venueId: string): Promise<LayoutView> {
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      requireDining(await loadVenuePlan(tx, tenantId));
      const areas = await tx.$queryRaw<AreaView[]>`
        SELECT ${AREA_COLUMNS} FROM "venue_areas"
        WHERE "tenant_id" = ${tenantId}::uuid AND "venue_id" = ${venueId}::uuid
        ORDER BY "sort_order", "created_at", "name"
      `;
      const tables = await tx.$queryRaw<TableView[]>`
        SELECT ${TABLE_COLUMNS} FROM "venue_tables"
        WHERE "tenant_id" = ${tenantId}::uuid AND "venue_id" = ${venueId}::uuid
        ORDER BY "label"
      `;
      const combinations = await tx.$queryRaw<Array<{ tableAId: string; tableBId: string }>>`
        SELECT "table_a_id" AS "tableAId", "table_b_id" AS "tableBId" FROM "venue_table_combinations"
        WHERE "tenant_id" = ${tenantId}::uuid AND "venue_id" = ${venueId}::uuid
        ORDER BY "table_a_id", "table_b_id"
      `;
      return {
        areas: areas.map((area) => ({
          ...area,
          tables: tables.filter((table) => table.areaId === area.id),
        })),
        combinations,
      };
    });
  }

  async createArea(
    tenantId: string,
    venueId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<AreaView> {
    const input = parseAreaInput(body);
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      requireDining(await loadVenuePlan(tx, tenantId));
      try {
        const rows = await tx.$queryRaw<AreaView[]>`
          INSERT INTO "venue_areas" ("tenant_id", "venue_id", "name", "sort_order", "map_width", "map_height")
          VALUES (${tenantId}::uuid, ${venueId}::uuid, ${input.name}, ${input.sortOrder}, ${input.mapWidth}, ${input.mapHeight})
          RETURNING ${AREA_COLUMNS}
        `;
        await this.changed(tx, tenantId, venueId, actorUserId, 'area_created', {
          name: input.name,
        });
        return rows[0]!;
      } catch (error) {
        if (isUniqueViolation(error))
          throw new ConflictException('An area with this name already exists in this restaurant.');
        throw error;
      }
    });
  }

  async updateArea(
    tenantId: string,
    venueId: string,
    areaId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<AreaView> {
    const input = parseAreaUpdate(body);
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      requireDining(await loadVenuePlan(tx, tenantId));
      if (input.mapWidth !== undefined || input.mapHeight !== undefined) {
        const extent = await tx.$queryRaw<Array<{ right: number | null; bottom: number | null }>>`
          SELECT MAX("map_x" + "map_width") AS "right", MAX("map_y" + "map_height") AS "bottom"
          FROM "venue_tables"
          WHERE "tenant_id" = ${tenantId}::uuid AND "venue_id" = ${venueId}::uuid AND "area_id" = ${areaId}::uuid
        `;
        const { right, bottom } = extent[0] ?? { right: null, bottom: null };
        if (
          (input.mapWidth !== undefined && right !== null && right > input.mapWidth) ||
          (input.mapHeight !== undefined && bottom !== null && bottom > input.mapHeight)
        )
          throw new BadRequestException('Some tables would fall outside a smaller map.');
      }
      const has = (key: keyof typeof input) => key in input;
      try {
        const rows = await tx.$queryRaw<AreaView[]>`
          UPDATE "venue_areas" SET
            "name" = CASE WHEN ${has('name')}::boolean THEN ${input.name ?? null} ELSE "name" END,
            "sort_order" = CASE WHEN ${has('sortOrder')}::boolean THEN ${input.sortOrder ?? null}::integer ELSE "sort_order" END,
            "map_width" = CASE WHEN ${has('mapWidth')}::boolean THEN ${input.mapWidth ?? null}::integer ELSE "map_width" END,
            "map_height" = CASE WHEN ${has('mapHeight')}::boolean THEN ${input.mapHeight ?? null}::integer ELSE "map_height" END,
            "active" = CASE WHEN ${has('active')}::boolean THEN ${input.active ?? null}::boolean ELSE "active" END,
            "updated_at" = CURRENT_TIMESTAMP
          WHERE "tenant_id" = ${tenantId}::uuid AND "venue_id" = ${venueId}::uuid AND "id" = ${areaId}::uuid
          RETURNING ${AREA_COLUMNS}
        `;
        if (!rows[0]) throw new NotFoundException('Area was not found.');
        await this.changed(tx, tenantId, venueId, actorUserId, 'area_updated', {
          areaId,
          fields: Object.keys(input),
        });
        return rows[0];
      } catch (error) {
        if (isUniqueViolation(error))
          throw new ConflictException('An area with this name already exists in this restaurant.');
        throw error;
      }
    });
  }

  async deleteArea(
    tenantId: string,
    venueId: string,
    areaId: string,
    actorUserId: string,
  ): Promise<void> {
    await this.database.withTenantTransaction({ tenantId }, async (tx) => {
      requireDining(await loadVenuePlan(tx, tenantId));
      const tables = await tx.$queryRaw<Array<{ n: number }>>`
        SELECT COUNT(*)::integer AS "n" FROM "venue_tables"
        WHERE "tenant_id" = ${tenantId}::uuid AND "venue_id" = ${venueId}::uuid AND "area_id" = ${areaId}::uuid
      `;
      if ((tables[0]?.n ?? 0) > 0) throw new ConflictException('Move or remove its tables first.');
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        DELETE FROM "venue_areas"
        WHERE "tenant_id" = ${tenantId}::uuid AND "venue_id" = ${venueId}::uuid AND "id" = ${areaId}::uuid
        RETURNING "id"
      `;
      if (!rows[0]) throw new NotFoundException('Area was not found.');
      await this.changed(tx, tenantId, venueId, actorUserId, 'area_deleted', { areaId });
    });
  }

  async createTable(
    tenantId: string,
    venueId: string,
    areaId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<TableView> {
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      requireDining(await loadVenuePlan(tx, tenantId));
      const area = await this.findArea(tx, tenantId, venueId, areaId);
      const parsed = parseTableInput(body, area);
      // Without an explicit position, put the table in the first free spot so new tables never stack.
      const given = (body ?? {}) as Record<string, unknown>;
      const input =
        given.mapX !== undefined || given.mapY !== undefined
          ? parsed
          : await this.placeInFreeSpot(tx, tenantId, venueId, areaId, parsed, area);
      try {
        const rows = await tx.$queryRaw<TableView[]>`
          INSERT INTO "venue_tables" ("tenant_id", "venue_id", "area_id", "label", "min_seats", "max_seats", "map_x", "map_y", "map_width", "map_height", "shape", "notes", "features", "online_bookable", "priority")
          VALUES (${tenantId}::uuid, ${venueId}::uuid, ${areaId}::uuid, ${input.label}, ${input.minSeats}, ${input.maxSeats},
                  ${input.mapX}, ${input.mapY}, ${input.mapWidth}, ${input.mapHeight}, ${input.shape}, ${input.notes}, ${input.features}::text[], ${input.onlineBookable}, ${input.priority})
          RETURNING ${TABLE_COLUMNS}
        `;
        await this.changed(tx, tenantId, venueId, actorUserId, 'table_created', {
          label: input.label,
        });
        return rows[0]!;
      } catch (error) {
        if (isUniqueViolation(error))
          throw new ConflictException('A table with this label already exists in this area.');
        throw error;
      }
    });
  }

  /** Edits are merged over the stored table and the whole table is validated again. */
  async updateTable(
    tenantId: string,
    venueId: string,
    tableId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<TableView> {
    const active = parseTableActive(body);
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      requireDining(await loadVenuePlan(tx, tenantId));
      const current = await tx.$queryRaw<
        Array<TableView & { areaWidth: number; areaHeight: number }>
      >`
        SELECT t."id", t."area_id" AS "areaId", t."label", t."min_seats" AS "minSeats", t."max_seats" AS "maxSeats",
               t."map_x" AS "mapX", t."map_y" AS "mapY", t."map_width" AS "mapWidth", t."map_height" AS "mapHeight",
               t."shape", t."active", t."notes", t."features", t."online_bookable" AS "onlineBookable", t."priority", a."map_width" AS "areaWidth", a."map_height" AS "areaHeight"
        FROM "venue_tables" t
        JOIN "venue_areas" a ON a."tenant_id" = t."tenant_id" AND a."venue_id" = t."venue_id" AND a."id" = t."area_id"
        WHERE t."tenant_id" = ${tenantId}::uuid AND t."venue_id" = ${venueId}::uuid AND t."id" = ${tableId}::uuid
      `;
      const row = current[0];
      if (!row) throw new NotFoundException('Table was not found.');
      const edits = (body ?? {}) as Record<string, unknown>;
      const fields = [
        'label',
        'minSeats',
        'maxSeats',
        'mapX',
        'mapY',
        'mapWidth',
        'mapHeight',
        'shape',
        'notes',
        'features',
        'onlineBookable',
        'priority',
      ];
      if (!fields.some((key) => key in edits) && active === undefined)
        throw new BadRequestException('Nothing to update.');
      const merged = {
        ...row,
        ...Object.fromEntries(fields.filter((k) => k in edits).map((k) => [k, edits[k]])),
      };
      const input = parseTableInput(merged, { mapWidth: row.areaWidth, mapHeight: row.areaHeight });
      try {
        const rows = await tx.$queryRaw<TableView[]>`
          UPDATE "venue_tables" SET
            "label" = ${input.label}, "min_seats" = ${input.minSeats}, "max_seats" = ${input.maxSeats},
            "map_x" = ${input.mapX}, "map_y" = ${input.mapY}, "map_width" = ${input.mapWidth},
            "map_height" = ${input.mapHeight}, "shape" = ${input.shape},
            "notes" = ${input.notes}, "features" = ${input.features}::text[], "online_bookable" = ${input.onlineBookable}, "priority" = ${input.priority},
            "active" = ${active ?? row.active}::boolean, "updated_at" = CURRENT_TIMESTAMP
          WHERE "tenant_id" = ${tenantId}::uuid AND "venue_id" = ${venueId}::uuid AND "id" = ${tableId}::uuid
          RETURNING ${TABLE_COLUMNS}
        `;
        await this.changed(tx, tenantId, venueId, actorUserId, 'table_updated', { tableId });
        return rows[0]!;
      } catch (error) {
        if (isUniqueViolation(error))
          throw new ConflictException('A table with this label already exists in this area.');
        throw error;
      }
    });
  }

  async deleteTable(
    tenantId: string,
    venueId: string,
    tableId: string,
    actorUserId: string,
  ): Promise<void> {
    await this.database.withTenantTransaction({ tenantId }, async (tx) => {
      requireDining(await loadVenuePlan(tx, tenantId));
      const used = await tx.$queryRaw<Array<{ n: number }>>`
        SELECT COUNT(*)::int AS "n" FROM "venue_reservation_tables"
        WHERE "tenant_id" = ${tenantId}::uuid AND "table_id" = ${tableId}::uuid
      `;
      if ((used[0]?.n ?? 0) > 0) {
        throw new ConflictException(
          'This table has bookings, so it cannot be deleted. Mark it as not in use instead.',
        );
      }
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        DELETE FROM "venue_tables"
        WHERE "tenant_id" = ${tenantId}::uuid AND "venue_id" = ${venueId}::uuid AND "id" = ${tableId}::uuid
        RETURNING "id"
      `;
      if (!rows[0]) throw new NotFoundException('Table was not found.');
      await this.changed(tx, tenantId, venueId, actorUserId, 'table_deleted', { tableId });
    });
  }

  /** Moves many tables at once; either every move is valid and saved, or nothing changes. */
  async savePositions(
    tenantId: string,
    venueId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<{ moved: number }> {
    const positions = parsePositionsInput(body);
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      requireDining(await loadVenuePlan(tx, tenantId));
      const found = await tx.$queryRaw<
        Array<{
          id: string;
          mapWidth: number;
          mapHeight: number;
          areaWidth: number;
          areaHeight: number;
          shape: string;
        }>
      >`
        SELECT t."id", t."shape", t."map_width" AS "mapWidth", t."map_height" AS "mapHeight",
               a."map_width" AS "areaWidth", a."map_height" AS "areaHeight"
        FROM "venue_tables" t
        JOIN "venue_areas" a ON a."tenant_id" = t."tenant_id" AND a."venue_id" = t."venue_id" AND a."id" = t."area_id"
        WHERE t."tenant_id" = ${tenantId}::uuid AND t."venue_id" = ${venueId}::uuid
          AND t."id" = ANY(${positions.map((p) => p.tableId)}::uuid[])
      `;
      if (found.length !== positions.length) throw new NotFoundException('Table was not found.');
      const byId = new Map(found.map((row) => [row.id.toLowerCase(), row]));
      for (const position of positions) {
        const row = byId.get(position.tableId)!;
        const w = position.mapWidth ?? row.mapWidth;
        const h = position.mapHeight ?? row.mapHeight;
        if (
          (position.mapWidth !== undefined || position.mapHeight !== undefined) &&
          ((row.shape !== 'rect' && w !== h) || (row.shape === 'rect' && w === h))
        )
          throw new BadRequestException(
            'Squares and circles need equal sides; rectangles need different sides.',
          );
        if (position.mapX + w > row.areaWidth || position.mapY + h > row.areaHeight)
          throw new BadRequestException('Every table must stay inside its area map.');
      }
      for (const position of positions)
        await tx.$queryRaw`
          UPDATE "venue_tables" SET "map_x" = ${position.mapX}, "map_y" = ${position.mapY},
            "map_width" = COALESCE(${position.mapWidth ?? null}::integer, "map_width"),
            "map_height" = COALESCE(${position.mapHeight ?? null}::integer, "map_height"), "updated_at" = CURRENT_TIMESTAMP
          WHERE "tenant_id" = ${tenantId}::uuid AND "venue_id" = ${venueId}::uuid AND "id" = ${position.tableId}::uuid
        `;
      await this.changed(tx, tenantId, venueId, actorUserId, 'tables_moved', {
        count: positions.length,
      });
      return { moved: positions.length };
    });
  }

  /** Replaces the set of tables this table can be pushed together with. */
  async setCombinable(
    tenantId: string,
    venueId: string,
    tableId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<{ tableIds: string[] }> {
    const others = parseCombinableInput(body);
    const self = tableId.toLowerCase();
    if (others.includes(self))
      throw new BadRequestException('A table cannot be combined with itself.');
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      requireDining(await loadVenuePlan(tx, tenantId));
      const found = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "venue_tables"
        WHERE "tenant_id" = ${tenantId}::uuid AND "venue_id" = ${venueId}::uuid
          AND "id" = ANY(${[self, ...others]}::uuid[])
      `;
      if (found.length !== others.length + 1) throw new NotFoundException('Table was not found.');
      await tx.$queryRaw`
        DELETE FROM "venue_table_combinations"
        WHERE "tenant_id" = ${tenantId}::uuid AND "venue_id" = ${venueId}::uuid
          AND (${self}::uuid IN ("table_a_id", "table_b_id"))
      `;
      if (others.length > 0) {
        // One row per unordered pair, smaller id first.
        const firsts = others.map((other) => (other < self ? other : self));
        const seconds = others.map((other) => (other < self ? self : other));
        await tx.$queryRaw`
          INSERT INTO "venue_table_combinations" ("tenant_id", "venue_id", "table_a_id", "table_b_id")
          SELECT ${tenantId}::uuid, ${venueId}::uuid, p."a", p."b"
          FROM unnest(${firsts}::uuid[], ${seconds}::uuid[]) AS p("a", "b")
        `;
      }
      await this.changed(tx, tenantId, venueId, actorUserId, 'tables_combinable', {
        tableId: self,
        count: others.length,
      });
      return { tableIds: others };
    });
  }

  private async placeInFreeSpot(
    tx: TenantTransaction,
    tenantId: string,
    venueId: string,
    areaId: string,
    input: TableInput,
    area: { mapWidth: number; mapHeight: number },
  ): Promise<TableInput> {
    const existing = await tx.$queryRaw<PlacedRect[]>`
      SELECT "map_x" AS "x", "map_y" AS "y",
             CASE WHEN "shape" = 'rect' AND "map_width" = "map_height" THEN round("map_width" * 1.5)::integer ELSE "map_width" END AS "w",
             CASE WHEN "shape" <> 'rect' THEN "map_width" ELSE "map_height" END AS "h"
      FROM "venue_tables"
      WHERE "tenant_id" = ${tenantId}::uuid AND "venue_id" = ${venueId}::uuid AND "area_id" = ${areaId}::uuid
    `;
    const spot = findFreeSpot(
      existing,
      { w: input.mapWidth, h: input.mapHeight },
      { width: area.mapWidth, height: area.mapHeight },
    );
    if (!spot)
      throw new ConflictException(
        'There is no space left on this map. Resize or move a table first.',
      );
    return { ...input, mapX: spot.x, mapY: spot.y };
  }

  private async findArea(
    tx: TenantTransaction,
    tenantId: string,
    venueId: string,
    areaId: string,
  ): Promise<{ mapWidth: number; mapHeight: number }> {
    const rows = await tx.$queryRaw<Array<{ mapWidth: number; mapHeight: number }>>`
      SELECT "map_width" AS "mapWidth", "map_height" AS "mapHeight" FROM "venue_areas"
      WHERE "tenant_id" = ${tenantId}::uuid AND "venue_id" = ${venueId}::uuid AND "id" = ${areaId}::uuid
    `;
    if (!rows[0]) throw new NotFoundException('Area was not found.');
    return rows[0];
  }

  private changed(
    tx: TenantTransaction,
    tenantId: string,
    venueId: string,
    actorUserId: string,
    change: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.recordInTransaction(tx, {
      tenantId,
      actorUserId,
      action: 'venue.layout_changed',
      targetType: 'venue',
      targetId: venueId,
      details: { change, ...details },
    });
  }
}
