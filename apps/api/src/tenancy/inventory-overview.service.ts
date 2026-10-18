import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { validRuleDate } from '../booking/booking-rules';
import { TenantDatabaseService } from './tenant-database.service';
import { InventoryRestrictionsService } from './inventory-restrictions.service';
import { InventoryBlocksService } from './inventory-blocks.service';
import { AvailabilityService } from './availability.service';
const add = (day: string, n: number) =>
  new Date(Date.parse(day) + n * 86400000).toISOString().slice(0, 10);
/** Read-only Inventory projections. Preview delegates to the existing search/calendar evaluator. */
@Injectable()
export class InventoryOverviewService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(InventoryRestrictionsService)
    private readonly restrictions: InventoryRestrictionsService,
    @Inject(InventoryBlocksService) private readonly blocks: InventoryBlocksService,
    @Inject(AvailabilityService) private readonly availability: AvailabilityService,
  ) {}
  async preview(tenantId: string, propertyId: string, body: unknown) {
    const v = (body ?? {}) as Record<string, unknown>;
    if (
      typeof v.roomTypeId !== 'string' ||
      !v.roomTypeId ||
      typeof v.startsOn !== 'string' ||
      !validRuleDate(v.startsOn) ||
      typeof v.endsOn !== 'string' ||
      !validRuleDate(v.endsOn) ||
      v.endsOn <= v.startsOn
    )
      throw new BadRequestException('Choose a room type and valid arrival/departure dates.');
    return {
      channel: v.channel ?? 'staff',
      scope: 'saved_rules',
      ...(await this.availability.evaluateRules(tenantId, propertyId, v)),
    };
  }
  async overview(tenantId: string, propertyId: string) {
    const rules = await this.restrictions.list(tenantId, propertyId),
      blocks = await this.blocks.list(tenantId, propertyId);
    const today = rules.today,
      end = add(today, 30);
    const countsByType: Record<string, number> = {};
    for (const r of rules.items)
      if (r.lifecycle === 'Active') countsByType[r.type] = (countsByType[r.type] ?? 0) + 1;
    const needsAttention = [
      ...rules.items
        .filter((r) => r.validation !== 'Healthy')
        .map((r) => ({ id: r.id, kind: 'restriction', name: r.name, reason: r.validation })),
      ...rules.items
        .filter(
          (r) =>
            ['Active', 'Scheduled'].includes(r.lifecycle) &&
            r.endsOn &&
            r.endsOn >= today &&
            r.endsOn <= add(today, 7),
        )
        .map((r) => ({ id: r.id, kind: 'restriction', name: r.name, reason: 'Ending soon' })),
      ...blocks.items
        .filter((b) => b.validation !== 'Healthy' || b.endingSoon)
        .map((b) => ({
          id: b.id,
          kind: 'block',
          name: b.title,
          reason: b.validation !== 'Healthy' ? b.validation : 'Ending soon',
        })),
    ];
    const base = {
      source: rules.source,
      readOnly: rules.readOnly,
      timezone: rules.timezone,
      today,
      endsOn: end,
      countsByType,
      activeRestrictions:
        rules.source === 'LOCAL'
          ? rules.items.filter((r) => r.lifecycle === 'Active').length
          : null,
      activeBlocks:
        rules.source === 'LOCAL'
          ? blocks.items.filter((b) => b.lifecycle === 'Active').length
          : null,
      needsAttention,
      providerHealth: null,
      conflictReviewAvailable: false,
    };
    if (rules.source !== 'LOCAL')
      return {
        ...base,
        sellableNights: null,
        totalNights: null,
        sellablePercentage: null,
        coverage: null,
      };
    const catalog = await this.database.withTenantTransaction(
      { tenantId, propertyId },
      async (tx) => {
        const properties = await tx.$queryRaw<
          Array<{ bookingMode: string }>
        >`SELECT booking_mode::text AS "bookingMode" FROM properties WHERE tenant_id=${tenantId}::uuid AND id=${propertyId}::uuid`;
        if (!properties[0]) throw new NotFoundException('Property not found.');
        const types = await tx.$queryRaw<
          Array<{ id: string; name: string }>
        >`SELECT id,name FROM room_types WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND status='PUBLISHED' ORDER BY name,id`;
        const rooms = await tx.$queryRaw<
          Array<{ id: string; roomTypeId: string }>
        >`SELECT id,room_type_id AS "roomTypeId" FROM rooms WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND is_active ORDER BY id`;
        const pool = await tx.$queryRaw<
          Array<{ roomTypeId: string; date: string; capacity: number; available: number }>
        >`SELECT room_type_id AS "roomTypeId",stays_on::text AS date,available_units AS capacity,GREATEST(available_units-booked_units,0)::int AS available FROM inventory_units WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND stays_on>=${today}::date AND stays_on<${end}::date`;
        return { ...properties[0], types, rooms, pool };
      },
    );
    const dates = Array.from({ length: 30 }, (_, i) => add(today, i)),
      months = [...new Set(dates.map((d) => d.slice(0, 7)))];
    const coverage: Array<{
      roomTypeId: string;
      name: string;
      days: Array<{
        date: string;
        capacity: number;
        available: number;
        restrictionErrors: Array<{ code: string; message: string }>;
      }>;
    }> = [];
    for (const type of catalog.types) {
      const physical = catalog.rooms.filter((r) => r.roomTypeId === type.id);
      const calendars = new Map<
        string,
        Map<
          string,
          { isAvailable: boolean; restrictionErrors?: Array<{ code: string; message: string }> }
        >
      >();
      const targets = catalog.bookingMode === 'ROOM_TYPE_ONLY' ? [null] : physical;
      for (const target of targets) {
        const days = [];
        for (const month of months) {
          const calendar = await this.availability.getCalendar(tenantId, propertyId, {
            roomTypeId: type.id,
            ...(target ? { roomId: target.id } : {}),
            month,
          });
          days.push(...calendar.days);
        }
        calendars.set(target?.id ?? 'pool', new Map(days.map((d) => [d.date, d])));
      }
      const days = dates.map((date) => {
        const pool = catalog.pool.find((p) => p.roomTypeId === type.id && p.date === date);
        const physicalFree = physical.filter(
          (r) => calendars.get(r.id)?.get(date)?.isAvailable,
        ).length;
        const capacity =
          catalog.bookingMode === 'ROOM_TYPE_ONLY'
            ? (pool?.capacity ?? 0)
            : catalog.bookingMode === 'MIXED'
              ? Math.min(physical.length, pool?.capacity ?? 0)
              : physical.length;
        const available =
          catalog.bookingMode === 'ROOM_TYPE_ONLY'
            ? calendars.get('pool')?.get(date)?.isAvailable
              ? (pool?.available ?? 0)
              : 0
            : catalog.bookingMode === 'MIXED'
              ? Math.min(physicalFree, pool?.available ?? 0)
              : physicalFree;
        const restrictionErrors = [...calendars.values()]
          .flatMap((c) => c.get(date)?.restrictionErrors ?? [])
          .filter((error, i, all) => all.findIndex((e) => e.code === error.code) === i);
        return { date, capacity, available: Math.min(capacity, available), restrictionErrors };
      });
      coverage.push({ roomTypeId: type.id, name: type.name, days });
    }
    const totalNights = coverage.reduce(
        (sum, t) => sum + t.days.reduce((n, d) => n + d.capacity, 0),
        0,
      ),
      sellableNights = coverage.reduce(
        (sum, t) => sum + t.days.reduce((n, d) => n + d.available, 0),
        0,
      );
    return {
      ...base,
      totalNights,
      sellableNights,
      sellablePercentage: totalNights ? Math.round((sellableNights / totalNights) * 100) : null,
      coverage,
    };
  }
  async conflicts(tenantId: string, propertyId: string) {
    const rules = await this.restrictions.list(tenantId, propertyId);
    return {
      source: rules.source,
      readOnly: true,
      available: false,
      items: null,
      reason:
        rules.source === 'LOCAL'
          ? 'Provider conflict review applies only to external-PMS properties.'
          : 'Provider availability mismatch records are not available. No provider state is inferred from local records.',
    };
  }
}
