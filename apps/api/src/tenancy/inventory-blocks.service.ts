import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { propertyClock, validRuleDate } from '../booking/booking-rules';
import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';
import { AuditLogService } from './audit-log.service';

export const inventoryBlockReasons = [
  'maintenance',
  'renovation',
  'safety_inspection',
  'deep_cleaning',
  'owner_use',
  'house_use',
  'event',
  'out_of_service',
  'other',
] as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function invalid(message: string): never {
  throw new BadRequestException({ code: 'BLOCK_INVALID', message });
}
export type BlockInput = {
  title: string;
  reason: string;
  startsOn: string;
  endsOn: string;
  all: boolean;
  roomTypeIds: string[];
  roomIds: string[];
  responsibleStaffId: string | null;
  reference: string;
  note: string;
};
export type BlockRecord = BlockInput & {
  id: string;
  lifecycle: string;
  scopeLocked: boolean;
  version: number;
  endReason: string | null;
  inventoryReference: string | null;
  createdByUserId: string | null;
  createdByEmail: string | null;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};
export function blockLifecycle(
  block: Pick<BlockRecord, 'lifecycle' | 'startsOn' | 'endsOn'>,
  today: string,
) {
  if (['Draft', 'Cancelled', 'Ended'].includes(block.lifecycle)) return block.lifecycle;
  return block.endsOn <= today ? 'Ended' : block.startsOn > today ? 'Scheduled' : 'Active';
}
export function blockInput(body: unknown): BlockInput {
  const v = (body ?? {}) as Record<string, unknown>;
  function text(key: string, max: number, required = false) {
    const value = v[key] ?? '';
    if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim()))
      invalid(`${key} must be ${required ? 'non-empty ' : ''}text of at most ${max} characters.`);
    return value.trim();
  }
  function ids(key: string) {
    const a = v[key] ?? [];
    if (
      !Array.isArray(a) ||
      a.length > 500 ||
      a.some((id) => typeof id !== 'string' || !uuid.test(id))
    )
      invalid(`Invalid ${key}.`);
    const result = a.map((id) => String(id).toLowerCase()).sort();
    if (new Set(result).size !== result.length) invalid(`Choose unique ${key}.`);
    return result;
  }
  const roomTypeIds = ids('roomTypeIds'),
    roomIds = ids('roomIds');
  if (
    typeof v.all !== 'boolean' ||
    (v.all ? roomTypeIds.length + roomIds.length > 0 : roomTypeIds.length + roomIds.length === 0)
  )
    invalid('Choose property scope or at least one room type or room.');
  if (
    typeof v.startsOn !== 'string' ||
    !validRuleDate(v.startsOn) ||
    v.startsOn.startsWith('0000') ||
    typeof v.endsOn !== 'string' ||
    !validRuleDate(v.endsOn) ||
    v.endsOn <= v.startsOn
  )
    invalid('Choose valid dates with available-again after start.');
  if (!inventoryBlockReasons.includes(v.reason as (typeof inventoryBlockReasons)[number]))
    invalid('Choose a supported block reason.');
  const staff = v.responsibleStaffId ?? null;
  if (staff !== null && (typeof staff !== 'string' || !uuid.test(staff)))
    invalid('Invalid responsible staff.');
  return {
    title: text('title', 200, true),
    reason: v.reason as string,
    startsOn: v.startsOn,
    endsOn: v.endsOn,
    all: v.all,
    roomTypeIds,
    roomIds,
    responsibleStaffId: typeof staff === 'string' ? staff.toLowerCase() : null,
    reference: text('reference', 80),
    note: text('note', 500),
  };
}
export async function inventoryBlockRows(
  tx: TenantTransaction,
  tenantId: string,
  propertyId: string,
) {
  return tx.$queryRaw<
    BlockRecord[]
  >`SELECT b.id,b.title,b.reason,b.starts_on::text AS "startsOn",b.ends_on::text AS "endsOn",b.blocks_all AS "all",b.lifecycle,b.scope_locked AS "scopeLocked",b.version,b.end_reason AS "endReason",b.inventory_reference AS "inventoryReference",b.responsible_staff_id AS "responsibleStaffId",COALESCE(b.reference,'') AS reference,COALESCE(b.note,'') AS note,b.created_by_user_id AS "createdByUserId",u.email AS "createdByEmail",b.updated_by_user_id AS "updatedByUserId",b.created_at AS "createdAt",b.updated_at AS "updatedAt",
 ARRAY(SELECT t.room_type_id::text FROM availability_block_room_types t WHERE t.tenant_id=${tenantId}::uuid AND t.property_id=${propertyId}::uuid AND t.block_id=b.id ORDER BY t.room_type_id) AS "roomTypeIds",
 ARRAY(SELECT r.room_id::text FROM availability_block_rooms r WHERE r.tenant_id=${tenantId}::uuid AND r.property_id=${propertyId}::uuid AND r.block_id=b.id ORDER BY r.room_id) AS "roomIds"
 FROM availability_blocks b LEFT JOIN users u ON u.id=b.created_by_user_id WHERE b.tenant_id=${tenantId}::uuid AND b.property_id=${propertyId}::uuid ORDER BY b.created_at DESC,b.id`;
}
@Injectable()
export class InventoryBlocksService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}
  private async context(tx: TenantTransaction, tenantId: string, propertyId: string, lock = false) {
    const p = await tx.$queryRaw<Array<{ timezone: string; bookingMode: string }>>(
      Prisma.sql`SELECT timezone,booking_mode::text AS "bookingMode" FROM properties WHERE tenant_id=${tenantId}::uuid AND id=${propertyId}::uuid ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`,
    );
    if (!p[0]) throw new NotFoundException('Property not found.');
    const external = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT c.id FROM property_integration_connections pc JOIN integration_connections c ON c.tenant_id=pc.tenant_id AND c.id=pc.connection_id WHERE pc.tenant_id=${tenantId}::uuid AND pc.property_id=${propertyId}::uuid AND pc.enabled AND pc.kind='PMS' AND c.provider='CLOCK_PMS'`;
    return {
      ...p[0],
      today: propertyClock(p[0].timezone).date,
      source: external.length ? 'CLOCK_PMS' : 'LOCAL',
    };
  }
  private local(source: string) {
    if (source !== 'LOCAL')
      throw new ForbiddenException({
        code: 'EXTERNAL_BLOCKS_READ_ONLY',
        message: 'Clock inventory is read-only; local block changes are disabled.',
      });
  }
  async list(tenantId: string, propertyId: string) {
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const context = await this.context(tx, tenantId, propertyId);
      const records = await inventoryBlockRows(tx, tenantId, propertyId);
      const items = [];
      for (const b of records) {
        const lifecycle = blockLifecycle(b, context.today);
        const conflicts = ['Active', 'Scheduled', 'Draft'].includes(lifecycle)
          ? await this.conflicts(tx, tenantId, propertyId, b, b.id)
          : [];
        items.push({
          ...b,
          lifecycle,
          endingSoon:
            ['Active', 'Scheduled'].includes(lifecycle) &&
            b.endsOn <=
              new Date(Date.parse(context.today) + 7 * 86400000).toISOString().slice(0, 10),
          validation: conflicts.length ? 'Conflict' : 'Healthy',
          conflicts,
        });
      }
      return { ...context, readOnly: context.source !== 'LOCAL', items };
    });
  }
  async get(tenantId: string, propertyId: string, id: string) {
    this.id(id);
    const list = await this.list(tenantId, propertyId);
    const record = list.items.find((b) => b.id === id.toLowerCase());
    if (!record) throw new NotFoundException('Block not found.');
    return record;
  }
  async history(tenantId: string, propertyId: string, id: string) {
    this.id(id);
    return this.database.withTenantTransaction(
      { tenantId, propertyId },
      (tx) =>
        tx.$queryRaw`SELECT id,action,actor_user_id AS "actorUserId",details,created_at AS "createdAt" FROM audit_logs WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND target_type='inventory_block' AND target_id=${id.toLowerCase()} ORDER BY created_at,id`,
    );
  }
  async validate(tenantId: string, propertyId: string, body: unknown) {
    const input = blockInput(body);
    const id = (body as { id?: string }).id;
    if (id) this.id(id);
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const c = await this.context(tx, tenantId, propertyId);
      this.local(c.source);
      await this.targets(tx, tenantId, propertyId, input, c.bookingMode);
      const conflicts = await this.conflicts(tx, tenantId, propertyId, input, id?.toLowerCase());
      return {
        valid: input.endsOn > c.today && !conflicts.length,
        conflicts,
        errors:
          input.endsOn <= c.today
            ? [{ code: 'BLOCK_ENDED', message: 'The block period has ended.' }]
            : [],
      };
    });
  }
  private id(id: string) {
    if (!uuid.test(id)) invalid('Invalid block ID.');
  }
  private async targets(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    input: BlockInput,
    mode: string,
  ) {
    const types = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM room_types WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=ANY(${input.roomTypeIds}::uuid[])`;
    const rooms = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM rooms WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=ANY(${input.roomIds}::uuid[])`;
    if (types.length !== input.roomTypeIds.length || rooms.length !== input.roomIds.length)
      invalid('Every target must belong to this property.');
    if (mode === 'ROOM_TYPE_ONLY' && input.roomIds.length)
      invalid('Individual rooms are unavailable in room-type-only mode.');
    if (input.responsibleStaffId) {
      const staff = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT m.user_id AS id FROM tenant_memberships m WHERE m.tenant_id=${tenantId}::uuid AND m.user_id=${input.responsibleStaffId}::uuid AND (m.role IN ('OWNER','ADMIN') OR EXISTS(SELECT 1 FROM property_staff_assignments a WHERE a.tenant_id=${tenantId}::uuid AND a.property_id=${propertyId}::uuid AND a.user_id=m.user_id AND a.suspended_at IS NULL))`;
      if (!staff.length) invalid('Responsible staff must have access to this property.');
    }
  }
  private async conflicts(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    input: BlockInput,
    id?: string,
  ) {
    // Unassigned reservations in a targeted room type are conservatively protected too.
    const reservations = await tx.$queryRaw<
      Array<{ id: string; reference: string; kind: string; startsOn: string; endsOn: string }>
    >`SELECT b.id,b.external_reference AS reference,CASE WHEN b.status='PAYMENT_PENDING' THEN 'hold' ELSE 'reservation' END AS kind,b.starts_on::text AS "startsOn",b.ends_on::text AS "endsOn" FROM bookings b WHERE b.tenant_id=${tenantId}::uuid AND b.property_id=${propertyId}::uuid AND b.starts_on<${input.endsOn}::date AND b.ends_on>${input.startsOn}::date AND b.status NOT IN ('CANCELLED','EXPIRED','DRAFT','QUOTED') AND (${input.all} OR b.room_type_id=ANY(${input.roomTypeIds}::uuid[]) OR b.room_id=ANY(${input.roomIds}::uuid[]) OR (b.room_id IS NULL AND b.room_type_id IN(SELECT r.room_type_id FROM rooms r WHERE r.tenant_id=${tenantId}::uuid AND r.property_id=${propertyId}::uuid AND r.id=ANY(${input.roomIds}::uuid[])))) ORDER BY b.starts_on,b.id LIMIT 100`;
    const records = await inventoryBlockRows(tx, tenantId, propertyId);
    const rooms = await tx.$queryRaw<
      Array<{ id: string; roomTypeId: string }>
    >`SELECT id,room_type_id AS "roomTypeId" FROM rooms WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid`;
    const overlaps = (a: BlockInput, b: BlockInput) =>
      a.all ||
      b.all ||
      a.roomTypeIds.some(
        (t) =>
          b.roomTypeIds.includes(t) ||
          b.roomIds.some((r) => rooms.some((x) => x.id === r && x.roomTypeId === t)),
      ) ||
      a.roomIds.some(
        (r) =>
          b.roomIds.includes(r) ||
          rooms.some((x) => x.id === r && b.roomTypeIds.includes(x.roomTypeId)),
      );
    return [
      ...reservations,
      ...records
        .filter(
          (b) =>
            b.id !== id &&
            ['Active', 'Scheduled'].includes(b.lifecycle) &&
            b.startsOn < input.endsOn &&
            b.endsOn > input.startsOn &&
            overlaps(input, b),
        )
        .map((b) => ({
          id: b.id,
          reference: b.inventoryReference ?? b.reference,
          kind: 'block',
          startsOn: b.startsOn,
          endsOn: b.endsOn,
        })),
    ];
  }
  async mutate(
    tenantId: string,
    propertyId: string,
    actor: string,
    key: string | undefined,
    action: 'create' | 'edit' | 'activate' | 'end' | 'cancel' | 'delete',
    id: string | undefined,
    body: unknown,
  ) {
    if (!key || !/^[\x21-\x7e]{1,128}$/.test(key)) invalid('An Idempotency-Key is required.');
    if (id) {
      this.id(id);
      id = id.toLowerCase();
    }
    const v = (body ?? {}) as Record<string, unknown>;
    const input = ['create', 'edit'].includes(action) ? blockInput(v) : null;
    if (v.lifecycle !== undefined) invalid('Use lifecycle actions to change status.');
    if (action !== 'create' && (!Number.isInteger(v.version) || (v.version as number) < 1))
      invalid('A current positive version is required.');
    const endReason = v.endReason ?? '';
    if (typeof endReason !== 'string' || endReason.trim().length > 4000)
      invalid('End reason must be text of at most 4000 characters.');
    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          actor,
          action,
          id,
          input,
          version: v.version ?? null,
          endReason: endReason.trim(),
        }),
      )
      .digest('hex');
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const c = await this.context(tx, tenantId, propertyId, true);
      this.local(c.source);
      const receipt = await tx.$queryRaw<
        Array<{ hash: string; response: unknown }>
      >`SELECT request_hash AS hash,response FROM inventory_block_operations WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND idempotency_key=${key}`;
      if (receipt[0]) {
        if (receipt[0].hash !== hash)
          throw new ConflictException({
            code: 'IDEMPOTENCY_KEY_REUSED',
            message: 'Key already used for another request.',
          });
        return receipt[0].response;
      }
      const current = id
        ? (await inventoryBlockRows(tx, tenantId, propertyId)).find((b) => b.id === id)
        : undefined;
      if (id && !current) throw new NotFoundException('Block not found.');
      if (current && current.version !== v.version)
        throw new ConflictException({
          code: 'BLOCK_VERSION_CONFLICT',
          message: 'Reload the block before saving.',
          currentVersion: current.version,
        });
      const state = current ? blockLifecycle(current, c.today) : 'Draft';
      if (current && ['Ended', 'Cancelled'].includes(state))
        invalid('Ended and cancelled blocks are read-only.');
      if (action === 'delete' && state !== 'Draft') invalid('Only draft blocks may be deleted.');
      if (action === 'activate' && state !== 'Draft') invalid('Only a draft can activate.');
      if (action === 'end' && state !== 'Active') invalid('Only an active block can end early.');
      if (action === 'cancel' && !['Draft', 'Scheduled'].includes(state))
        invalid('Only draft or scheduled blocks can be cancelled. End an active block.');
      const next = input ?? current!;
      let lifecycle = action === 'create' ? 'Draft' : current!.lifecycle;
      let scopeLocked = current?.scopeLocked ?? false;
      if (action === 'edit' && current) {
        const scopeChanged =
          current.all !== next.all ||
          JSON.stringify(current.roomTypeIds) !== JSON.stringify(next.roomTypeIds) ||
          JSON.stringify(current.roomIds) !== JSON.stringify(next.roomIds);
        if (scopeChanged && (current.scopeLocked || state === 'Active'))
          invalid('Scope is locked after activation; end this block and create another.');
        if (state === 'Active' && next.endsOn < current.endsOn && !endReason.trim())
          invalid('Shortening an active block requires an end reason.');
      }
      if (action === 'end') {
        if (!endReason.trim()) invalid('Ending early requires a reason.');
        lifecycle = 'Ended';
      }
      if (action === 'cancel') lifecycle = 'Cancelled';
      if (action === 'activate') {
        if (next.startsOn < c.today || next.endsOn <= c.today)
          invalid('A new block cannot start in the past.');
        lifecycle = next.startsOn > c.today ? 'Scheduled' : 'Active';
        scopeLocked = next.startsOn <= c.today;
      }
      if (state === 'Active') scopeLocked = true;
      if (['create', 'edit', 'activate'].includes(action)) {
        await this.targets(tx, tenantId, propertyId, next, c.bookingMode);
        if (action === 'edit' && next.endsOn <= c.today)
          invalid('End the block instead of moving its period into the past.');
      }
      const material =
        action === 'activate' ||
        (action === 'edit' &&
          ['Active', 'Scheduled'].includes(state) &&
          (next.startsOn !== current!.startsOn ||
            next.endsOn !== current!.endsOn ||
            next.all !== current!.all ||
            JSON.stringify(next.roomTypeIds) !== JSON.stringify(current!.roomTypeIds) ||
            JSON.stringify(next.roomIds) !== JSON.stringify(current!.roomIds)));
      if (material) {
        const conflicts = await this.conflicts(tx, tenantId, propertyId, next, id);
        if (conflicts.length)
          throw new ConflictException({
            code: 'BLOCK_CONFLICT',
            message:
              'Reservations, payment holds or other blocks overlap this period. No reservation was changed.',
            conflicts,
          });
      }
      const nextId = id ?? randomUUID();
      let response: unknown;
      if (action === 'delete') {
        await tx.$executeRaw`DELETE FROM availability_blocks WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${nextId}::uuid AND version=${v.version as number}`;
        response = { deleted: true, id: nextId };
      } else {
        if (action === 'create') {
          const year = Number(c.today.slice(0, 4));
          const seq = await tx.$queryRaw<
            Array<{ n: number }>
          >`INSERT INTO inventory_block_sequences(tenant_id,property_id,year,last_value) VALUES(${tenantId}::uuid,${propertyId}::uuid,${year},1) ON CONFLICT(tenant_id,property_id,year) DO UPDATE SET last_value=inventory_block_sequences.last_value+1 RETURNING last_value AS n`;
          const ref = `BLK-${year}-${String(seq[0].n).padStart(4, '0')}`;
          await tx.$executeRaw`INSERT INTO availability_blocks(id,tenant_id,property_id,title,starts_on,ends_on,blocks_all,reason,note,reference,responsible_staff_id,lifecycle,scope_locked,inventory_reference,created_by_user_id,updated_by_user_id) VALUES(${nextId}::uuid,${tenantId}::uuid,${propertyId}::uuid,${next.title},${next.startsOn}::date,${next.endsOn}::date,${next.all},${next.reason},${next.note},${next.reference},${next.responsibleStaffId}::uuid,${lifecycle},${scopeLocked},${ref},${actor}::uuid,${actor}::uuid)`;
        } else {
          const changed =
            await tx.$executeRaw`UPDATE availability_blocks SET title=${next.title},starts_on=${next.startsOn}::date,ends_on=${next.endsOn}::date,blocks_all=${next.all},reason=${next.reason},note=${next.note},reference=${next.reference},responsible_staff_id=${next.responsibleStaffId}::uuid,lifecycle=${lifecycle},scope_locked=${scopeLocked},end_reason=${endReason.trim() || current!.endReason},version=version+1,updated_by_user_id=${actor}::uuid,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${nextId}::uuid AND version=${v.version as number}`;
          if (changed !== 1) throw new ConflictException('Block version changed.');
        }
        if (action === 'create' || action === 'edit') {
          await tx.$executeRaw`DELETE FROM availability_block_room_types WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND block_id=${nextId}::uuid`;
          await tx.$executeRaw`DELETE FROM availability_block_rooms WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND block_id=${nextId}::uuid`;
          for (const target of next.roomTypeIds)
            await tx.$executeRaw`INSERT INTO availability_block_room_types(tenant_id,property_id,block_id,room_type_id) VALUES(${tenantId}::uuid,${propertyId}::uuid,${nextId}::uuid,${target}::uuid)`;
          for (const target of next.roomIds)
            await tx.$executeRaw`INSERT INTO availability_block_rooms(tenant_id,property_id,block_id,room_id) VALUES(${tenantId}::uuid,${propertyId}::uuid,${nextId}::uuid,${target}::uuid)`;
        }
        const saved = (await inventoryBlockRows(tx, tenantId, propertyId)).find(
          (b) => b.id === nextId,
        )!;
        response = { ...saved, lifecycle: blockLifecycle(saved, c.today) };
      }
      await this.audit.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId: actor,
        action: `inventory_block.${action}`,
        targetType: 'inventory_block',
        targetId: nextId,
        details: { before: current ?? null, after: response },
      });
      await tx.$executeRaw`INSERT INTO inventory_block_operations(tenant_id,property_id,idempotency_key,request_hash,response) VALUES(${tenantId}::uuid,${propertyId}::uuid,${key},${hash},${JSON.stringify(response)}::jsonb)`;
      return response;
    });
  }
}
