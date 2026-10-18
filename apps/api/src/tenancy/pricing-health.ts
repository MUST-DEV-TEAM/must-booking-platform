import {
  evaluatePricing,
  pricingDay,
  pricingNights,
  type PricingFacts,
} from '../booking/pricing-evaluator';
import { adjustmentConflicts } from './pricing-input';
import type { PricingKind } from './pricing.service';
export type PricingIssue = {
  id: string;
  code: string;
  severity: string;
  name: string;
  scope: string;
  message: string;
  kind?: PricingKind;
  recordId?: string;
};
/** Sweep schedule boundaries and weekday cycles, covering the entire configured arrival horizon without a per-day query loop. */
export function pricingHealth(
  facts: PricingFacts,
  types: { id: string; name: string; status: string }[],
  today: string,
  horizon: number | null,
) {
  const readiness: Record<string, boolean> = Object.fromEntries(types.map((t) => [t.id, false]));
  const issues: PricingIssue[] = [],
    days = horizon === null ? 365 : horizon + 1;
  const max = pricingNights(today, '9999-12-30');
  if (days > max || days < 1)
    return {
      issues: [
        {
          id: 'horizon',
          code: 'PRICING_HORIZON_UNSUPPORTED',
          severity: 'Blocking',
          name: 'Booking horizon',
          scope: 'Property',
          message: 'The configured horizon exceeds representable calendar dates.',
        },
      ],
      coverage: null,
      readiness,
    };
  const end = pricingDay(today, days);
  let total = 0,
    priced = 0;
  const active = facts.plans.filter((p) => p.lifecycle === 'Active' && p.isActive);
  if (!active.length)
    issues.push({
      id: 'no-plan',
      code: 'PRICING_NO_ACTIVE_PLAN',
      severity: 'Blocking',
      name: 'No active rate plan',
      scope: 'Property',
      message: 'Create prices and activate a rate plan.',
    });
  if (active.length && !active.some((p) => p.isFallback))
    issues.push({
      id: 'no-fallback',
      code: 'PRICING_NO_FALLBACK',
      severity: 'Blocking',
      name: 'Fallback missing',
      scope: 'Property',
      message: 'Choose an active fallback plan.',
    });
  for (const p of facts.plans.filter((p) => p.lifecycle !== 'Archived')) {
    const source =
      p.pricingBasis === 'derived' ? facts.plans.find((b) => b.id === p.basePlanId) : p;
    for (const t of types.filter(
      (t) => t.status !== 'ARCHIVED' && (!p.roomTypeIds.length || p.roomTypeIds.includes(t.id)),
    )) {
      const stay = Math.max(1, p.minStay ?? 1, source?.minStay ?? 1),
        boundaries = new Set([today, end]);
      const dates = [
        ...facts.base.flatMap((b) => [b.startsOn, b.endsOn ? pricingDay(b.endsOn, 1) : null]),
        ...facts.daily.flatMap((d) => [d.date, pricingDay(d.date, 1)]),
        ...facts.rules.flatMap((r) => [
          r.startsOn,
          r.endsOn ? pricingDay(r.endsOn, 1) : null,
          r.minAdvance !== null ? pricingDay(today, r.minAdvance) : null,
          r.maxAdvance !== null ? pricingDay(today, r.maxAdvance + 1) : null,
        ]),
        ...facts.charges.flatMap((c) => [c.startsOn, c.endsOn ? pricingDay(c.endsOn, 1) : null]),
        p.publicationStartsOn,
        p.publicationEndsOn ? pricingDay(p.publicationEndsOn, 1) : null,
        p.minAdvance !== null ? pricingDay(today, p.minAdvance) : null,
        source?.publicationStartsOn,
        source?.publicationEndsOn ? pricingDay(source.publicationEndsOn, 1) : null,
        source?.minAdvance !== null && source?.minAdvance !== undefined
          ? pricingDay(today, source.minAdvance)
          : null,
      ];
      for (const boundary of dates)
        if (boundary)
          for (let i = 0; i < stay; i++) {
            const d = pricingDay(boundary, -i);
            if (d > today && d < end) boundaries.add(d);
          }
      const points = [...boundaries].sort();
      let usable = 0;
      let missing = 0;
      let first: string | undefined;
      let firstCode = 'PRICING_MISSING_BASE';
      for (let b = 0; b < points.length - 1; b++) {
        const start = points[b]!,
          length = pricingNights(start, points[b + 1]!);
        for (let i = 0; i < Math.min(7, length); i++) {
          const date = pricingDay(start, i),
            count = Math.floor((length - 1 - i) / 7) + 1,
            result = evaluatePricing(facts, {
              ratePlanId: p.id,
              roomTypeId: t.id,
              startsOn: date,
              endsOn: pricingDay(date, stay),
              adults: 1,
              children: 0,
              channel: p.channels.includes('website') ? 'website' : 'staff',
              today,
            });
          if (p.lifecycle === 'Active') {
            if (result.valid) usable += count;
            if (t.status === 'PUBLISHED') {
              total += count;
              if (result.valid) priced += count;
            }
          }
          if (
            result.errors.some((e) =>
              [
                'PRICING_MISSING_BASE',
                'PRICING_AMOUNT_INVALID',
                'PRICING_PRIORITY_CONFLICT',
                'PRICING_CURRENCY_UNSUPPORTED',
              ].includes(e.code),
            )
          ) {
            missing += count;
            if (!first) {
              first = date;
              firstCode = result.errors.find((e) =>
                [
                  'PRICING_MISSING_BASE',
                  'PRICING_AMOUNT_INVALID',
                  'PRICING_PRIORITY_CONFLICT',
                  'PRICING_CURRENCY_UNSUPPORTED',
                ].includes(e.code),
              )!.code;
            }
          }
        }
      }
      if (p.lifecycle === 'Active' && missing === 0 && usable > 0) readiness[t.id] = true;
      if (missing)
        issues.push({
          id: `price:${p.id}:${t.id}`,
          code: firstCode,
          severity: p.lifecycle === 'Active' && t.status === 'PUBLISHED' ? 'Blocking' : 'Warning',
          name: `${p.name} / ${t.name}`,
          scope: `${missing} arrival dates`,
          message: `Unusable price for a minimum-plan-stay example; first affected arrival ${first}.`,
          kind: 'plans',
          recordId: p.id,
        });
    }
  }
  for (const r of facts.rules.filter((r) => r.lifecycle === 'Active'))
    for (const conflict of adjustmentConflicts(
      r,
      facts.rules,
      facts.plans,
      types.map((t) => t.id),
      today,
    ))
      if (r.id < conflict.id)
        issues.push({
          id: `tie:${r.id}:${conflict.id}`,
          code: 'PRICING_PRIORITY_CONFLICT',
          severity: 'Blocking',
          name: r.name,
          scope: conflict.date,
          message: `Equal priority with ${conflict.name}.`,
          kind: 'rules',
          recordId: r.id,
        });
  for (const item of [...facts.rules, ...facts.charges].filter((r) => r.lifecycle !== 'Archived'))
    if (
      item.roomTypeIds.some((id) => !types.some((t) => t.id === id)) ||
      item.ratePlanIds.some(
        (id) => !facts.plans.some((p) => p.id === id && p.lifecycle !== 'Archived'),
      )
    )
      issues.push({
        id: `targets:${item.id}`,
        code: 'PRICING_MISSING_TARGET',
        severity: item.lifecycle === 'Active' ? 'Blocking' : 'Warning',
        name: item.name,
        scope: 'Removed target',
        message: 'Review removed or archived targets.',
        kind: 'basis' in item ? 'charges' : 'rules',
        recordId: item.id,
      });
  return {
    issues,
    readiness,
    coverage: {
      startsOn: today,
      endsOn: end,
      horizonComplete: horizon !== null,
      totalCells: total,
      pricedCells: priced,
      percentage: total ? Math.round((priced * 100) / total) : null,
      example:
        'One adult, no children, minimum plan stay; pricing coverage does not promise stock or eligibility for every stay.',
    },
  };
}
