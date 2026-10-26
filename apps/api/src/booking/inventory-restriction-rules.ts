export type RestrictionType =
  | 'minimum_stay'
  | 'maximum_stay'
  | 'closed_to_arrival'
  | 'closed_to_departure'
  | 'stop_sell'
  | 'minimum_advance';
export type RestrictionLifecycle =
  'Draft' | 'Scheduled' | 'Active' | 'Paused' | 'Expired' | 'Archived';
export type BookingRestriction = {
  id: string;
  name: string;
  type: RestrictionType;
  value: number;
  scope: 'property' | 'category' | 'room_type';
  targetIds: string[];
  startsOn: string;
  endsOn: string | null;
  weekdays: number[];
  priority: number;
  lifecycle: RestrictionLifecycle;
};

export function restrictionLifecycle(
  rule: BookingRestriction,
  today: string,
): RestrictionLifecycle {
  if (rule.lifecycle === 'Draft' || rule.lifecycle === 'Archived') return rule.lifecycle;
  if (rule.endsOn && rule.endsOn < today) return 'Expired';
  if (rule.lifecycle === 'Paused') return 'Paused';
  return rule.startsOn > today ? 'Scheduled' : 'Active';
}

function weekday(day: string) {
  return new Date(`${day}T00:00:00Z`).getUTCDay() || 7;
}
function nextDay(day: string, count = 1) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
export function restrictionApplies(rule: BookingRestriction, day: string): boolean {
  return (
    (rule.lifecycle === 'Active' || rule.lifecycle === 'Scheduled') &&
    day >= rule.startsOn &&
    (!rule.endsOn || day <= rule.endsOn) &&
    rule.weekdays.includes(weekday(day))
  );
}
export function restrictionScopesOverlap(
  a: BookingRestriction,
  b: BookingRestriction,
  types: Array<{ id: string; categoryId: string | null }>,
): boolean {
  if (a.scope === 'property' || b.scope === 'property') return true;
  if (a.scope === b.scope) return a.targetIds.some((id) => b.targetIds.includes(id));
  const category = a.scope === 'category' ? a : b,
    type = a.scope === 'room_type' ? a : b;
  return types.some(
    (item) =>
      type.targetIds.includes(item.id) &&
      item.categoryId &&
      category.targetIds.includes(item.categoryId),
  );
}
/** Same-type equal-priority value contradictions, including a future weekday overlap, block activation. */
export function restrictionConflicts(
  candidate: BookingRestriction,
  existing: BookingRestriction[],
  types: Array<{ id: string; categoryId: string | null }>,
  today: string,
) {
  return existing.flatMap((other) => {
    if (
      candidate.id === other.id ||
      candidate.type !== other.type ||
      candidate.priority !== other.priority ||
      candidate.value === other.value ||
      !['Active', 'Scheduled'].includes(other.lifecycle) ||
      !restrictionScopesOverlap(candidate, other, types)
    )
      return [];
    const start = [candidate.startsOn, other.startsOn, today].sort().at(-1)!;
    const end = [candidate.endsOn, other.endsOn]
      .filter((day): day is string => Boolean(day))
      .sort()[0];
    for (let i = 0; i < 7; i++) {
      const day = nextDay(start, i);
      if (end && day > end) break;
      if (candidate.weekdays.includes(weekday(day)) && other.weekdays.includes(weekday(day)))
        return [
          { id: other.id, name: other.name, date: day, code: 'RESTRICTION_PRIORITY_CONFLICT' },
        ];
    }
    return [];
  });
}

/** Pure selection and effects; callers supply only restrictions whose scope matches the selected type. */
export function evaluateRestrictions(
  rules: BookingRestriction[],
  startsOn: string,
  endsOn: string,
  today: string,
) {
  const errors: Array<{ code: string; message: string; restrictionIds?: string[] }> = [];
  const applied = new Map<string, BookingRestriction>();
  const choose = (type: RestrictionType, day: string) => {
    const matching = rules.filter((rule) => rule.type === type && restrictionApplies(rule, day));
    const priority = Math.max(...matching.map((rule) => rule.priority));
    const winners = matching.filter((rule) => rule.priority === priority);
    if (new Set(winners.map((rule) => rule.value)).size > 1) {
      errors.push({
        code: 'RESTRICTION_PRIORITY_CONFLICT',
        message: `Conflicting ${type.replaceAll('_', ' ')} restrictions apply on ${day}.`,
        restrictionIds: winners.map((rule) => rule.id),
      });
      return undefined;
    }
    winners.forEach((rule) => applied.set(rule.id, rule));
    return winners[0];
  };
  const min = choose('minimum_stay', startsOn),
    max = choose('maximum_stay', startsOn);
  const arrival = choose('closed_to_arrival', startsOn),
    departure = choose('closed_to_departure', endsOn),
    advance = choose('minimum_advance', startsOn);
  const violation = (rule: BookingRestriction | undefined, code: string, message: string) => {
    if (rule) errors.push({ code, message, restrictionIds: [rule.id] });
  };
  if (arrival?.value === 1)
    violation(arrival, 'CLOSED_TO_ARRIVAL', 'Arrival is closed on the selected check-in date.');
  if (departure?.value === 1)
    violation(
      departure,
      'CLOSED_TO_DEPARTURE',
      'Departure is closed on the selected check-out date.',
    );
  if (advance && (Date.parse(startsOn) - Date.parse(today)) / 86400000 < advance.value)
    violation(advance, 'MINIMUM_ADVANCE', `Book at least ${advance.value} days before arrival.`);
  // Schedule boundaries plus a full weekday cycle cover even long stays without looping over every night.
  const boundaries = new Set([startsOn]);
  for (const rule of rules.filter((r) => r.type === 'stop_sell')) {
    if (rule.startsOn > startsOn && rule.startsOn < endsOn) boundaries.add(rule.startsOn);
    if (rule.endsOn && rule.endsOn < endsOn && rule.endsOn >= startsOn)
      boundaries.add(nextDay(rule.endsOn));
  }
  const dates = new Set<string>();
  for (const boundary of boundaries)
    for (let i = 0; i < 7; i++) {
      const day = nextDay(boundary, i);
      if (day < endsOn) dates.add(day);
    }
  for (const day of [...dates].sort()) {
    const stop = choose('stop_sell', day);
    if (stop?.value === 1) {
      violation(stop, 'STOP_SELL', `Sales are closed for the night of ${day}.`);
      break;
    }
  }
  return {
    errors,
    minimumStay: min?.value,
    maximumStay: max?.value,
    appliedRestrictionIds: [...applied.keys()],
  };
}
