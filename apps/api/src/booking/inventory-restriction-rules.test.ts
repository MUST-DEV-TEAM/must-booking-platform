import { describe, expect, it } from 'vitest';
import {
  evaluateBookingRules,
  restrictionConflicts,
  restrictionLifecycle,
  type BookingRestriction,
} from './booking-rules';
const now = new Date('2026-10-18T12:00:00Z');
const rule = (patch: Partial<BookingRestriction> = {}): BookingRestriction => ({
  id: 'r1',
  name: 'Stay rule',
  type: 'minimum_stay',
  value: 3,
  scope: 'property',
  targetIds: [],
  startsOn: '2026-11-01',
  endsOn: '2026-11-30',
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  priority: 50,
  lifecycle: 'Active',
  ...patch,
});
function check(
  restrictions: BookingRestriction[],
  startsOn = '2026-11-02',
  endsOn = '2026-11-05',
  extra: Partial<Parameters<typeof evaluateBookingRules>[0]> = {},
) {
  return evaluateBookingRules({ channel: 'guest', startsOn, endsOn, now, restrictions, ...extra });
}
const codes = (result: ReturnType<typeof check>) => result.errors.map((e) => e.code);
describe('Inventory restrictions through the shared booking evaluator', () => {
  it.each(['guest', 'staff'] as const)(
    'enforces minimum and maximum stay at exact boundaries for %s',
    (channel) => {
      expect(check([rule()], undefined, undefined, { channel }).valid).toBe(true);
      expect(codes(check([rule({ value: 4 })], undefined, undefined, { channel }))).toContain(
        'MIN_STAY',
      );
      expect(check([rule({ type: 'maximum_stay' })], undefined, undefined, { channel }).valid).toBe(
        true,
      );
      expect(
        codes(check([rule({ type: 'maximum_stay', value: 2 })], undefined, undefined, { channel })),
      ).toContain('MAX_STAY');
    },
  );
  it('allows a higher-priority exception to relax a general rule and the Settings base', () => {
    const general = rule({ value: 7, priority: 25 }),
      exception = rule({ id: 'r2', value: 2, priority: 75, endsOn: '2026-11-02' });
    expect(
      check([general, exception], undefined, undefined, { policy: { minStayNights: 9 } }).valid,
    ).toBe(true);
    expect(codes(check([general, exception], '2026-11-03', '2026-11-06'))).toContain('MIN_STAY');
  });
  it('returns effective stay metadata from the same priority decision', () => {
    expect(
      check(
        [rule({ value: 2 }), rule({ id: 'max', type: 'maximum_stay', value: 7 })],
        undefined,
        undefined,
        { policy: { minStayNights: 5, maxStayNights: 3 } },
      ),
    ).toMatchObject({ valid: true, effectiveMinStayNights: 2, effectiveMaxStayNights: 7 });
  });
  it('combines distinct types and rejects runtime same-priority contradictions', () => {
    expect(
      codes(check([rule({ value: 4 }), rule({ id: 'r2', type: 'maximum_stay', value: 2 })])),
    ).toEqual(['MIN_STAY', 'MAX_STAY']);
    expect(codes(check([rule(), rule({ id: 'r2', value: 4 })]))).toContain(
      'RESTRICTION_PRIORITY_CONFLICT',
    );
    expect(check([rule(), rule({ id: 'r2' })]).valid).toBe(true);
  });
  it('applies length and arrival closure by arrival only, including the inclusive end date', () => {
    const r = rule({
      type: 'closed_to_arrival',
      value: 1,
      startsOn: '2026-11-02',
      endsOn: '2026-11-02',
    });
    expect(codes(check([r]))).toContain('CLOSED_TO_ARRIVAL');
    expect(check([r], '2026-11-01', '2026-11-04').valid).toBe(true);
    expect(check([r], '2026-11-03', '2026-11-06').valid).toBe(true);
    expect(check([rule({ value: 9, startsOn: '2026-11-03' })]).valid).toBe(true);
  });
  it('applies departure closure to checkout and its own weekday', () => {
    const r = rule({
      type: 'closed_to_departure',
      value: 1,
      startsOn: '2026-11-05',
      endsOn: '2026-11-05',
      weekdays: [4],
    });
    expect(codes(check([r]))).toContain('CLOSED_TO_DEPARTURE');
    expect(check([r], '2026-11-01', '2026-11-04').valid).toBe(true);
    expect(check([{ ...r, weekdays: [1] }]).valid).toBe(true);
  });
  it('checks each sold night; the checkout boundary is not a sold night', () => {
    const r = rule({ type: 'stop_sell', value: 1, startsOn: '2026-11-04', endsOn: '2026-11-04' });
    expect(codes(check([r]))).toContain('STOP_SELL');
    expect(check([r], '2026-11-02', '2026-11-04').valid).toBe(true);
    expect(check([r], '2026-11-05', '2026-11-06').valid).toBe(true);
  });
  it('resolves stop-sell priority separately at schedule and weekday boundaries', () => {
    const closed = rule({ type: 'stop_sell', value: 1 }),
      open = rule({
        id: 'open',
        type: 'stop_sell',
        value: 0,
        priority: 75,
        startsOn: '2026-11-02',
        endsOn: '2026-11-03',
      });
    expect(check([closed, open], '2026-11-02', '2026-11-04').valid).toBe(true);
    expect(codes(check([closed, open]))).toContain('STOP_SELL');
    expect(
      codes(check([closed, { ...open, weekdays: [1] }], '2026-11-02', '2026-11-04')),
    ).toContain('STOP_SELL');
  });
  it.each(['guest', 'staff'] as const)(
    'enforces minimum advance at the exact property-local day boundary for %s',
    (channel) => {
      const r = rule({ type: 'minimum_advance', value: 1, startsOn: '2026-10-01', endsOn: null });
      const extra = {
        channel,
        now: new Date('2026-10-18T22:30:00Z'),
        policy: { timezone: 'Europe/Tirane' },
      };
      expect(codes(check([r], '2026-10-19', '2026-10-20', extra))).toContain('MINIMUM_ADVANCE');
      expect(check([r], '2026-10-20', '2026-10-21', extra).valid).toBe(true);
      expect(check([{ ...r, value: 0 }], '2026-10-19', '2026-10-20', extra).valid).toBe(true);
    },
  );
  it('uses ISO Monday/Sunday weekdays, month/year edges and leap dates', () => {
    const closure = rule({
      type: 'closed_to_arrival',
      value: 1,
      startsOn: '2026-01-01',
      endsOn: null,
      weekdays: [7],
    });
    expect(codes(check([closure], '2026-11-01', '2026-11-02'))).toContain('CLOSED_TO_ARRIVAL');
    expect(check([closure], '2026-11-02', '2026-11-03').valid).toBe(true);
    expect(codes(check([{ ...closure, weekdays: [2] }], '2028-02-29', '2028-03-01'))).toContain(
      'CLOSED_TO_ARRIVAL',
    );
    expect(codes(check([{ ...closure, weekdays: [5] }], '2027-01-01', '2027-01-02'))).toContain(
      'CLOSED_TO_ARRIVAL',
    );
  });
  it.each(['Draft', 'Paused', 'Archived', 'Expired'] as const)(
    'does not apply %s restrictions',
    (lifecycle) => {
      expect(check([rule({ type: 'stop_sell', value: 1, lifecycle })]).valid).toBe(true);
    },
  );
  it('applies scheduled restrictions to future stays but never to block operations', () => {
    expect(codes(check([rule({ type: 'stop_sell', value: 1, lifecycle: 'Scheduled' })]))).toContain(
      'STOP_SELL',
    );
    expect(
      check([rule({ type: 'stop_sell', value: 1 })], undefined, undefined, { channel: 'block' })
        .valid,
    ).toBe(true);
  });
  it('finds a stop-sell deep inside a long stay without a per-night unbounded loop', () => {
    expect(
      codes(
        check(
          [rule({ type: 'stop_sell', value: 1, startsOn: '2099-12-30', endsOn: null })],
          '2026-11-02',
          '2100-01-01',
        ),
      ),
    ).toContain('STOP_SELL');
  });
});
describe('Restriction activation conflicts and lifecycle', () => {
  const catalog = [
    { id: 'type1', categoryId: 'cat1' },
    { id: 'type2', categoryId: 'cat2' },
  ];
  const conflict = (a: BookingRestriction, b: BookingRestriction) =>
    restrictionConflicts(a, [b], catalog, '2026-10-18');
  it.each([
    'minimum_stay',
    'maximum_stay',
    'minimum_advance',
    'closed_to_arrival',
    'closed_to_departure',
    'stop_sell',
  ] as const)('blocks contradicting %s values at equal priority', (type) => {
    const value = ['closed_to_arrival', 'closed_to_departure', 'stop_sell'].includes(type) ? 0 : 2;
    expect(conflict(rule({ type, value: 1 }), rule({ id: 'other', type, value }))).toHaveLength(1);
  });
  it('allows different priorities, identical values, non-overlapping dates and disjoint weekdays', () => {
    expect(conflict(rule(), rule({ id: 'other', value: 4, priority: 75 }))).toEqual([]);
    expect(conflict(rule(), rule({ id: 'other' }))).toEqual([]);
    expect(
      conflict(rule(), rule({ id: 'other', value: 4, startsOn: '2026-12-01', endsOn: null })),
    ).toEqual([]);
    expect(
      conflict(rule({ weekdays: [1] }), rule({ id: 'other', value: 4, weekdays: [2] })),
    ).toEqual([]);
    expect(
      conflict(
        rule({ startsOn: '2026-11-02', endsOn: '2026-11-02', weekdays: [2] }),
        rule({ id: 'other', value: 4, weekdays: [2] }),
      ),
    ).toEqual([]);
  });
  it('detects property/category/type overlap using current property-scoped membership', () => {
    expect(
      conflict(rule(), rule({ id: 'other', value: 4, scope: 'category', targetIds: ['cat1'] })),
    ).toHaveLength(1);
    expect(
      conflict(
        rule({ scope: 'category', targetIds: ['cat1'] }),
        rule({ id: 'other', value: 4, scope: 'room_type', targetIds: ['type1'] }),
      ),
    ).toHaveLength(1);
    expect(
      conflict(
        rule({ scope: 'category', targetIds: ['cat1'] }),
        rule({ id: 'other', value: 4, scope: 'room_type', targetIds: ['type2'] }),
      ),
    ).toEqual([]);
    expect(
      conflict(
        rule({ scope: 'room_type', targetIds: ['type1'] }),
        rule({ id: 'other', value: 4, scope: 'room_type', targetIds: ['type2'] }),
      ),
    ).toEqual([]);
  });
  it('ignores draft/paused opponents, self and expired intersections; handles open-ended schedules', () => {
    expect(conflict(rule(), rule({ value: 4 }))).toEqual([]);
    expect(conflict(rule(), rule({ id: 'other', value: 4, lifecycle: 'Draft' }))).toEqual([]);
    expect(conflict(rule(), rule({ id: 'other', value: 4, lifecycle: 'Paused' }))).toEqual([]);
    expect(
      conflict(
        rule({ startsOn: '2026-01-01', endsOn: '2026-02-01' }),
        rule({ id: 'other', value: 4, startsOn: '2026-01-01', endsOn: null }),
      ),
    ).toEqual([]);
    expect(
      conflict(
        rule({ endsOn: null }),
        rule({ id: 'other', value: 4, startsOn: '2028-01-01', endsOn: null }),
      ),
    ).toHaveLength(1);
  });
  it('derives scheduled, active and expired states with inclusive end dates', () => {
    expect(restrictionLifecycle(rule(), '2026-10-18')).toBe('Scheduled');
    expect(restrictionLifecycle(rule(), '2026-11-01')).toBe('Active');
    expect(restrictionLifecycle(rule(), '2026-11-30')).toBe('Active');
    expect(restrictionLifecycle(rule(), '2026-12-01')).toBe('Expired');
    expect(restrictionLifecycle(rule({ lifecycle: 'Archived' }), '2026-12-01')).toBe('Archived');
  });
});
