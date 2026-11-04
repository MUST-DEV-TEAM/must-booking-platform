import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AuditLogService } from './audit-log.service';
import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';
import {
  type DepositRule,
  depositDecimal,
  depositMinor,
  parseDepositRules,
  priceDeposit,
} from './venue-deposit-policy';
import { parseReservationCreate } from './venue-reservation-input';
import { isoWeekday } from './venue-reservation-logic';
import { loadVenuePlan, requireDining } from './venue-plan';

@Injectable()
export class VenueDepositRulesService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  async read(tx: TenantTransaction, tenantId: string, venueId: string) {
    const venues = await tx.$queryRaw<
      Array<{
        version: number;
        currency: string | null;
        legacyMode: string;
        legacyAmount: string;
        minParty: number;
        freeCancelHours: number;
      }>
    >`
      SELECT deposit_rules_version AS version,currency,deposit_mode AS "legacyMode",deposit_value::text AS "legacyAmount",
        deposit_min_party AS "minParty",free_cancel_hours AS "freeCancelHours"
      FROM venues WHERE tenant_id=${tenantId}::uuid AND id=${venueId}::uuid`;
    const venue = venues[0];
    if (!venue) throw new NotFoundException('Restaurant not found.');
    const rules = await tx.$queryRaw<
      DepositRule[]
    >`SELECT service_id AS "serviceId",area_id AS "areaId",mode,amount::text,
      min_party AS "minParty",free_cancel_hours AS "freeCancelHours" FROM venue_deposit_rules
      WHERE tenant_id=${tenantId}::uuid AND venue_id=${venueId}::uuid ORDER BY service_id NULLS FIRST,area_id NULLS FIRST`;
    if (venue.version === 0 && rules.length === 0 && venue.legacyMode === 'fixed')
      rules.push({
        serviceId: null,
        areaId: null,
        mode: 'per_booking',
        amount: venue.legacyAmount,
        minParty: venue.minParty,
        freeCancelHours: venue.freeCancelHours,
      });
    return {
      version: venue.version,
      currency: venue.currency ?? 'EUR',
      rules,
      requiresLegacyConversion: venue.version === 0 && venue.legacyMode === 'percent',
    };
  }
  list(tenantId: string, venueId: string) {
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      requireDining(await loadVenuePlan(tx, tenantId));
      return this.read(tx, tenantId, venueId);
    });
  }
  async quoteInTransaction(
    tx: TenantTransaction,
    tenantId: string,
    venueId: string,
    actorUserId: string | null,
    body: unknown,
  ) {
    const raw = body as Record<string, unknown>;
    const input = parseReservationCreate({ ...raw, guestName: 'Deposit quote' });
    const policy = await this.read(tx, tenantId, venueId);
    if (policy.requiresLegacyConversion)
      throw new ConflictException(
        'Convert the percentage deposit to fixed rates before taking bookings.',
      );
    const scope = await tx.$queryRaw<
      Array<{
        serviceId: string;
        serviceName: string;
        areaId: string;
        areaName: string;
        holdMinutes: number;
        diningMinutes: number;
      }>
    >`
      SELECT s.id AS "serviceId",s.name AS "serviceName",a.id AS "areaId",a.name AS "areaName",v.hold_minutes AS "holdMinutes",v.dining_minutes AS "diningMinutes"
      FROM venues v JOIN venue_services s ON s.tenant_id=v.tenant_id AND s.venue_id=v.id
      JOIN venue_tables t ON t.tenant_id=v.tenant_id AND t.venue_id=v.id AND t.id=${input.tableId}::uuid
      JOIN venue_areas a ON a.tenant_id=t.tenant_id AND a.venue_id=t.venue_id AND a.id=t.area_id
      WHERE v.tenant_id=${tenantId}::uuid AND v.id=${venueId}::uuid AND ${isoWeekday(input.date)}::smallint=ANY(s.days)
        AND ${input.time}::time>=s.opens_at AND ${input.time}::time<s.closes_at AND t.active AND a.active`;
    const selected = scope[0];
    if (!selected)
      throw new BadRequestException('Choose a table and an open service to quote the deposit.');
    const permissions = await tx.$queryRaw<
      Array<{ allowed: boolean }>
    >`SELECT EXISTS(SELECT 1 FROM tenant_memberships m WHERE m.tenant_id=${tenantId}::uuid AND m.user_id=${actorUserId}::uuid
      AND (m.role::text IN ('OWNER','ADMIN') OR EXISTS(SELECT 1 FROM venue_staff_assignments a WHERE a.tenant_id=m.tenant_id AND a.user_id=m.user_id AND a.venue_id=${venueId}::uuid AND a.role='MANAGER' AND a.suspended_at IS NULL))) AS allowed`;
    const canOverride = permissions[0]?.allowed === true;
    const price = priceDeposit(policy.rules, selected.serviceId, selected.areaId, input.partySize);
    let amount = price.total;
    let overrideReason: string | null = null;
    if (raw.depositAmount !== undefined && raw.depositAmount !== price.total) {
      if (!canOverride)
        throw new ForbiddenException('Only a restaurant manager can change the deposit.');
      if (typeof raw.depositAmount !== 'string')
        throw new BadRequestException('Deposit amount must be decimal text.');
      amount = depositDecimal(depositMinor(raw.depositAmount));
      overrideReason =
        typeof raw.depositOverrideReason === 'string' ? raw.depositOverrideReason.trim() : '';
      if (overrideReason.length < 3 || overrideReason.length > 500)
        throw new BadRequestException('Give a reason for changing the deposit (3–500 characters).');
    }
    const terms = {
      version: policy.version,
      currency: policy.currency,
      ...selected,
      date: input.date,
      time: input.time,
      tableId: input.tableId,
      durationMinutes: input.durationMinutes ?? selected.diningMinutes,
      partySize: input.partySize,
      mode: price.mode,
      unitAmount: price.amount,
      suggestedAmount: price.total,
      minParty: price.minParty,
      amount,
      freeCancelHours: price.freeCancelHours,
      overrideReason,
      overrideBy: overrideReason ? actorUserId : null,
    };
    const quoteHash = createHash('sha256').update(JSON.stringify(terms)).digest('hex');
    return { ...terms, quoteHash, canOverride };
  }
  quote(tenantId: string, venueId: string, actorUserId: string, body: unknown) {
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      requireDining(await loadVenuePlan(tx, tenantId));
      return this.quoteInTransaction(tx, tenantId, venueId, actorUserId, body);
    });
  }
  save(tenantId: string, venueId: string, actorUserId: string, body: unknown) {
    const input = parseDepositRules(body);
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      requireDining(await loadVenuePlan(tx, tenantId));
      await tx.$queryRaw`SELECT id FROM venues WHERE tenant_id=${tenantId}::uuid AND id=${venueId}::uuid FOR UPDATE`;
      const before = await this.read(tx, tenantId, venueId);
      // Repeat saves are harmless, including after the client lost the first response.
      const canonical = (rules: DepositRule[]) =>
        JSON.stringify(
          [...rules].sort((a, b) =>
            `${a.serviceId}:${a.areaId}`.localeCompare(`${b.serviceId}:${b.areaId}`),
          ),
        );
      if (!before.requiresLegacyConversion && canonical(before.rules) === canonical(input.rules))
        return before;
      if (before.version !== input.version)
        throw new ConflictException('Deposit rules changed. Reload before saving.');
      for (const rule of input.rules) {
        const valid = await tx.$queryRaw<Array<{ valid: boolean }>>`SELECT
          (${rule.serviceId}::uuid IS NULL OR EXISTS(SELECT 1 FROM venue_services WHERE tenant_id=${tenantId}::uuid AND venue_id=${venueId}::uuid AND id=${rule.serviceId}::uuid))
          AND (${rule.areaId}::uuid IS NULL OR EXISTS(SELECT 1 FROM venue_areas WHERE tenant_id=${tenantId}::uuid AND venue_id=${venueId}::uuid AND id=${rule.areaId}::uuid)) AS valid`;
        if (!valid[0]?.valid)
          throw new BadRequestException('The service or area does not belong to this restaurant.');
      }
      await tx.$executeRaw`DELETE FROM venue_deposit_rules WHERE tenant_id=${tenantId}::uuid AND venue_id=${venueId}::uuid`;
      for (const rule of input.rules)
        await tx.$executeRaw`INSERT INTO venue_deposit_rules
        (tenant_id,venue_id,service_id,area_id,mode,amount,min_party,free_cancel_hours)
        VALUES (${tenantId}::uuid,${venueId}::uuid,${rule.serviceId}::uuid,${rule.areaId}::uuid,${rule.mode},${rule.amount}::numeric,${rule.minParty},${rule.freeCancelHours})`;
      await tx.$executeRaw`UPDATE venues SET deposit_rules_version=deposit_rules_version+1 WHERE tenant_id=${tenantId}::uuid AND id=${venueId}::uuid`;
      await this.audit.recordInTransaction(tx, {
        tenantId,
        actorUserId,
        action: 'venue.deposit_rules_changed',
        targetType: 'venue',
        targetId: venueId,
        details: { rules: input.rules.length },
      });
      return this.read(tx, tenantId, venueId);
    });
  }
}
