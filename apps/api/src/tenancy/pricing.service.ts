import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';
import {
  PricingWrites,
  pricingInvalid,
  pricingVersion,
  pricingHash,
  type PricingTable,
} from './pricing-writes.service';
import { pricingContext, pricingFacts } from './pricing.repository';
import {
  pricingPlanInput,
  adjustmentInput,
  chargeInput,
  adjustmentConflicts,
  pricingId,
  pricingObject,
  date,
  integer,
  ids,
  amount,
  weekdays,
  text,
} from './pricing-input';
import {
  evaluatePricing,
  resolveBasePrice,
  pricingDay,
  pricingNights,
  type PricingFacts,
  type PricingPlan,
  type Adjustment,
  type Charge,
} from '../booking/pricing-evaluator';
import { pricingHealth } from './pricing-health';
import { ClockAvailabilityService } from '../integrations/clock/clock-availability.service';
const tables = {
  plans: 'rate_plans',
  rules: 'pricing_adjustments',
  charges: 'pricing_charges',
} as const;
export type PricingKind = keyof typeof tables;
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
const sqlValue = (key: string, v: unknown): Prisma.Sql => {
  if (['roomTypeIds', 'ratePlanIds'].includes(key)) return Prisma.sql`${v as string[]}::uuid[]`;
  if (key === 'channels') return Prisma.sql`${v as string[]}::text[]`;
  if (key === 'weekdays') return Prisma.sql`${v as number[]}::smallint[]`;
  if (key.endsWith('On')) return Prisma.sql`${v as string | null}::date`;
  if (key === 'basePlanId') return Prisma.sql`${v as string | null}::uuid`;
  if (['value', 'adjustmentValue'].includes(key)) return Prisma.sql`${v as string}::numeric`;
  return Prisma.sql`${v as string | number | boolean | null}`;
};

@Injectable()
export class PricingService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(PricingWrites) private readonly writes: PricingWrites,
    @Inject(ClockAvailabilityService) private readonly clock: ClockAvailabilityService,
  ) {}
  private async catalog(tx: TenantTransaction, tenantId: string, propertyId: string) {
    return tx.$queryRaw<
      Array<{ id: string; name: string; status: string }>
    >`SELECT id,name,status::text FROM room_types WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid ORDER BY name,id`;
  }
  private async targets(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    input: { roomTypeIds: string[]; ratePlanIds?: string[] },
  ) {
    const types = await this.catalog(tx, tenantId, propertyId);
    if (input.roomTypeIds.some((id) => !types.some((t) => t.id === id)))
      throw new NotFoundException('Room type not found in this property.');
    if (input.ratePlanIds?.length) {
      const plans = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM rate_plans WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND clock_shadow_room_type_id IS NULL AND id=ANY(${input.ratePlanIds}::uuid[])`;
      if (plans.length !== input.ratePlanIds.length)
        throw new NotFoundException('Rate plan not found in this property.');
    }
    return types;
  }
  private collection(f: PricingFacts, kind: PricingKind) {
    return kind === 'plans' ? f.plans : kind === 'rules' ? f.rules : f.charges;
  }
  private async save(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    table: PricingTable,
    id: string,
    input: Record<string, unknown>,
    creating: boolean,
  ) {
    const entries = Object.entries(input),
      columns = entries.map(([key]) => Prisma.raw(snake(key))),
      values = entries.map(([key, v]) => sqlValue(key, v));
    if (creating)
      await tx.$executeRaw(
        Prisma.sql`INSERT INTO ${Prisma.raw(table)}(tenant_id,property_id,id,${Prisma.join(columns)}) VALUES(${tenantId}::uuid,${propertyId}::uuid,${id}::uuid,${Prisma.join(values)})`,
      );
    else
      await tx.$executeRaw(
        Prisma.sql`UPDATE ${Prisma.raw(table)} SET ${Prisma.join(entries.map(([key, v]) => Prisma.sql`${Prisma.raw(snake(key))}=${sqlValue(key, v)}`))},updated_at=CURRENT_TIMESTAMP WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${id}::uuid`,
      );
  }
  async change(
    tenantId: string,
    propertyId: string,
    actor: string,
    key: string | undefined,
    kind: PricingKind,
    id: string | undefined,
    action: string,
    body: unknown,
  ) {
    if (
      !Object.hasOwn(tables, kind) ||
      !['create', 'edit', 'activate', 'archive', 'duplicate', 'fallback'].includes(action) ||
      (action === 'fallback' && kind !== 'plans')
    )
      pricingInvalid('Unsupported pricing action.');
    if (id) id = pricingId(id);
    const v = pricingObject(body),
      version = id ? pricingVersion(body) : undefined,
      reason = text(v, 'changeReason', 2000);
    const input = ['create', 'edit'].includes(action)
      ? kind === 'plans'
        ? pricingPlanInput(body)
        : kind === 'rules'
          ? adjustmentInput(body)
          : chargeInput(body)
      : null;
    return this.writes.run(
      tenantId,
      propertyId,
      actor,
      key,
      {
        action: `pricing.${kind}.${action === 'duplicate' ? 'duplicated' : action}`,
        table: tables[kind],
        id,
        version,
        body: {
          input,
          reason,
          previousFallbackId: v.previousFallbackId ?? null,
          previousFallbackVersion: v.previousFallbackVersion ?? null,
        },
      },
      async (tx, c) => {
        let facts = await pricingFacts(tx, tenantId, propertyId);
        const current = id ? this.collection(facts, kind).find((r) => r.id === id) : undefined;
        if (id && !current) throw new NotFoundException('Pricing record not found.');
        if (current?.lifecycle === 'Archived' && !['duplicate'].includes(action))
          pricingInvalid('Archived records are read-only. Duplicate to a new draft.');
        if (action === 'edit' && current?.lifecycle === 'Active' && !reason)
          pricingInvalid('An active configuration change needs a change reason.');
        let previousFallback: PricingPlan | undefined;
        let nextId = id ?? randomUUID();
        if (action === 'create' || action === 'edit') {
          if (!input) pricingInvalid('Missing pricing fields.');
          await this.targets(tx, tenantId, propertyId, input);
          if (kind === 'plans') {
            const p = input as ReturnType<typeof pricingPlanInput>;
            if (current) {
              const old = current as PricingPlan;
              if (
                old.currency !== p.currency ||
                old.pricingBasis !== p.pricingBasis ||
                old.basePlanId !== p.basePlanId
              )
                pricingInvalid(
                  'Currency and pricing basis are fixed after creation. Duplicate into a new plan.',
                );
            }
            if (p.pricingBasis === 'derived') {
              const parent = facts.plans.find((x) => x.id === p.basePlanId);
              if (
                !parent ||
                parent.pricingBasis !== 'independent' ||
                parent.currency !== p.currency ||
                parent.lifecycle === 'Archived'
              )
                pricingInvalid('Choose an independent parent in this property and currency.');
            }
          }
          if (kind === 'rules' && current?.lifecycle === 'Active')
            this.checkRule(
              { ...input, id: nextId, lifecycle: 'Active', version: current.version } as Adjustment,
              facts,
              await this.catalog(tx, tenantId, propertyId),
              c.today,
            );
          if (kind === 'charges' && current?.lifecycle === 'Active' && !(input as Charge).confirmed)
            pricingInvalid('Confirm property applicability before an active charge can be saved.');
          await this.save(
            tx,
            tenantId,
            propertyId,
            tables[kind],
            nextId,
            {
              ...input,
              ...(action === 'create'
                ? { lifecycle: 'Draft', ...(kind === 'plans' ? { isActive: false } : {}) }
                : {}),
            },
            action === 'create',
          );
        } else if (action === 'duplicate') {
          const source = current!;
          const parsed =
            kind === 'plans'
              ? pricingPlanInput(source)
              : kind === 'rules'
                ? adjustmentInput(source)
                : chargeInput(source);
          nextId = randomUUID();
          await this.save(
            tx,
            tenantId,
            propertyId,
            tables[kind],
            nextId,
            {
              ...parsed,
              name: `${source.name.slice(0, 180)} (copy)`,
              lifecycle: 'Draft',
              ...(kind === 'plans' ? { isActive: false } : {}),
            },
            true,
          );
          if (kind === 'plans' && (source as PricingPlan).pricingBasis === 'independent') {
            await tx.$executeRaw`INSERT INTO rate_rules(id,tenant_id,property_id,rate_plan_id,room_type_id,starts_on,ends_on,weekdays,amount) SELECT gen_random_uuid(),tenant_id,property_id,${nextId}::uuid,room_type_id,starts_on,ends_on,weekdays,amount FROM rate_rules WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND rate_plan_id=${id}::uuid`;
            await tx.$executeRaw`INSERT INTO pricing_daily_prices(tenant_id,property_id,rate_plan_id,room_type_id,stays_on,amount) SELECT tenant_id,property_id,${nextId}::uuid,room_type_id,stays_on,amount FROM pricing_daily_prices WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND rate_plan_id=${id}::uuid`;
            await tx.$executeRaw`INSERT INTO room_price_overrides(tenant_id,property_id,rate_plan_id,room_id,amount) SELECT tenant_id,property_id,${nextId}::uuid,room_id,amount FROM room_price_overrides WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND rate_plan_id=${id}::uuid`;
          }
        } else if (action === 'fallback') {
          const plan = current as PricingPlan,
            previous = facts.plans.find((p) => p.isFallback);
          previousFallback = previous;
          if (plan.lifecycle !== 'Active')
            pricingInvalid('Only an active plan can be the fallback.');
          if (previous) {
            if (
              v.previousFallbackId !== previous.id ||
              v.previousFallbackVersion !== previous.version
            )
              throw new ConflictException({
                code: 'PRICING_VERSION_CONFLICT',
                message: 'The fallback changed. Reload first.',
              });
            await tx.$executeRaw`UPDATE rate_plans SET is_fallback=false,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${previous.id}::uuid`;
          }
          await tx.$executeRaw`UPDATE rate_plans SET is_fallback=true WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${id}::uuid`;
        } else if (action === 'activate') {
          if (current!.lifecycle !== 'Draft') pricingInvalid('Only drafts can activate.');
          await this.targets(tx, tenantId, propertyId, current!);
          if (kind === 'rules')
            this.checkRule(
              { ...current, lifecycle: 'Active' } as Adjustment,
              facts,
              await this.catalog(tx, tenantId, propertyId),
              c.today,
            );
          if (kind === 'charges' && !(current as Charge).confirmed)
            pricingInvalid('Confirm tax/fee applicability with the property before activation.');
          if (
            kind !== 'plans' &&
            (current as Adjustment | Charge).endsOn &&
            (current as Adjustment | Charge).endsOn! < c.today
          )
            pricingInvalid('An already-ended record cannot activate.');
          if (kind === 'plans') {
            const plan = current as PricingPlan,
              parent =
                plan.pricingBasis === 'derived'
                  ? facts.plans.find((p) => p.id === plan.basePlanId)
                  : plan;
            if (!parent || (parent.id !== plan.id && parent.lifecycle !== 'Active'))
              pricingInvalid('Activate the independent parent first.');
            const types = (await this.catalog(tx, tenantId, propertyId)).filter(
              (t) => !plan.roomTypeIds.length || plan.roomTypeIds.includes(t.id),
            );
            if (!types.length) pricingInvalid('Choose at least one room type.');
            const testFacts = {
                ...facts,
                plans: facts.plans.map((p) =>
                  p.id === plan.id ? { ...p, lifecycle: 'Active', isActive: true } : p,
                ),
              },
              start =
                plan.publicationStartsOn && plan.publicationStartsOn > c.today
                  ? plan.publicationStartsOn
                  : c.today,
              stay = Math.max(1, plan.minStay ?? 1, parent.minStay ?? 1);
            for (const type of types)
              for (let i = 0; i < 7; i++) {
                const date = pricingDay(start, i);
                if (plan.publicationEndsOn && date > plan.publicationEndsOn) break;
                const result = evaluatePricing(testFacts, {
                  ratePlanId: plan.id,
                  roomTypeId: type.id,
                  startsOn: date,
                  endsOn: pricingDay(date, stay),
                  adults: 1,
                  children: 0,
                  channel: plan.channels[0] as 'website' | 'staff',
                  today: c.today,
                });
                const blocking = result.errors.filter((e) => e.code !== 'PRICING_PLAN_UNAVAILABLE');
                if (blocking.length)
                  pricingInvalid(`${type.name} ${date}: ${blocking[0]!.message}`);
              }
            await tx.$executeRaw`UPDATE rate_plans SET lifecycle='Active',is_active=true,is_fallback=NOT EXISTS(SELECT 1 FROM rate_plans f WHERE f.tenant_id=${tenantId}::uuid AND f.property_id=${propertyId}::uuid AND f.is_fallback) WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${id}::uuid`;
          } else
            await tx.$executeRaw(
              Prisma.sql`UPDATE ${Prisma.raw(tables[kind])} SET lifecycle='Active',updated_at=CURRENT_TIMESTAMP WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${id}::uuid`,
            );
        } else if (action === 'archive') {
          if (kind === 'plans') {
            const p = current as PricingPlan;
            if (p.isFallback) pricingInvalid('Replace the fallback before archiving this plan.');
            if (facts.plans.some((x) => x.basePlanId === p.id && x.lifecycle === 'Active'))
              pricingInvalid('Archive dependent derived plans first.');
          }
          await tx.$executeRaw(
            Prisma.sql`UPDATE ${Prisma.raw(tables[kind])} SET lifecycle='Archived',updated_at=CURRENT_TIMESTAMP ${kind === 'plans' ? Prisma.sql`,is_active=false` : Prisma.empty} WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${id}::uuid`,
          );
        }
        facts = await pricingFacts(tx, tenantId, propertyId);
        const result = this.collection(facts, kind).find((r) => r.id === nextId)!;
        return {
          ...result,
          ...(action === 'fallback'
            ? {
                previousFallback: previousFallback
                  ? {
                      before: previousFallback,
                      after: {
                        ...previousFallback,
                        isFallback: false,
                        version: previousFallback.version + 1,
                      },
                    }
                  : null,
              }
            : {}),
        };
      },
    );
  }
  private checkRule(rule: Adjustment, facts: PricingFacts, types: { id: string }[], today: string) {
    if (rule.endsOn && rule.endsOn < today)
      pricingInvalid('An already-ended rule cannot activate.');
    const conflicts = adjustmentConflicts(
      rule,
      facts.rules,
      facts.plans,
      types.map((t) => t.id),
      today,
    );
    if (conflicts.length)
      throw new ConflictException({
        code: 'PRICING_PRIORITY_CONFLICT',
        message: 'Equal-priority pricing rules overlap.',
        conflicts,
      });
  }
  async workspace(tenantId: string, propertyId: string) {
    return this.database.withTenantTransaction(
      { tenantId, propertyId },
      async (tx) => {
        const context = await pricingContext(tx, tenantId, propertyId),
          roomTypes = await this.catalog(tx, tenantId, propertyId);
        const rooms = await tx.$queryRaw<
          Array<{ id: string; name: string; roomTypeId: string }>
        >`SELECT id,name,room_type_id AS "roomTypeId" FROM rooms WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND is_active ORDER BY name,id`;
        if (context.readOnly)
          return {
            ...context,
            roomTypes,
            rooms,
            plans: [],
            base: [],
            daily: [],
            rules: [],
            charges: [],
            roomOverrides: [],
            issues: [],
            coverage: null,
            providerPrices: null,
          };
        const facts = await pricingFacts(tx, tenantId, propertyId),
          health = this.health(facts, roomTypes, context.today, context.advanceBookingDays);
        return { ...context, roomTypes, rooms, ...facts, ...health };
      },
      { timeoutMs: 30000 },
    );
  }
  health(
    facts: PricingFacts,
    types: { id: string; name: string; status: string }[],
    today: string,
    horizon: number | null,
  ) {
    return pricingHealth(facts, types, today, horizon);
  }
  async calendar(tenantId: string, propertyId: string, query: unknown) {
    const v = pricingObject(query);
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const c = await pricingContext(tx, tenantId, propertyId),
        start = date(v.startsOn) ?? c.today,
        days = integer(v.days === undefined ? 30 : Number(v.days), 7, 30)!;
      if (![7, 14, 30].includes(days)) pricingInvalid('Choose 7, 14 or 30 days.');
      const types = await this.catalog(tx, tenantId, propertyId),
        dates = Array.from({ length: days }, (_, i) => pricingDay(start, i));
      if (c.readOnly)
        return {
          ...c,
          startsOn: start,
          rows: types.map((t) => ({
            id: t.id,
            label: t.name,
            days: dates.map((date) => ({
              date,
              amount: null,
              status: 'Managed in Clock',
              errors: [],
            })),
          })),
        };
      const f = await pricingFacts(tx, tenantId, propertyId),
        planId = v.ratePlanId ? pricingId(v.ratePlanId) : f.plans.find((p) => p.isFallback)?.id;
      if (!planId) return { ...c, startsOn: start, rows: [] };
      if (!f.plans.some((p) => p.id === planId))
        throw new NotFoundException('Rate plan not found.');
      return {
        ...c,
        startsOn: start,
        ratePlanId: planId,
        rows: types.map((t) => ({
          id: t.id,
          label: t.name,
          days: dates.map((date) => {
            const r = evaluatePricing(f, {
              ratePlanId: planId,
              roomTypeId: t.id,
              startsOn: date,
              endsOn: pricingDay(date, 1),
              today: c.today,
              adults: 1,
              children: 0,
              channel: 'staff',
            });
            return {
              date,
              amount: r.total?.amount ?? null,
              currency: r.total?.currency ?? null,
              status: r.valid
                ? f.daily.some(
                    (d) => d.ratePlanId === planId && d.roomTypeId === t.id && d.date === date,
                  )
                  ? 'Manual'
                  : r.nightlyRates[0]?.components.some(
                        (component) => !['base', 'plan'].includes(component.kind),
                      )
                    ? 'Calculated'
                    : 'Base'
                : 'Missing / restricted',
              components: r.nightlyRates[0]?.components ?? [],
              errors: r.errors,
            };
          }),
        })),
      };
    });
  }
  async preview(tenantId: string, propertyId: string, body: unknown) {
    const v = pricingObject(body),
      roomTypeId = pricingId(v.roomTypeId),
      startsOn = date(v.startsOn, true)!,
      endsOn = date(v.endsOn, true)!;
    if (endsOn <= startsOn || pricingNights(startsOn, endsOn) > 3660)
      pricingInvalid('Choose a stay of at most 3660 nights.');
    const adults = integer(v.adults ?? 1, 1, 1000)!,
      children = integer(v.children ?? 0, 0, 1000)!,
      channel = v.channel ?? 'staff';
    if (!['website', 'staff'].includes(String(channel))) pricingInvalid('Choose Website or Staff.');
    const c = await this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const c = await pricingContext(tx, tenantId, propertyId);
      if (!(await this.catalog(tx, tenantId, propertyId)).some((t) => t.id === roomTypeId))
        throw new NotFoundException('Room type not found.');
      if (v.roomId) {
        const roomId = pricingId(v.roomId);
        const rooms = await tx.$queryRaw<
          Array<{ id: string }>
        >`SELECT id FROM rooms WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${roomId}::uuid AND room_type_id=${roomTypeId}::uuid`;
        if (!rooms.length) throw new NotFoundException('Room not found for this room type.');
      }
      if (c.readOnly) return c;
      const f = await pricingFacts(tx, tenantId, propertyId),
        ratePlanId = pricingId(v.ratePlanId);
      return {
        ...c,
        result: evaluatePricing(f, {
          ratePlanId,
          roomTypeId,
          roomId: v.roomId ? pricingId(v.roomId) : undefined,
          startsOn,
          endsOn,
          adults,
          children,
          channel: channel as 'website' | 'staff',
          today: c.today,
        }),
      };
    });
    if (c.readOnly) {
      const result = await this.clock.getQuoteWithNightlyRates(tenantId, propertyId, {
        roomTypeId,
        startsOn,
        endsOn,
        adultCount: adults,
        childrenCount: children,
      });
      return {
        source: 'CLOCK_PMS',
        readOnly: true,
        valid: result.ok,
        total: result.ok ? result.value.total : null,
        nightlyRates: result.ok ? result.value.nightlyRates : [],
        errors: result.ok
          ? []
          : [
              {
                code: 'PRICING_PROVIDER_UNAVAILABLE',
                message: 'Clock prices could not be verified. No local price was substituted.',
              },
            ],
      };
    }
    return { source: 'LOCAL', readOnly: false, ...('result' in c ? c.result : {}) };
  }
  private bulkInput(body: unknown) {
    const v = pricingObject(body),
      ratePlanId = pricingId(v.ratePlanId),
      roomTypeIds = ids(v.roomTypeIds),
      allYear = v.allYear === true,
      operation = v.operation ?? 'set',
      days = weekdays(v.weekdays);
    if (
      !roomTypeIds.length ||
      !['set', 'reset'].includes(String(operation)) ||
      (allYear && operation === 'reset')
    )
      pricingInvalid('Choose targets and a supported base operation.');
    const start = allYear ? null : date(v.startsOn, true)!,
      end = allYear ? null : date(v.endsOn, true)!;
    if (start && end && end <= start)
      pricingInvalid('Bulk end date is exclusive and must follow the start.');
    const count = allYear ? 1 : pricingNights(start!, end!);
    if (count * roomTypeIds.length > 1000)
      pricingInvalid('Choose at most 1000 cells before weekday filtering.');
    return {
      ratePlanId,
      roomTypeIds,
      allYear,
      operation: String(operation),
      weekdays: days,
      startsOn: start,
      endsOn: end,
      amount: operation === 'reset' ? null : amount(v.amount),
      reason: text(v, 'reason', 2000, true),
    };
  }
  private async bulkPreview(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    body: unknown,
  ) {
    const input = this.bulkInput(body),
      c = await pricingContext(tx, tenantId, propertyId);
    if (c.readOnly) throw new ForbiddenException('Prices are managed in Clock.');
    const facts = await pricingFacts(tx, tenantId, propertyId);
    await this.targets(tx, tenantId, propertyId, input);
    const plan = facts.plans.find((p) => p.id === input.ratePlanId);
    if (!plan || plan.pricingBasis !== 'independent' || plan.lifecycle === 'Archived')
      pricingInvalid('Choose an editable independent plan.');
    if (input.startsOn && input.startsOn < c.today) pricingInvalid('Past prices are read-only.');
    const dates = input.allYear
      ? [null]
      : Array.from({ length: pricingNights(input.startsOn!, input.endsOn!) }, (_, i) =>
          pricingDay(input.startsOn!, i),
        ).filter((d) => input.weekdays.includes(new Date(d + 'T00:00:00Z').getUTCDay() || 7));
    if (!dates.length) pricingInvalid('No dates match the weekdays.');
    const changes = input.roomTypeIds.flatMap((roomTypeId) =>
      dates.map((date) => {
        const base = facts.base.find(
          (b) => b.ratePlanId === plan.id && b.roomTypeId === roomTypeId && b.startsOn === null,
        );
        return {
          roomTypeId,
          date,
          before: date
            ? (resolveBasePrice(facts, plan.id, roomTypeId, date).chosen?.amount ?? null)
            : (base?.amount ?? null),
          after:
            input.operation === 'reset' && date
              ? (resolveBasePrice(
                  {
                    ...facts,
                    daily: facts.daily.filter(
                      (d) =>
                        !(
                          d.ratePlanId === plan.id &&
                          d.roomTypeId === roomTypeId &&
                          d.date === date
                        ),
                    ),
                  },
                  plan.id,
                  roomTypeId,
                  date,
                ).chosen?.amount ?? null)
              : input.amount,
        };
      }),
    );
    const candidate: PricingFacts = { ...facts, base: [...facts.base], daily: [...facts.daily] };
    for (const cell of changes) {
      if (input.allYear) {
        candidate.base = candidate.base.filter(
          (b) =>
            !(b.ratePlanId === plan.id && b.roomTypeId === cell.roomTypeId && b.startsOn === null),
        );
        candidate.base.push({
          id: 'preview',
          ratePlanId: plan.id,
          roomTypeId: cell.roomTypeId,
          startsOn: null,
          endsOn: null,
          weekdays: input.weekdays.map((d) => (d === 7 ? 0 : d)),
          amount: input.amount!,
          version: 1,
          createdAt: '',
        });
      } else {
        candidate.daily = candidate.daily.filter(
          (d) =>
            !(d.ratePlanId === plan.id && d.roomTypeId === cell.roomTypeId && d.date === cell.date),
        );
        if (input.operation !== 'reset')
          candidate.daily.push({
            ratePlanId: plan.id,
            roomTypeId: cell.roomTypeId,
            date: cell.date!,
            amount: input.amount!,
            version: 1,
          });
      }
    }
    const errors: Array<{
      code: string;
      message: string;
      date?: string;
      roomTypeId: string;
      ratePlanId: string;
    }> = [];
    const affected = facts.plans.filter((p) => p.id === plan.id || p.basePlanId === plan.id);
    for (const roomTypeId of input.roomTypeIds) {
      const datesToCheck = input.allYear
        ? [
            ...new Set([
              c.today,
              ...facts.rules.flatMap((r) =>
                [r.startsOn, r.endsOn].filter((d): d is string => !!d && d >= c.today),
              ),
            ]),
          ].flatMap((d) => Array.from({ length: 7 }, (_, i) => pricingDay(d, i)))
        : dates.filter((d): d is string => d !== null);
      for (const date of datesToCheck)
        for (const target of affected) {
          const result = evaluatePricing(candidate, {
            ratePlanId: target.id,
            roomTypeId,
            startsOn: date,
            endsOn: pricingDay(date, target.minStay ?? 1),
            adults: 1,
            children: 0,
            channel: 'staff',
            today: c.today,
          });
          for (const error of result.errors.filter((e) =>
            [
              'PRICING_AMOUNT_INVALID',
              'PRICING_PRIORITY_CONFLICT',
              'PRICING_CURRENCY_UNSUPPORTED',
            ].includes(e.code),
          )) {
            if (errors.length < 100) errors.push({ ...error, roomTypeId, ratePlanId: target.id });
          }
        }
    }
    return {
      input,
      changes,
      valid: errors.length === 0,
      errors,
      version: c.pricingVersion,
      previewToken: pricingHash({ input, changes, version: c.pricingVersion }),
    };
  }
  async previewBase(tenantId: string, propertyId: string, body: unknown) {
    return this.database.withTenantTransaction(
      { tenantId, propertyId },
      (tx) => this.bulkPreview(tx, tenantId, propertyId, body),
      { timeoutMs: 30000 },
    );
  }
  async applyBase(
    tenantId: string,
    propertyId: string,
    actor: string,
    key: string | undefined,
    body: unknown,
  ) {
    const input = this.bulkInput(body),
      v = pricingObject(body),
      version = pricingVersion(body)!;
    if (typeof v.previewToken !== 'string') pricingInvalid('Preview before applying.');
    return this.writes.run(
      tenantId,
      propertyId,
      actor,
      key,
      {
        action: 'pricing.base.bulk_change',
        body: { input, version, previewToken: v.previewToken },
        propertyVersion: version,
      },
      async (tx) => {
        const preview = await this.bulkPreview(tx, tenantId, propertyId, body);
        if (preview.previewToken !== v.previewToken)
          throw new ConflictException({
            code: 'PRICING_PREVIEW_STALE',
            message: 'Prices changed. Preview again.',
          });
        if (!preview.valid)
          throw new BadRequestException({
            code: 'PRICING_INVALID_TOTAL',
            message: 'This change produces invalid prices. Review the dated validation errors.',
            errors: preview.errors,
          });
        for (const cell of preview.changes) {
          if (input.allYear) {
            await tx.$executeRaw`INSERT INTO rate_rules(id,tenant_id,property_id,rate_plan_id,room_type_id,starts_on,ends_on,weekdays,amount) VALUES(${randomUUID()}::uuid,${tenantId}::uuid,${propertyId}::uuid,${input.ratePlanId}::uuid,${cell.roomTypeId}::uuid,NULL,NULL,${input.weekdays.map((d) => (d === 7 ? 0 : d))}::smallint[],${input.amount}::numeric) ON CONFLICT(tenant_id,property_id,rate_plan_id,room_type_id) WHERE starts_on IS NULL DO UPDATE SET amount=EXCLUDED.amount,weekdays=EXCLUDED.weekdays,version=rate_rules.version+1,updated_at=CURRENT_TIMESTAMP`;
          } else if (input.operation === 'reset') {
            await tx.$executeRaw`DELETE FROM pricing_daily_prices WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND rate_plan_id=${input.ratePlanId}::uuid AND room_type_id=${cell.roomTypeId}::uuid AND stays_on=${cell.date}::date`;
          } else
            await tx.$executeRaw`INSERT INTO pricing_daily_prices(tenant_id,property_id,rate_plan_id,room_type_id,stays_on,amount) VALUES(${tenantId}::uuid,${propertyId}::uuid,${input.ratePlanId}::uuid,${cell.roomTypeId}::uuid,${cell.date}::date,${input.amount}::numeric) ON CONFLICT(tenant_id,property_id,rate_plan_id,room_type_id,stays_on) DO UPDATE SET amount=EXCLUDED.amount,version=pricing_daily_prices.version+1`;
        }
        return {
          id: randomUUID(),
          changedCells: preview.changes.length,
          changes: preview.changes,
          beforeCount: preview.changes.length,
          afterCount: preview.changes.length,
        };
      },
    );
  }
  async history(tenantId: string, propertyId: string, kind: string, id: string) {
    if (!Object.hasOwn(tables, kind)) pricingInvalid('Unknown history kind.');
    pricingId(id);
    return this.database.withTenantTransaction(
      { tenantId, propertyId },
      (tx) =>
        tx.$queryRaw`SELECT id,action,actor_user_id AS "actorUserId",details,created_at AS "createdAt" FROM audit_logs WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND target_type='pricing' AND target_id=${id} ORDER BY created_at DESC,id DESC LIMIT 100`,
    );
  }
}
