import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { AuditLogService } from './audit-log.service';
import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';

type RatePlan = {
  id: string;
  name: string;
  currency: string;
  isActive: boolean;
  freeCancellationUntilHours: number | null;
};
type RateRule = {
  id: string;
  roomTypeId: string;
  startsOn: Date | null;
  endsOn: Date | null;
  weekdays: number[];
  amount: string;
};
type RoomPriceOverride = {
  roomId: string;
  amount: string;
};

type RatePlanInput = {
  name: string;
  currency: string;
  isActive: boolean;
  freeCancellationUntilHours: number | null;
};
type RateRuleInput = {
  roomTypeId: string;
  startsOn: string | null;
  endsOn: string | null;
  weekdays: number[];
  amount: string;
};

@Injectable()
export class RatePlansService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  list(tenantId: string, propertyId: string): Promise<RatePlan[]> {
    return this.database.withTenantTransaction(
      { tenantId, propertyId },
      (tx) =>
        tx.$queryRaw<RatePlan[]>`
        SELECT id, name, currency, is_active AS "isActive",
          free_cancellation_until_hours AS "freeCancellationUntilHours"
        FROM rate_plans
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
          AND clock_shadow_room_type_id IS NULL
        ORDER BY created_at
      `,
    );
  }

  async create(
    tenantId: string,
    propertyId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<RatePlan> {
    const input = this.ratePlanInput(body);
    const id = randomUUID();
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      try {
        const rows = await tx.$queryRaw<RatePlan[]>`
          INSERT INTO rate_plans (
            id, tenant_id, property_id, name, currency, is_active, free_cancellation_until_hours
          ) VALUES (
            ${id}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, ${input.name}, ${input.currency},
            ${input.isActive}, ${input.freeCancellationUntilHours}
          )
          RETURNING id, name, currency, is_active AS "isActive",
            free_cancellation_until_hours AS "freeCancellationUntilHours"
        `;
        await this.record(
          tx,
          tenantId,
          propertyId,
          actorUserId,
          'rate_plan.created',
          'rate_plan',
          id,
        );
        return rows[0];
      } catch (error: unknown) {
        this.rethrowRatePlanConflict(error);
      }
    });
  }

  async update(
    tenantId: string,
    propertyId: string,
    ratePlanId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<RatePlan> {
    const input = this.ratePlanInput(body);
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      try {
        const rows = await tx.$queryRaw<RatePlan[]>`
          UPDATE rate_plans
          SET name = ${input.name}, currency = ${input.currency}, is_active = ${input.isActive},
            free_cancellation_until_hours = ${input.freeCancellationUntilHours}, updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${ratePlanId}::uuid
          RETURNING id, name, currency, is_active AS "isActive",
            free_cancellation_until_hours AS "freeCancellationUntilHours"
        `;
        if (!rows[0]) throw new NotFoundException('Rate plan not found.');
        await this.record(
          tx,
          tenantId,
          propertyId,
          actorUserId,
          'rate_plan.updated',
          'rate_plan',
          ratePlanId,
        );
        return rows[0];
      } catch (error: unknown) {
        this.rethrowRatePlanConflict(error);
      }
    });
  }

  async remove(
    tenantId: string,
    propertyId: string,
    ratePlanId: string,
    actorUserId: string,
  ): Promise<void> {
    await this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      try {
        const rows = await tx.$queryRaw<Array<{ id: string }>>`
          DELETE FROM rate_plans
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${ratePlanId}::uuid
          RETURNING id
        `;
        if (!rows[0]) throw new NotFoundException('Rate plan not found.');
        await this.record(
          tx,
          tenantId,
          propertyId,
          actorUserId,
          'rate_plan.deleted',
          'rate_plan',
          ratePlanId,
        );
      } catch (error: unknown) {
        if (this.isForeignKeyViolation(error))
          throw new ConflictException(
            'Cannot delete a rate plan that still has rate rules or room price overrides.',
          );
        throw error;
      }
    });
  }

  async listRoomPriceOverrides(
    tenantId: string,
    propertyId: string,
    ratePlanId: string,
  ): Promise<RoomPriceOverride[]> {
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await this.requireRatePlan(tx, tenantId, propertyId, ratePlanId);
      return tx.$queryRaw<RoomPriceOverride[]>`
        SELECT room_id AS "roomId", amount::text AS amount
        FROM room_price_overrides
        WHERE tenant_id = ${tenantId}::uuid
          AND property_id = ${propertyId}::uuid
          AND rate_plan_id = ${ratePlanId}::uuid
        ORDER BY room_id
      `;
    });
  }

  async setRoomPriceOverride(
    tenantId: string,
    propertyId: string,
    ratePlanId: string,
    roomId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<RoomPriceOverride> {
    const amount = this.priceOverrideAmount(body);
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await this.requireRatePlan(tx, tenantId, propertyId, ratePlanId);
      await this.requireRoom(tx, tenantId, propertyId, roomId);
      const rows = await tx.$queryRaw<RoomPriceOverride[]>`
        INSERT INTO room_price_overrides (tenant_id, property_id, rate_plan_id, room_id, amount)
        VALUES (
          ${tenantId}::uuid, ${propertyId}::uuid, ${ratePlanId}::uuid, ${roomId}::uuid,
          ${amount}::numeric
        )
        ON CONFLICT (tenant_id, property_id, rate_plan_id, room_id)
        DO UPDATE SET amount = EXCLUDED.amount, updated_at = CURRENT_TIMESTAMP
        RETURNING room_id AS "roomId", amount::text AS amount
      `;
      await this.record(
        tx,
        tenantId,
        propertyId,
        actorUserId,
        'room_price_override.set',
        'room_price_override',
        `${ratePlanId}:${roomId}`,
      );
      return rows[0]!;
    });
  }

  async removeRoomPriceOverride(
    tenantId: string,
    propertyId: string,
    ratePlanId: string,
    roomId: string,
    actorUserId: string,
  ): Promise<void> {
    await this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ roomId: string }>>`
        DELETE FROM room_price_overrides
        WHERE tenant_id = ${tenantId}::uuid
          AND property_id = ${propertyId}::uuid
          AND rate_plan_id = ${ratePlanId}::uuid
          AND room_id = ${roomId}::uuid
        RETURNING room_id AS "roomId"
      `;
      if (!rows[0]) throw new NotFoundException('Room price override not found.');
      await this.record(
        tx,
        tenantId,
        propertyId,
        actorUserId,
        'room_price_override.deleted',
        'room_price_override',
        `${ratePlanId}:${roomId}`,
      );
    });
  }

  async listRules(tenantId: string, propertyId: string, ratePlanId: string): Promise<RateRule[]> {
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await this.requireRatePlan(tx, tenantId, propertyId, ratePlanId);
      return tx.$queryRaw<RateRule[]>`
        SELECT id, room_type_id AS "roomTypeId", starts_on AS "startsOn", ends_on AS "endsOn", weekdays, amount::text AS amount
        FROM rate_rules
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND rate_plan_id = ${ratePlanId}::uuid
        ORDER BY starts_on, created_at
      `;
    });
  }

  async createRule(
    tenantId: string,
    propertyId: string,
    ratePlanId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<RateRule> {
    const input = this.rateRuleInput(body);
    const id = randomUUID();
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await this.requireRatePlan(tx, tenantId, propertyId, ratePlanId);
      await this.requireRoomType(tx, tenantId, propertyId, input.roomTypeId);
      await this.rejectOverlap(tx, tenantId, propertyId, ratePlanId, input);
      try {
        const rows = await tx.$queryRaw<RateRule[]>`
          INSERT INTO rate_rules (id, tenant_id, property_id, rate_plan_id, room_type_id, starts_on, ends_on, weekdays, amount)
          VALUES (${id}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, ${ratePlanId}::uuid, ${input.roomTypeId}::uuid, ${input.startsOn}::date, ${input.endsOn}::date, ${input.weekdays}, ${input.amount}::numeric)
          RETURNING id, room_type_id AS "roomTypeId", starts_on AS "startsOn", ends_on AS "endsOn", weekdays, amount::text AS amount
        `;
        await this.record(
          tx,
          tenantId,
          propertyId,
          actorUserId,
          'rate_rule.created',
          'rate_rule',
          id,
        );
        return rows[0];
      } catch (error: unknown) {
        this.rethrowRateRuleConflict(error);
      }
    });
  }

  async updateRule(
    tenantId: string,
    propertyId: string,
    ratePlanId: string,
    rateRuleId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<RateRule> {
    const input = this.rateRuleInput(body);
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await this.requireRatePlan(tx, tenantId, propertyId, ratePlanId);
      await this.requireRoomType(tx, tenantId, propertyId, input.roomTypeId);
      const existing = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM rate_rules
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND rate_plan_id = ${ratePlanId}::uuid AND id = ${rateRuleId}::uuid
      `;
      if (!existing[0]) throw new NotFoundException('Rate rule not found.');
      await this.rejectOverlap(tx, tenantId, propertyId, ratePlanId, input, rateRuleId);
      try {
        const rows = await tx.$queryRaw<RateRule[]>`
          UPDATE rate_rules
          SET room_type_id = ${input.roomTypeId}::uuid, starts_on = ${input.startsOn}::date, ends_on = ${input.endsOn}::date, weekdays = ${input.weekdays}, amount = ${input.amount}::numeric, updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND rate_plan_id = ${ratePlanId}::uuid AND id = ${rateRuleId}::uuid
          RETURNING id, room_type_id AS "roomTypeId", starts_on AS "startsOn", ends_on AS "endsOn", weekdays, amount::text AS amount
        `;
        await this.record(
          tx,
          tenantId,
          propertyId,
          actorUserId,
          'rate_rule.updated',
          'rate_rule',
          rateRuleId,
        );
        return rows[0];
      } catch (error: unknown) {
        this.rethrowRateRuleConflict(error);
      }
    });
  }

  async removeRule(
    tenantId: string,
    propertyId: string,
    ratePlanId: string,
    rateRuleId: string,
    actorUserId: string,
  ): Promise<void> {
    await this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        DELETE FROM rate_rules
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND rate_plan_id = ${ratePlanId}::uuid AND id = ${rateRuleId}::uuid
        RETURNING id
      `;
      if (!rows[0]) throw new NotFoundException('Rate rule not found.');
      await this.record(
        tx,
        tenantId,
        propertyId,
        actorUserId,
        'rate_rule.deleted',
        'rate_rule',
        rateRuleId,
      );
    });
  }

  private async requireRatePlan(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    ratePlanId: string,
  ) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM rate_plans
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${ratePlanId}::uuid
    `;
    if (!rows[0]) throw new NotFoundException('Rate plan not found.');
  }

  private async requireRoomType(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    roomTypeId: string,
  ) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM room_types
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${roomTypeId}::uuid
    `;
    if (!rows[0]) throw new NotFoundException('Room type not found.');
  }

  private async requireRoom(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    roomId: string,
  ) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM rooms
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${roomId}::uuid
    `;
    if (!rows[0]) throw new NotFoundException('Room not found.');
  }

  private async rejectOverlap(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    ratePlanId: string,
    input: RateRuleInput,
    excludedRuleId?: string,
  ) {
    if (input.startsOn === null) return;
    const overlapKey = `${tenantId}:${propertyId}:${ratePlanId}:${input.roomTypeId}`;
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${overlapKey}, 0))
    `;
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM rate_rules
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        AND rate_plan_id = ${ratePlanId}::uuid AND room_type_id = ${input.roomTypeId}::uuid
        AND starts_on IS NOT NULL AND ends_on IS NOT NULL
        AND starts_on <= ${input.endsOn}::date AND ends_on >= ${input.startsOn}::date
        AND weekdays && ${input.weekdays}::smallint[]
        AND (${excludedRuleId ?? null}::uuid IS NULL OR id <> ${excludedRuleId ?? null}::uuid)
      LIMIT 1
    `;
    if (rows[0])
      throw new ConflictException('Rate rule overlaps an existing rule for this room type.');
  }

  private ratePlanInput(body: unknown): RatePlanInput {
    const value = (body ?? {}) as Record<string, unknown>;
    const name = typeof value.name === 'string' ? value.name.trim() : '';
    const currency = typeof value.currency === 'string' ? value.currency.trim().toUpperCase() : '';
    const isActive = typeof value.isActive === 'boolean' ? value.isActive : true;
    const rawFreeCancellationUntilHours = value.freeCancellationUntilHours;
    if (!name) throw new BadRequestException('name is required.');
    if (name.length > 200) throw new BadRequestException('name must be at most 200 characters.');
    if (!/^[A-Z]{3}$/.test(currency))
      throw new BadRequestException('currency must be a three-letter ISO code.');
    if (
      rawFreeCancellationUntilHours !== undefined &&
      rawFreeCancellationUntilHours !== null &&
      (typeof rawFreeCancellationUntilHours !== 'number' ||
        !Number.isInteger(rawFreeCancellationUntilHours) ||
        rawFreeCancellationUntilHours < 0)
    )
      throw new BadRequestException(
        'freeCancellationUntilHours must be a non-negative integer or null.',
      );
    return {
      name,
      currency,
      isActive,
      freeCancellationUntilHours:
        typeof rawFreeCancellationUntilHours === 'number' ? rawFreeCancellationUntilHours : null,
    };
  }

  private rateRuleInput(body: unknown): RateRuleInput {
    const value = (body ?? {}) as Record<string, unknown>;
    const roomTypeId = typeof value.roomTypeId === 'string' ? value.roomTypeId : '';
    const startsOn = this.nullableDate(value.startsOn, 'startsOn');
    const endsOn = this.nullableDate(value.endsOn, 'endsOn');
    const weekdays = value.weekdays === undefined ? [0, 1, 2, 3, 4, 5, 6] : value.weekdays;
    const amount = typeof value.amount === 'string' ? value.amount : '';
    if (!roomTypeId) throw new BadRequestException('roomTypeId is required.');
    if ((startsOn === null) !== (endsOn === null))
      throw new BadRequestException('startsOn and endsOn must either both be set or both be null.');
    if (startsOn !== null && endsOn !== null && endsOn < startsOn)
      throw new BadRequestException('endsOn must be on or after startsOn.');
    if (
      !Array.isArray(weekdays) ||
      weekdays.length === 0 ||
      !weekdays.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    )
      throw new BadRequestException(
        'weekdays must contain one or more unique values from 0 through 6.',
      );
    const distinctWeekdays = [...new Set(weekdays as number[])];
    if (distinctWeekdays.length !== weekdays.length)
      throw new BadRequestException('weekdays must not contain duplicates.');
    if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(amount))
      throw new BadRequestException(
        'amount must be a non-negative decimal string with at most two decimal places.',
      );
    if (startsOn === null && distinctWeekdays.length !== 7)
      throw new BadRequestException('A base rate must apply on all seven weekdays.');
    return { roomTypeId, startsOn, endsOn, weekdays: distinctWeekdays, amount };
  }

  private priceOverrideAmount(body: unknown): string {
    const value = (body ?? {}) as Record<string, unknown>;
    const amount = typeof value.amount === 'string' ? value.amount : '';
    if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(amount))
      throw new BadRequestException(
        'amount must be a non-negative decimal string with at most two decimal places.',
      );
    return amount;
  }

  private nullableDate(value: unknown, field: string): string | null {
    if (value === null) return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
      throw new BadRequestException(`${field} must be an ISO date (YYYY-MM-DD).`);
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value)
      throw new BadRequestException(`${field} must be an ISO date (YYYY-MM-DD).`);
    return value;
  }

  private async record(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    actorUserId: string,
    action: string,
    targetType: string,
    targetId: string,
  ) {
    await this.audit.recordInTransaction(tx, {
      tenantId,
      propertyId,
      actorUserId,
      action,
      targetType,
      targetId,
    });
  }

  private rethrowRatePlanConflict(error: unknown): never {
    if (this.isUniqueViolation(error))
      throw new ConflictException('A rate plan with this name already exists for this property.');
    throw error;
  }

  private rethrowRateRuleConflict(error: unknown): never {
    if (this.isUniqueViolation(error))
      throw new ConflictException('A base rate already exists for this room type.');
    throw error;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2010' &&
      (error as { meta?: { code?: string } }).meta?.code === '23505'
    );
  }

  private isForeignKeyViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2010' &&
      (error as { meta?: { code?: string } }).meta?.code === '23503'
    );
  }
}
