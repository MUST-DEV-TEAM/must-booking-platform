import { describe, expect, it, vi } from 'vitest';

vi.mock('./notification-recipients', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  scheduledGuestSettings: async () => ({ enabled: settings.enabled, daysOffset: 0 }),
}));
const settings = vi.hoisted(() => ({ enabled: true }));

import { ScheduledEmailService } from './scheduled-email.service';

function setup(ids: string[]) {
  const guest = vi.fn().mockResolvedValue(undefined);
  const tx = { $queryRaw: async () => ids.map((id) => ({ id })) };
  const database = {
    withTenantTransaction: async (_c: unknown, fn: (t: typeof tx) => unknown) => fn(tx),
  };
  const service = new ScheduledEmailService(
    database as never,
    {} as never,
    undefined,
    undefined,
    undefined,
    { guest } as never,
  );
  return { service, guest };
}

const context = { tenantId: 't', propertyId: 'p' };

describe('check-in day email', () => {
  it('sends one welcome per arriving order, once per booking', async () => {
    settings.enabled = true;
    const { service, guest } = setup(['b1', 'b2']);
    await service.sendCheckInDay(context, 'Europe/Tirane', '2027-07-12');
    expect(guest).toHaveBeenCalledTimes(2);
    expect(guest.mock.calls[0]![1]).toMatchObject({
      topic: 'check_in_day',
      key: 'check_in_day',
      idempotencyKey: 'check-in-day/b1',
      bookingId: 'b1',
    });
  });

  it('sends nothing when the hotel switched it off', async () => {
    settings.enabled = false;
    const { service, guest } = setup(['b1']);
    await service.sendCheckInDay(context, 'Europe/Tirane', '2027-07-12');
    expect(guest).not.toHaveBeenCalled();
  });
});
