import { describe, expect, it } from 'vitest';

import { ClockBookingHydrationService } from './clock-booking-hydration.service';

type Plan = { id: string; currency: string; name: string; shadow: boolean; active: boolean };

/** A tiny stand-in for the database: the rate plans table and the two statements the plan lookup uses. */
function database(plans: Plan[]) {
  const inserted: Array<{ name: string; currency: string }> = [];
  const tx = {
    $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
      if (sql.includes('clock_shadow_room_type_id = $3::uuid'))
        return plans.filter((p) => p.shadow).map((p) => ({ id: p.id, currency: p.currency }));
      if (sql.includes('clock_shadow_room_type_id IS NULL') && sql.includes('name = $3'))
        return plans
          .filter((p) => !p.shadow && !p.active && p.name === params[2] && p.currency === params[3])
          .map((p) => ({ id: p.id }));
      return [];
    },
    $executeRawUnsafe: async (sql: string, ...params: unknown[]) => {
      const [id, , , name, currency] = params as string[];
      inserted.push({ name: name!, currency: currency! });
      plans.push({
        id: id!,
        currency: currency!,
        name: name!,
        shadow: sql.includes('clock_shadow_room_type_id'),
        active: !sql.includes('false'),
      });
    },
  };
  return { tx, inserted };
}

const service = Object.create(ClockBookingHydrationService.prototype) as unknown as {
  shadowRatePlanId: (
    tx: unknown,
    tenantId: string,
    propertyId: string,
    roomTypeId: string,
    externalRoomTypeId: number | null,
    currency: string,
  ) => Promise<string>;
};

describe('the rate plan an imported Clock reservation is kept on', () => {
  const hotelPlan: Plan = {
    id: 'euro-plan',
    currency: 'EUR',
    name: 'Clock: Suite',
    shadow: true,
    active: true,
  };

  it('is the room type’s own plan when Clock bills in the hotel’s currency', async () => {
    const { tx, inserted } = database([{ ...hotelPlan }]);
    expect(await service.shadowRatePlanId(tx, 't', 'p', 'rt', 1, 'EUR')).toBe('euro-plan');
    expect(inserted).toHaveLength(0);
  });

  it('is a plan in the other currency when Clock bills in lek, so lek is never shown as euros', async () => {
    const { tx, inserted } = database([{ ...hotelPlan }]);
    const id = await service.shadowRatePlanId(tx, 't', 'p', 'rt', 1, 'ALL');
    expect(id).not.toBe('euro-plan');
    expect(inserted).toEqual([{ name: 'Clock reservations billed in ALL', currency: 'ALL' }]);
  });

  it('reuses that plan for the next lek reservation instead of making another', async () => {
    const { tx, inserted } = database([{ ...hotelPlan }]);
    const first = await service.shadowRatePlanId(tx, 't', 'p', 'rt', 1, 'ALL');
    const second = await service.shadowRatePlanId(tx, 't', 'p', 'rt2', 2, 'ALL');
    expect(second).toBe(first);
    expect(inserted).toHaveLength(1);
  });
});
