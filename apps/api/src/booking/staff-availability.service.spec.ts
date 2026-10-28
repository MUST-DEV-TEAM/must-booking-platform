import { describe, expect, it, vi } from 'vitest';
import { StaffAvailabilityService } from './staff-availability.service';
const t = '11111111-1111-4111-8111-111111111111',
  r1 = '22222222-2222-4222-8222-222222222222',
  r2 = '33333333-3333-4333-8333-333333333333';
const scope = { tenantId: 'tenant', propertyId: 'property' },
  input = {
    startsOn: '2027-01-01',
    endsOn: '2027-01-03',
    adults: 2,
    children: 0,
    items: [
      { key: r1, roomTypeId: t, roomId: r1 },
      { key: r2, roomTypeId: t, roomId: r2 },
    ],
  };
function setup(clock = true) {
  const db = {
    withTenantTransaction: vi.fn(async (_s, fn) =>
      fn({ $queryRaw: vi.fn().mockResolvedValue([{ id: t, max: 2, rooms: [r1, r2] }]) }),
    ),
  };
  const quotes = {
    displayPrices: vi.fn().mockResolvedValue(
      input.items.map((i) => ({
        ...i,
        available: true,
        total: { amount: '100.00', currency: 'EUR' },
      })),
    ),
    priceWithNightlyRates: vi
      .fn()
      .mockResolvedValue({ total: { amount: '120.00', currency: 'EUR' } }),
  };
  const availability = {
    evaluateRules: vi.fn().mockResolvedValue({ booking: { valid: true, errors: [] } }),
  };
  const connections = {
    activePmsConnectionCredentials: vi
      .fn()
      .mockResolvedValue(clock ? { provider: 'CLOCK_PMS' } : null),
  };
  const pms = { unavailableRoomsForBooking: vi.fn().mockResolvedValue({ ok: true, value: [r2] }) };
  return {
    service: new StaffAvailabilityService(
      db as never,
      quotes as never,
      availability as never,
      connections as never,
      pms as never,
    ),
    quotes,
    availability,
    pms,
  };
}
describe('bounded staff availability', () => {
  it('uses one Clock price batch and one physical conflict read for all selected rooms', async () => {
    const { service, quotes, pms, availability } = setup();
    const result = await service.search(scope, input);
    expect(quotes.displayPrices).toHaveBeenCalledTimes(1);
    expect(pms.unavailableRoomsForBooking).toHaveBeenCalledTimes(1);
    expect(result.offers[r1].ok).toBe(true);
    expect(result.offers[r2].ok).toBe(false);
    expect(availability.evaluateRules).not.toHaveBeenCalled();
  });
  it('preserves local stock validation and staff pricing without asking Clock', async () => {
    const { service, quotes, pms, availability } = setup(false);
    availability.evaluateRules.mockResolvedValueOnce({
      booking: { valid: false, errors: [{ message: 'Sold out' }] },
    });
    const result = await service.search(scope, input);
    expect(result.offers[r1]).toEqual({ ok: false, reason: 'Sold out' });
    expect(result.offers[r2]).toEqual({ ok: true, total: { amount: '120.00', currency: 'EUR' } });
    expect(quotes.priceWithNightlyRates).toHaveBeenCalledWith(
      'tenant',
      'property',
      expect.objectContaining({ roomId: r2 }),
      'staff',
    );
    expect(pms.unavailableRoomsForBooking).not.toHaveBeenCalled();
  });
  it('filters wrong room/type selections and occupancy before quoting', async () => {
    const { service, quotes } = setup(false);
    const result = await service.search(scope, { ...input, adults: 3 });
    expect(Object.values(result.offers).every((o) => !o.ok)).toBe(true);
    expect(quotes.displayPrices).not.toHaveBeenCalled();
  });
  it('leaves guest limits to Clock instead of the local room-type capacity', async () => {
    const { service, quotes } = setup();
    await service.search(scope, { ...input, adults: 3 });
    expect(quotes.displayPrices).toHaveBeenCalledTimes(1);
  });
  it('does not turn a failed physical-room read into available rooms', async () => {
    const { service, pms } = setup();
    pms.unavailableRoomsForBooking.mockResolvedValue({
      ok: false,
      error: { message: 'Clock temporarily unavailable' },
    } as never);
    await expect(service.search(scope, input)).rejects.toThrow('Clock temporarily unavailable');
  });
});
