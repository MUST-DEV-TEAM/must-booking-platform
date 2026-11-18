import { beforeEach, describe, expect, it, vi } from 'vitest';

const enabled = vi.hoisted(() => ({ value: true }));

vi.mock('./notification-recipients', () => ({
  guestNotificationEnabled: vi.fn(async () => enabled.value),
}));
vi.mock('./email-templates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./email-templates')>()),
  savedTemplate: vi.fn(async () => null),
}));

import { BookingUpdateNotificationService } from './booking-update-notification.service';

const context = { tenantId: 't1', propertyId: 'p1' };
const stayRow = {
  id: 'b1',
  reference: 'MUST-1234',
  email: 'guest@example.test',
  firstName: 'Ana',
  lastName: 'Test',
  startsOn: '2030-07-10',
  endsOn: '2030-07-12',
  roomName: 'Sea view',
  guestCount: 2,
  roomTypeId: 'rt1',
  currency: 'EUR',
  nightlyRates: null,
};
const brand = {
  name: 'Hotel Test',
  brandColour: null,
  emailFooterText: null,
  termsUrl: null,
  logoUrl: null,
  supportEmail: 'help@hotel.test',
  phone: null,
  websiteUrl: 'https://hotel.test',
  address: null,
};

function setup(rows: unknown[] = [stayRow]) {
  const tx = {
    $queryRawUnsafe: vi.fn(async () => rows),
    $queryRaw: vi.fn(async () => [brand]),
  };
  const delivery = { dispatch: vi.fn().mockResolvedValue(undefined) };
  const service = new BookingUpdateNotificationService(
    { withTenantTransaction: vi.fn(async (_context, run) => run(tx)) } as never,
    delivery as never,
    {} as never,
  );
  return { service, delivery, tx };
}

beforeEach(() => {
  enabled.value = true;
});

describe('the "request received" email to a guest who asked to cancel', () => {
  it('sends one email, to the guest, with a key that repeats safely for the same request', async () => {
    const { service, delivery, tx } = setup();

    await service.sendCancellationRequestReceived(context, 'b1', 'req-1');

    expect(delivery.dispatch).toHaveBeenCalledTimes(1);
    const [kind, command] = delivery.dispatch.mock.calls[0]!;
    expect(kind).toBe('rendered');
    expect(command).toMatchObject({
      eventType: 'guest.cancellation_request_received',
      to: 'guest@example.test',
      bookingId: 'b1',
      idempotencyKey: 'cancellation-request-received/req-1',
      replyTo: 'help@hotel.test',
    });
    expect(command.subject).toBe('We received your cancellation request — MUST-1234');
    expect(command.text).toContain('stays active until the hotel confirms');
    // Only a confirmed booking is looked up, so a request on anything else sends nothing.
    expect(tx.$queryRawUnsafe.mock.calls[0]).toContain('CONFIRMED');
  });

  it('says what the hotel has to do and does not promise a cancellation or a refund', async () => {
    const { service, delivery } = setup();

    await service.sendCancellationRequestReceived(context, 'b1', 'req-1');

    const { text } = delivery.dispatch.mock.calls[0]![1];
    expect(text).toContain('reviews each request');
    expect(text.toLowerCase()).not.toContain('refund');
    expect(text.toLowerCase()).not.toContain('has been cancelled');
  });

  it('sends nothing when the hotel has switched the email off', async () => {
    enabled.value = false;
    const { service, delivery } = setup();

    await service.sendCancellationRequestReceived(context, 'b1', 'req-1');

    expect(delivery.dispatch).not.toHaveBeenCalled();
  });

  it('sends nothing when there is no eligible direct booking with an email address', async () => {
    const { service, delivery } = setup([]);

    await service.sendCancellationRequestReceived(context, 'b1', 'req-1');

    expect(delivery.dispatch).not.toHaveBeenCalled();
  });

  it('never fails the request when the email cannot be queued', async () => {
    const { service, delivery } = setup();
    delivery.dispatch.mockRejectedValue(new Error('queue down'));

    await expect(
      service.sendCancellationRequestReceived(context, 'b1', 'req-1'),
    ).resolves.toBeUndefined();
  });
});
