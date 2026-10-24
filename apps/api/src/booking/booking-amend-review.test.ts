import { it, expect, vi } from 'vitest';
import { BookingAmendService } from './booking-amend.service';
const c = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    propertyId: '22222222-2222-4222-8222-222222222222',
    userId: '33333333-3333-4333-8333-333333333333',
  },
  id = '44444444-4444-4444-8444-444444444444';
it.each([true, false])(
  'preserves the original notification decision during recovery: %s',
  async (notifyGuest) => {
    const command = { bookingId: id, idempotencyKey: 'original-key', notifyGuest },
      previous = { startsOn: '2027-01-12', endsOn: '2027-01-14', roomTypeId: 'original-type' };
    const db = {
      withTenantTransaction: async (_c: unknown, fn: (tx: unknown) => Promise<unknown>) =>
        fn({ $queryRaw: async () => [{ command, previous }] }),
    };
    const amend = vi.fn().mockResolvedValue({ ok: true, value: { id } }),
      email = vi.fn();
    const service = new BookingAmendService(
      db as never,
      { forProperty: async () => ({ amendBookingStay: amend }) } as never,
      { effective: async () => ['bookings.edit'] } as never,
      {} as never,
      {} as never,
      { sendBookingChanged: email } as never,
    );
    await expect(service.checkAmendment(c, id)).resolves.toMatchObject({ ok: true });
    expect(amend).toHaveBeenCalledWith(c, command);
    if (notifyGuest) expect(email).toHaveBeenCalledWith(c, id, previous);
    else expect(email).not.toHaveBeenCalled();
  },
);

it('forwards a selected room type through both preview and final staff confirmation', async () => {
  const roomTypeId = '55555555-5555-4555-8555-555555555555';
  const db = {
    withTenantTransaction: async (_c: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        $queryRaw: async (strings: TemplateStringsArray) =>
          strings[0].includes('external_booking_id IS NOT NULL')
            ? [{ external: true }]
            : [{ startsOn: '2030-07-10', endsOn: '2030-07-12', roomTypeId: 'old-type' }],
      }),
  };
  const preview = vi.fn().mockResolvedValue({ ok: true, value: { roomTypeId } }),
    amend = vi.fn().mockResolvedValue({ ok: true, value: { id } });
  const service = new BookingAmendService(
    db as never,
    {
      forProperty: async () => ({ previewStayAmendment: preview, amendBookingStay: amend }),
    } as never,
    { effective: async () => ['bookings.edit'] } as never,
    {} as never,
    {} as never,
    { sendBookingChanged: vi.fn() } as never,
  );
  const dates = { startsOn: '2030-07-10', endsOn: '2030-07-13', roomTypeId };
  await service.preview(c, id, dates);
  expect(preview).toHaveBeenCalledWith(c, { bookingId: id, ...dates });
  await service.amend(
    c,
    id,
    {
      ...dates,
      expectedVersion: 1,
      previewHash: 'reviewed',
      reason: 'Guest requested upgrade',
      termsReviewed: true,
    },
    'new-room-type',
  );
  expect(amend).toHaveBeenCalledWith(c, expect.objectContaining({ ...dates, termsReviewed: true }));
});
