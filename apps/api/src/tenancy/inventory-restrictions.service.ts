import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  propertyClock,
  restrictionConflicts,
  restrictionLifecycle,
  validRuleDate,
  type BookingRestriction,
} from '../booking/booking-rules';
import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';
import { AuditLogService } from './audit-log.service';
import { restrictionRows, type RestrictionRecord } from './inventory-restrictions.repository';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const types = [
  'minimum_stay',
  'maximum_stay',
  'closed_to_arrival',
  'closed_to_departure',
  'stop_sell',
  'minimum_advance',
];
type RuleInput = Omit<BookingRestriction, 'id' | 'lifecycle'> & { internalReason: string };
function invalid(message: string): never {
  throw new BadRequestException({ code: 'RESTRICTION_INVALID', message });
}
export function restrictionInput(body: unknown): RuleInput {
  const v = (body ?? {}) as Record<string, unknown>;
  if (typeof v.name !== 'string' || !v.name.trim() || v.name.trim().length > 200)
    invalid('Name is required and must be at most 200 characters.');
  if (!types.includes(String(v.type))) invalid('Choose a supported restriction type.');
  if (
    !Number.isInteger(v.value) ||
    (v.value as number) > 2147483647 ||
    (v.value as number) < (['minimum_stay', 'maximum_stay'].includes(String(v.type)) ? 1 : 0) ||
    (['closed_to_arrival', 'closed_to_departure', 'stop_sell'].includes(String(v.type)) &&
      ![0, 1].includes(v.value as number))
  )
    invalid('Value must be a valid whole number; closures use 0 (open) or 1 (closed).');
  if (!['property', 'category', 'room_type'].includes(String(v.scope)))
    invalid('Choose property, category or room_type scope.');
  if (
    !Array.isArray(v.targetIds) ||
    v.targetIds.some((id) => typeof id !== 'string' || !uuid.test(id)) ||
    new Set(v.targetIds.map((id) => String(id).toLowerCase())).size !== v.targetIds.length ||
    (v.scope === 'property' ? v.targetIds.length !== 0 : v.targetIds.length === 0)
  )
    invalid('Choose unique targets for the selected scope; property scope has no target IDs.');
  if (v.targetIds.length > 500) invalid('Choose at most 500 targets.');
  if (typeof v.startsOn !== 'string' || !validRuleDate(v.startsOn) || v.startsOn.startsWith('0000'))
    invalid('Choose a valid start date.');
  const endsOn = v.endsOn === null || v.endsOn === undefined ? null : v.endsOn;
  if (
    endsOn !== null &&
    (typeof endsOn !== 'string' || !validRuleDate(endsOn) || endsOn < v.startsOn)
  )
    invalid('End date must be on or after start date.');
  const weekdays = v.weekdays === undefined ? [1, 2, 3, 4, 5, 6, 7] : v.weekdays;
  if (
    !Array.isArray(weekdays) ||
    !weekdays.length ||
    weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7) ||
    new Set(weekdays).size !== weekdays.length
  )
    invalid('Choose unique weekdays from Monday (1) to Sunday (7).');
  if (endsOn) {
    let occurs = false;
    const start = Date.parse(v.startsOn),
      end = Date.parse(endsOn as string);
    for (let i = 0; i < 7 && start + i * 86400000 <= end; i++)
      if (weekdays.includes(new Date(start + i * 86400000).getUTCDay() || 7)) occurs = true;
    if (!occurs) invalid('The selected weekdays do not occur within this period.');
  }
  const priority = v.priority ?? 50;
  if (!Number.isInteger(priority) || (priority as number) < 1 || (priority as number) > 100)
    invalid('Priority must be a whole number from 1 to 100.');
  const internalReason = v.internalReason ?? '';
  if (typeof internalReason !== 'string' || internalReason.trim().length > 4000)
    invalid('Internal reason must be text of at most 4,000 characters.');
  return {
    name: v.name.trim(),
    type: v.type as RuleInput['type'],
    value: v.value as number,
    scope: v.scope as RuleInput['scope'],
    targetIds: v.targetIds.map((id: string) => id.toLowerCase()).sort(),
    startsOn: v.startsOn,
    endsOn: endsOn as string | null,
    weekdays: [...weekdays].sort((a, b) => a - b),
    priority: priority as number,
    internalReason: internalReason.trim(),
  };
}

@Injectable()
export class InventoryRestrictionsService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}
  private async context(tx: TenantTransaction, tenantId: string, propertyId: string, lock = false) {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        timezone: string | null;
        minStayNights: number | null;
        maxStayNights: number | null;
        advanceBookingDays: number | null;
      }>
    >(
      Prisma.sql`SELECT id, timezone, min_stay_nights AS "minStayNights", max_stay_nights AS "maxStayNights", advance_booking_days AS "advanceBookingDays" FROM properties WHERE tenant_id = ${tenantId}::uuid AND id = ${propertyId}::uuid ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`,
    );
    if (!rows[0]) throw new NotFoundException('Property was not found.');
    const external = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT c.id FROM property_integration_connections pc JOIN integration_connections c ON c.tenant_id = pc.tenant_id AND c.id = pc.connection_id WHERE pc.tenant_id = ${tenantId}::uuid AND pc.property_id = ${propertyId}::uuid AND pc.enabled AND pc.kind = 'PMS' AND c.provider = 'CLOCK_PMS'`;
    return {
      ...rows[0],
      today: propertyClock(rows[0].timezone).date,
      source: external.length ? ('CLOCK_PMS' as const) : ('LOCAL' as const),
    };
  }
  async list(tenantId: string, propertyId: string) {
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const context = await this.context(tx, tenantId, propertyId);
      const records =
        context.source === 'LOCAL' ? await restrictionRows(tx, tenantId, propertyId) : [];
      const catalog = await this.catalog(tx, tenantId, propertyId);
      const categoryIds = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM room_categories WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid`;
      return {
        source: context.source,
        readOnly: context.source !== 'LOCAL',
        timezone: context.timezone ?? 'UTC',
        today: context.today,
        baseRestrictions:
          context.source === 'LOCAL'
            ? [
                ['minimum_stay', context.minStayNights],
                ['maximum_stay', context.maxStayNights],
                ['maximum_advance', context.advanceBookingDays],
              ]
                .filter((entry) => entry[1] !== null)
                .map(([type, value]) => ({
                  id: `base:${type}`,
                  type,
                  value,
                  scope: 'property',
                  priority: 0,
                  readOnly: true,
                  source: 'settings',
                }))
            : [],
        items: records.map((r) => ({
          ...r,
          lifecycle: restrictionLifecycle(r, context.today),
          conflicts: restrictionConflicts(r, records, catalog, context.today),
          validation: this.missingTargets(
            r,
            catalog,
            categoryIds.map((c) => c.id),
          )
            ? 'Missing targets'
            : restrictionConflicts(r, records, catalog, context.today).length
              ? 'Conflict'
              : 'Healthy',
        })),
        providerRestrictions: context.source === 'CLOCK_PMS' ? null : undefined,
      };
    });
  }
  async get(tenantId: string, propertyId: string, id: string) {
    id = this.requireId(id);
    const result = await this.list(tenantId, propertyId);
    const row = result.items.find((r) => r.id === id);
    if (!row) throw new NotFoundException('Restriction was not found.');
    return row;
  }
  async history(tenantId: string, propertyId: string, id: string) {
    id = this.requireId(id);
    return this.database.withTenantTransaction(
      { tenantId, propertyId },
      (tx) =>
        tx.$queryRaw`SELECT id, action, actor_user_id AS "actorUserId", details, created_at AS "createdAt" FROM audit_logs WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND target_type = 'inventory_restriction' AND target_id = ${id} ORDER BY created_at, id`,
    );
  }
  async validate(tenantId: string, propertyId: string, body: unknown) {
    const value = (body ?? {}) as Record<string, unknown>;
    const input = restrictionInput(value);
    const candidateId = value.id !== undefined ? this.requireId(String(value.id)) : '';
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const context = await this.context(tx, tenantId, propertyId);
      this.local(context.source);
      const catalog = await this.validateTargets(tx, tenantId, propertyId, input);
      const records = await restrictionRows(tx, tenantId, propertyId);
      const conflicts = restrictionConflicts(
        { ...input, id: candidateId, lifecycle: 'Active' },
        records,
        catalog,
        context.today,
      );
      const expired = Boolean(input.endsOn && input.endsOn < context.today);
      return {
        valid: !expired && !conflicts.length,
        conflicts,
        errors: expired
          ? [
              {
                code: 'RESTRICTION_EXPIRED',
                message: 'An expired restriction cannot be activated.',
              },
            ]
          : [],
      };
    });
  }
  async mutate(
    tenantId: string,
    propertyId: string,
    actor: string,
    key: string | undefined,
    action: 'create' | 'edit' | 'activate' | 'pause' | 'archive' | 'duplicate' | 'delete',
    id: string | undefined,
    body: unknown,
  ) {
    if (!key || !/^[\x21-\x7e]{1,128}$/.test(key))
      invalid('An Idempotency-Key of 1–128 printable characters is required.');
    if (id) id = this.requireId(id);
    const payload = (body ?? {}) as Record<string, unknown>;
    if (action === 'create' && payload.lifecycle !== undefined && payload.lifecycle !== 'Draft')
      invalid('Create a draft, then use the activate action.');
    if (action === 'edit' && payload.lifecycle !== undefined)
      invalid('Use lifecycle actions to change the restriction state.');
    const normalized = action === 'create' || action === 'edit' ? restrictionInput(payload) : null;
    if (
      action !== 'create' &&
      (!Number.isInteger(payload.version) || (payload.version as number) < 1)
    )
      invalid('A current positive version is required.');
    const hash = createHash('sha256')
      .update(
        JSON.stringify({ actor, action, id, input: normalized, version: payload.version ?? null }),
      )
      .digest('hex');
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const context = await this.context(tx, tenantId, propertyId, true);
      this.local(context.source);
      const receipts = await tx.$queryRaw<
        Array<{ requestHash: string; response: unknown }>
      >`SELECT request_hash AS "requestHash", response FROM inventory_restriction_operations WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND idempotency_key = ${key}`;
      if (receipts[0]) {
        if (receipts[0].requestHash !== hash)
          throw new ConflictException({
            code: 'IDEMPOTENCY_KEY_REUSED',
            message: 'This idempotency key was used for a different request.',
          });
        return receipts[0].response;
      }
      const records = await restrictionRows(tx, tenantId, propertyId);
      const current = id ? records.find((r) => r.id === id) : undefined;
      if (id && !current) throw new NotFoundException('Restriction was not found.');
      if (current && current.version !== payload.version)
        throw new ConflictException({
          code: 'RESTRICTION_VERSION_CONFLICT',
          message: 'The restriction changed. Reload it before saving.',
          currentVersion: current.version,
        });
      const lifecycle = current ? restrictionLifecycle(current, context.today) : 'Draft';
      if (current && lifecycle === 'Archived' && action !== 'duplicate')
        invalid('Archived restrictions are read-only. Duplicate one to create a draft.');
      if (action === 'delete' && lifecycle !== 'Draft')
        invalid('Only drafts can be deleted. Archive other restrictions.');
      if (action === 'pause' && !['Active', 'Scheduled'].includes(lifecycle))
        invalid('Only active or scheduled restrictions can be paused.');
      if (action === 'edit' && lifecycle === 'Expired')
        invalid('Expired restrictions are read-only. Duplicate one to create a draft.');
      let next = normalized ?? (current ? restrictionInput(current) : null);
      if (!next) invalid('Restriction fields are required.');
      const materialFields = [
        'type',
        'value',
        'scope',
        'targetIds',
        'startsOn',
        'endsOn',
        'weekdays',
        'priority',
      ] as const;
      const materialChanged =
        action === 'edit' &&
        materialFields.some(
          (field) => JSON.stringify(next![field]) !== JSON.stringify(current![field]),
        );
      const catalog =
        ['create', 'activate', 'duplicate'].includes(action) || materialChanged
          ? await this.validateTargets(tx, tenantId, propertyId, next)
          : await this.catalog(tx, tenantId, propertyId);
      const creates = action === 'create' || action === 'duplicate';
      const nextId = creates ? randomUUID() : id!;
      let state = creates ? 'Draft' : current!.lifecycle;
      if (action === 'activate') state = next.startsOn > context.today ? 'Scheduled' : 'Active';
      if (action === 'pause') state = 'Paused';
      if (action === 'archive') state = 'Archived';
      if (action === 'duplicate') next = { ...next, name: `${next.name.slice(0, 190)} (copy)` };
      if (['Active', 'Scheduled'].includes(state) && (action === 'activate' || materialChanged)) {
        if (next.endsOn && next.endsOn < context.today)
          invalid('An expired restriction cannot be activated.');
        const conflicts = restrictionConflicts(
          { ...next, id: nextId, lifecycle: 'Active' },
          records,
          catalog,
          context.today,
        );
        if (conflicts.length)
          throw new ConflictException({
            code: 'RESTRICTION_PRIORITY_CONFLICT',
            message:
              'Equal-priority restrictions conflict. Change their dates, scope, value or priority.',
            conflicts,
          });
      }
      let response: unknown;
      if (action === 'delete') {
        const deleted =
          await tx.$executeRaw`DELETE FROM inventory_restrictions WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${id}::uuid AND version = ${payload.version as number}`;
        if (deleted !== 1) throw new ConflictException('Restriction version changed.');
        response = { deleted: true, id };
      } else {
        let reference = current?.reference;
        if (creates) {
          const year = Number(context.today.slice(0, 4));
          const sequence = await tx.$queryRaw<
            Array<{ lastValue: number }>
          >`INSERT INTO inventory_restriction_sequences (tenant_id,property_id,year,last_value) VALUES (${tenantId}::uuid,${propertyId}::uuid,${year},1) ON CONFLICT (tenant_id,property_id,year) DO UPDATE SET last_value = inventory_restriction_sequences.last_value + 1 RETURNING last_value AS "lastValue"`;
          reference = `RST-${year}-${String(sequence[0].lastValue).padStart(4, '0')}`;
          await tx.$executeRaw`INSERT INTO inventory_restrictions (id,tenant_id,property_id,reference,name,type,value,scope,target_ids,starts_on,ends_on,weekdays,priority,lifecycle,internal_reason,created_by_user_id,updated_by_user_id) VALUES (${nextId}::uuid,${tenantId}::uuid,${propertyId}::uuid,${reference},${next.name},${next.type},${next.value},${next.scope},${next.targetIds}::uuid[],${next.startsOn}::date,${next.endsOn}::date,${next.weekdays}::int[],${next.priority},${state},${next.internalReason},${actor}::uuid,${actor}::uuid)`;
        } else {
          const changed =
            await tx.$executeRaw`UPDATE inventory_restrictions SET name=${next.name},type=${next.type},value=${next.value},scope=${next.scope},target_ids=${next.targetIds}::uuid[],starts_on=${next.startsOn}::date,ends_on=${next.endsOn}::date,weekdays=${next.weekdays}::int[],priority=${next.priority},lifecycle=${state},internal_reason=${next.internalReason},version=version+1,updated_by_user_id=${actor}::uuid,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${nextId}::uuid AND version=${payload.version as number}`;
          if (changed !== 1) throw new ConflictException('Restriction version changed.');
        }
        response = (await restrictionRows(tx, tenantId, propertyId)).find((r) => r.id === nextId)!;
        response = {
          ...(response as RestrictionRecord),
          lifecycle: restrictionLifecycle(response as RestrictionRecord, context.today),
        };
      }
      await this.audit.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId: actor,
        action: `inventory_restriction.${action}`,
        targetType: 'inventory_restriction',
        targetId: nextId,
        details: { before: current ?? null, after: response },
      });
      await tx.$executeRaw`INSERT INTO inventory_restriction_operations (tenant_id,property_id,idempotency_key,request_hash,response) VALUES (${tenantId}::uuid,${propertyId}::uuid,${key},${hash},${JSON.stringify(response)}::jsonb)`;
      return response;
    });
  }
  private requireId(id: string) {
    if (!uuid.test(id)) invalid('A valid restriction ID is required.');
    return id.toLowerCase();
  }
  private local(source: string) {
    if (source !== 'LOCAL')
      throw new ForbiddenException({
        code: 'EXTERNAL_RESTRICTIONS_READ_ONLY',
        message:
          'Clock restrictions are read-only. Local restriction changes are disabled for this property.',
      });
  }
  private catalog(tx: TenantTransaction, tenantId: string, propertyId: string) {
    return tx.$queryRaw<
      Array<{ id: string; categoryId: string | null }>
    >`SELECT id, category_id AS "categoryId" FROM room_types WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid`;
  }
  private missingTargets(
    rule: BookingRestriction,
    catalog: Array<{ id: string; categoryId: string | null }>,
    categoryIds: string[],
  ) {
    if (rule.scope === 'category') return rule.targetIds.some((id) => !categoryIds.includes(id));
    return (
      rule.scope === 'room_type' && rule.targetIds.some((id) => !catalog.some((t) => t.id === id))
    );
  }
  private async validateTargets(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    input: RuleInput,
  ) {
    const catalog = await this.catalog(tx, tenantId, propertyId);
    if (
      input.scope === 'room_type' &&
      input.targetIds.some((id) => !catalog.some((t) => t.id === id))
    )
      invalid('Every room type must belong to this property.');
    if (input.scope === 'category') {
      const categories = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM room_categories WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=ANY(${input.targetIds}::uuid[])`;
      if (categories.length !== input.targetIds.length)
        invalid('Every category must belong to this property.');
    }
    return catalog;
  }
}
