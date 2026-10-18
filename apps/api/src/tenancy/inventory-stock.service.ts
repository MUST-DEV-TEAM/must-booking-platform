import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { evaluateBookingRules, propertyClock, validRuleDate } from '../booking/booking-rules';
import { AuditLogService } from './audit-log.service';
import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';
import { applicableRestrictions } from './inventory-restrictions.repository';
import { inventoryBlockRows } from './inventory-blocks.service';
import { stockDay, stockInput, stockInvalid } from './inventory-stock-input';
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
type Pool = { roomTypeId: string; date: string; stock: number; soldHeld: number };
@Injectable()
export class InventoryStockService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}
  private async context(tx: TenantTransaction, tenantId: string, propertyId: string, lock = false) {
    const rows = await tx.$queryRaw<Array<{ timezone: string; bookingMode: string }>>(Prisma.sql`
      SELECT timezone,booking_mode::text AS "bookingMode" FROM properties
      WHERE tenant_id=${tenantId}::uuid AND id=${propertyId}::uuid ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`);
    if (!rows[0]) throw new NotFoundException('Property not found.');
    const external = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT c.id FROM property_integration_connections pc JOIN integration_connections c ON c.tenant_id=pc.tenant_id AND c.id=pc.connection_id
      WHERE pc.tenant_id=${tenantId}::uuid AND pc.property_id=${propertyId}::uuid AND pc.enabled AND pc.kind='PMS' AND c.provider='CLOCK_PMS'`;
    const source = external.length ? 'CLOCK_PMS' : 'LOCAL';
    const readOnly =
      source !== 'LOCAL' || !['ROOM_TYPE_ONLY', 'MIXED'].includes(rows[0].bookingMode);
    return {
      ...rows[0],
      today: propertyClock(rows[0].timezone).date,
      source,
      readOnly,
      explanation:
        source !== 'LOCAL'
          ? 'Unknown stock: managed in Clock.'
          : readOnly
            ? 'Stock comes from active individual rooms and cannot be edited here.'
            : rows[0].bookingMode === 'MIXED'
              ? 'Pool stock only. Active physical rooms can further limit bookability.'
              : 'Sellable stock per room type. Sold and held rooms are counted together.',
    };
  }
  private writable(c: { readOnly: boolean; explanation: string }) {
    if (c.readOnly)
      throw new ForbiddenException({ code: 'STOCK_READ_ONLY', message: c.explanation });
  }
  private pool(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    start: string,
    end: string,
    lock = false,
  ) {
    return tx.$queryRaw<
      Pool[]
    >(Prisma.sql`SELECT room_type_id AS "roomTypeId",stays_on::text AS date,available_units AS stock,booked_units AS "soldHeld"
      FROM inventory_units WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND stays_on>=${start}::date AND stays_on<${end}::date ORDER BY room_type_id,stays_on ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`);
  }
  async grid(tenantId: string, propertyId: string, query: unknown) {
    return this.database.withTenantTransaction(
      { tenantId, propertyId },
      async (tx) => {
        const c = await this.context(tx, tenantId, propertyId);
        const v = (query ?? {}) as Record<string, unknown>,
          start = v.startsOn ?? c.today;
        if (
          typeof start !== 'string' ||
          !validRuleDate(start) ||
          start.startsWith('0000') ||
          start > '9999-11-30'
        )
          stockInvalid('Choose a valid grid start date.');
        const end = stockDay(start, 30),
          dates = Array.from({ length: 30 }, (_, i) => stockDay(start, i));
        const types = await tx.$queryRaw<
          Array<{ id: string; name: string }>
        >`SELECT id,name FROM room_types WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid ORDER BY name,id`;
        if (c.source !== 'LOCAL')
          return {
            ...c,
            startsOn: start,
            endsOn: end,
            rows: types.map((t) => ({
              id: t.id,
              label: t.name,
              days: dates.map((date) => ({
                date,
                stock: null,
                soldHeld: null,
                remaining: null,
                blocked: false,
                markers: ['Managed in Clock'],
              })),
            })),
          };
        const pool = await this.pool(tx, tenantId, propertyId, start, end),
          blocks = await inventoryBlockRows(tx, tenantId, propertyId);
        const rooms = await tx.$queryRaw<
          Array<{ id: string; roomTypeId: string }>
        >`SELECT id,room_type_id AS "roomTypeId" FROM rooms WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid`;
        const physical = c.bookingMode === 'INDIVIDUAL_ROOM_ONLY';
        const roomDays = physical
          ? await tx.$queryRaw<
              Array<{
                roomTypeId: string;
                date: string;
                stock: number;
                soldHeld: number;
                unavailable: number;
              }>
            >`
        SELECT r.room_type_id AS "roomTypeId",d.day::date::text AS date,COUNT(*)::int AS stock,
          COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM bookings b WHERE b.tenant_id=${tenantId}::uuid AND b.property_id=${propertyId}::uuid AND b.room_id=r.id AND b.starts_on<=d.day::date AND b.ends_on>d.day::date AND b.status IN ('PAYMENT_PENDING','PAYMENT_NOT_REQUIRED','PMS_CREATION_PENDING','PMS_CONFIRMATION_PENDING','CONFIRMED','PAYMENT_FAILED','PMS_UNKNOWN_RESULT','PMS_REJECTED','MANUAL_REVIEW')))::int AS "soldHeld",
          COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM room_availability ra WHERE ra.tenant_id=${tenantId}::uuid AND ra.property_id=${propertyId}::uuid AND ra.room_id=r.id AND ra.stays_on=d.day::date AND NOT ra.is_available))::int AS unavailable
        FROM rooms r CROSS JOIN generate_series(${start}::date,${end}::date-1,interval '1 day') d(day)
        WHERE r.tenant_id=${tenantId}::uuid AND r.property_id=${propertyId}::uuid AND r.is_active GROUP BY r.room_type_id,d.day`
          : [];
        const rows = [];
        for (const t of types) {
          const rules = await applicableRestrictions(tx, tenantId, propertyId, t.id);
          const days = dates.map((date) => {
            const cell = (physical ? roomDays : pool).find(
              (p) => p.roomTypeId === t.id && p.date === date,
            );
            const stock = cell?.stock ?? 0,
              soldHeld = cell?.soldHeld ?? 0;
            const matching = blocks.filter(
              (b) =>
                ['Active', 'Scheduled'].includes(b.lifecycle) &&
                b.startsOn <= date &&
                b.endsOn > date &&
                (b.all ||
                  b.roomTypeIds.includes(t.id) ||
                  b.roomIds.some((id) => rooms.some((r) => r.id === id && r.roomTypeId === t.id))),
            );
            // Day markers use the same evaluator as search. Stay-length rules do not close a whole day.
            const errors = evaluateBookingRules({
              channel: 'staff',
              startsOn: date,
              endsOn: stockDay(date, 1),
              policy: { timezone: c.timezone },
              restrictions: rules,
            }).errors;
            const markers = errors
              .filter((e) =>
                ['STOP_SELL', 'CLOSED_TO_ARRIVAL', 'RESTRICTION_PRIORITY_CONFLICT'].includes(
                  e.code,
                ),
              )
              .map((e) => e.message);
            const departure = evaluateBookingRules({
              channel: 'staff',
              startsOn: stockDay(date, -1),
              endsOn: date,
              policy: { timezone: c.timezone },
              restrictions: rules,
            }).errors;
            if (departure.some((e) => e.code === 'CLOSED_TO_DEPARTURE'))
              markers.push('Departure closed.');
            if (matching.length)
              markers.push('Blocked: ' + matching.map((b) => b.title).join(', '));
            const unavailable = physical
              ? (roomDays.find((p) => p.roomTypeId === t.id && p.date === date)?.unavailable ?? 0)
              : 0;
            if (unavailable) markers.push(`${unavailable} individual rooms unavailable.`);
            return {
              date,
              stock,
              soldHeld,
              remaining: Math.max(0, stock - soldHeld),
              blocked: matching.length > 0,
              markers,
            };
          });
          rows.push({ id: t.id, label: t.name, days });
        }
        return { ...c, startsOn: start, endsOn: end, rows };
      },
      { timeoutMs: 20000 },
    );
  }
  private async changes(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    input: ReturnType<typeof stockInput>,
    today: string,
  ) {
    const ids = [...new Set(input.cells.map((c) => c.roomTypeId))];
    const types = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM room_types WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=ANY(${ids}::uuid[])`;
    if (types.length !== ids.length)
      throw new NotFoundException('Room type not found in this property.');
    const dates = input.cells.map((c) => c.date).sort(),
      pool = await this.pool(tx, tenantId, propertyId, dates[0]!, stockDay(dates.at(-1)!, 1), true);
    const changes = input.cells.map((cell) => {
      const current = pool.find((p) => p.roomTypeId === cell.roomTypeId && p.date === cell.date);
      const before = current?.stock ?? 0,
        soldHeld = current?.soldHeld ?? 0;
      const after =
        input.operation === 'reset'
          ? 0
          : input.operation === 'set'
            ? input.value
            : before + (input.operation === 'add' ? input.value : -input.value);
      const error =
        cell.date < today
          ? 'Past dates cannot be edited.'
          : after < soldHeld
            ? `Stock ${after} is below ${soldHeld} sold/held rooms.`
            : after < 0 || after > 2147483647
              ? 'Stock must be between 0 and 2147483647.'
              : null;
      return { ...cell, before, after, soldHeld, remaining: after - soldHeld, error };
    });
    return {
      valid: changes.every((c) => !c.error),
      changes,
      previewToken: hash({ operation: input.operation, value: input.value, changes, today }),
    };
  }
  async preview(tenantId: string, propertyId: string, body: unknown) {
    const input = stockInput(body);
    return this.database.withTenantTransaction(
      { tenantId, propertyId },
      async (tx) => {
        const c = await this.context(tx, tenantId, propertyId, true);
        this.writable(c);
        return this.changes(tx, tenantId, propertyId, input, c.today);
      },
      { timeoutMs: 20000 },
    );
  }
  async apply(
    tenantId: string,
    propertyId: string,
    actorUserId: string,
    body: unknown,
    key: string | undefined,
  ) {
    if (!key || !/^[\x21-\x7e]{1,128}$/.test(key))
      stockInvalid('Idempotency-Key is required (1-128 printable non-space characters).');
    const input = stockInput(body),
      requestHash = hash({ actorUserId, ...input });
    return this.database.withTenantTransaction(
      { tenantId, propertyId },
      async (tx) => {
        const c = await this.context(tx, tenantId, propertyId, true);
        this.writable(c);
        const receipts = await tx.$queryRaw<
          Array<{ requestHash: string; response: Prisma.JsonValue }>
        >`SELECT request_hash AS "requestHash",response FROM inventory_stock_operations WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND idempotency_key=${key}`;
        if (receipts[0]) {
          if (receipts[0].requestHash !== requestHash)
            throw new ConflictException({
              code: 'IDEMPOTENCY_KEY_REUSED',
              message: 'This key was already used for another stock change.',
            });
          return receipts[0].response;
        }
        const preview = await this.changes(tx, tenantId, propertyId, input, c.today);
        if (!preview.valid)
          throw new ConflictException({
            code: 'STOCK_VALIDATION_FAILED',
            message: preview.changes
              .filter((c) => c.error)
              .map((c) => `${c.date}: ${c.error}`)
              .join(' '),
            errors: preview.changes.filter((c) => c.error),
          });
        if (input.previewToken && input.previewToken !== preview.previewToken)
          throw new ConflictException({
            code: 'STOCK_PREVIEW_STALE',
            message: 'Stock or sold/held counts changed. Preview again before saving.',
          });
        for (const cell of preview.changes)
          await tx.$executeRaw`INSERT INTO inventory_units(tenant_id,property_id,room_type_id,stays_on,available_units) VALUES(${tenantId}::uuid,${propertyId}::uuid,${cell.roomTypeId}::uuid,${cell.date}::date,${cell.after}) ON CONFLICT(tenant_id,property_id,room_type_id,stays_on) DO UPDATE SET available_units=EXCLUDED.available_units,updated_at=CURRENT_TIMESTAMP`;
        const response = {
          id: randomUUID(),
          changedCells: preview.changes.filter((c) => c.before !== c.after).length,
        };
        await this.audit.recordInTransaction(tx, {
          tenantId,
          propertyId,
          actorUserId,
          action: 'inventory_units.bulk_change',
          targetType: 'inventory_stock',
          targetId: response.id,
          details: {
            operation: input.operation,
            cells: preview.changes,
            beforeCount: preview.changes.reduce((n, c) => n + c.before, 0),
            afterCount: preview.changes.reduce((n, c) => n + c.after, 0),
          },
        });
        await tx.$executeRaw`INSERT INTO inventory_stock_operations(tenant_id,property_id,idempotency_key,request_hash,response) VALUES(${tenantId}::uuid,${propertyId}::uuid,${key},${requestHash},${JSON.stringify(response)}::jsonb)`;
        return response;
      },
      { timeoutMs: 20000 },
    );
  }
}
