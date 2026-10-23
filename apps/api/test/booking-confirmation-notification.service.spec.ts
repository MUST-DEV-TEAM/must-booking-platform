import type { StaffRecipient } from '../src/mail/notification-recipients';
import { describe, expect, it, vi } from 'vitest';

import { BookingConfirmationNotificationService } from '../src/mail/booking-confirmation-notification.service';

const context = {
  tenantId: '497c67b2-ea9a-4c11-a3ec-8a4b2f1d20fe',
  propertyId: 'cbe6ca3f-0727-450e-82aa-45a3c7d12b48',
};
const bookingId = '5b4c206f-6a4c-4d53-b6f2-ec4b3b5a4e07';

const bookingRow = {
  email: 'guest@example.test',
  firstName: 'Ada',
  lastName: 'Guest',
  phone: '+355 69 123 4567',
  guestSessionId: 'c0117c58-e2dc-4501-8081-024c8a73cc3d',
  guestReturnUrl: 'https://hotel.example.test/booking-confirmation',
  amount: '180.00',
  currency: 'EUR',
  externalReference: 'MUST-TEST-001',
  specialRequests: 'Late arrival',
  startsOn: '2027-09-01',
  endsOn: '2027-09-03',
  roomName: 'Ocean Suite',
  guestCount: 2,
  propertyName: 'Ocean Hotel',
  logoUrl: 'https://ocean.example.test/logo.png',
  supportEmail: 'stay@ocean.example.test',
  propertyPhone: '+355 69 123 4567',
  publicWebsiteOrigin: 'https://ocean.example.test',
  propertyAddress: '1 Ocean Road',
  orderReference: null as string | null,
};

function createService(
  staff: StaffRecipient[],
  order?: { orderReference: string; rooms: unknown[] },
) {
  const queryRaw = vi
    .fn()
    .mockResolvedValueOnce([{ ...bookingRow, orderReference: order?.orderReference ?? null }]);
  if (order) queryRaw.mockResolvedValueOnce(order.rooms);
  // Staff recipients: no saved settings for the topic, then the default list.
  queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce(staff);
  const database = {
    withTenantTransaction: vi.fn(
      async (_context: unknown, callback: (tx: { $queryRaw: typeof queryRaw }) => unknown) =>
        callback({ $queryRaw: queryRaw }),
    ),
  };
  const cancellations = { create: vi.fn(() => 'cancellation-token') };
  const notifications = {
    sendPaymentConfirmationEmailSafely: vi.fn(),
    sendNewBookingStaffNotificationSafely: vi.fn(),
  };
  return {
    service: new BookingConfirmationNotificationService(
      database as never,
      cancellations as never,
      notifications as never,
    ),
    notifications,
  };
}

describe('BookingConfirmationNotificationService', () => {
  it('sends one staff envelope while keeping the private guest cancellation link only in the guest command', async () => {
    const { service, notifications } = createService([
      { staffUserId: 'owner', email: 'to@example.test', channel: 'TO' },
      { staffUserId: 'copy', email: 'copy@example.test', channel: 'CC' },
      { staffUserId: 'private', email: 'private@example.test', channel: 'BCC' },
    ]);
    await service.sendAfterConfirmation(context, bookingId, 'payment-group');
    expect(notifications.sendNewBookingStaffNotificationSafely).toHaveBeenCalledOnce();
    const staff = notifications.sendNewBookingStaffNotificationSafely.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(staff.recipientEnvelope).toEqual({
      to: ['to@example.test'],
      cc: ['copy@example.test'],
      bcc: ['private@example.test'],
    });
    expect(JSON.stringify(staff)).not.toContain('cancellation-token');
    const guest = notifications.sendPaymentConfirmationEmailSafely.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(guest.cancellationUrl).toContain('token=cancellation-token');
    expect(guest.recipientEnvelope).toBeUndefined();
  });
  it('continues guest confirmation if current staff recipients leave no valid To recipient', async () => {
    const { service, notifications } = createService([
      { staffUserId: 'copy', email: 'copy@example.test', channel: 'CC' },
    ]);
    await expect(
      service.sendAfterConfirmation(context, bookingId, 'no-staff-to'),
    ).resolves.toBeUndefined();
    expect(notifications.sendPaymentConfirmationEmailSafely).toHaveBeenCalledOnce();
    expect(notifications.sendNewBookingStaffNotificationSafely).not.toHaveBeenCalled();
  });
  it('sends the staff-specific booking details to every assigned property staff member', async () => {
    const { service, notifications } = createService([
      { staffUserId: 'staff-1', email: 'front-desk@example.test' },
      { staffUserId: 'staff-2', email: 'manager@example.test' },
    ]);

    await service.sendAfterConfirmation(context, bookingId, 'payment-1');

    expect(notifications.sendPaymentConfirmationEmailSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId,
        to: 'guest@example.test',
        brand: {
          name: 'Ocean Hotel',
          logoUrl: 'https://ocean.example.test/logo.png',
          supportEmail: 'stay@ocean.example.test',
          phone: '+355 69 123 4567',
          websiteUrl: 'https://ocean.example.test',
          address: '1 Ocean Road',
        },
        guestCount: 2,
        cancellationUrl: expect.stringContaining('token=cancellation-token'),
      }),
      context,
    );
    expect(notifications.sendNewBookingStaffNotificationSafely).toHaveBeenCalledTimes(2);
    expect(notifications.sendNewBookingStaffNotificationSafely).toHaveBeenCalledWith(
      {
        bookingId,
        bookingReference: 'MUST-TEST-001',
        paymentId: 'payment-1',
        staffUserId: 'staff-1',
        to: 'front-desk@example.test',
        guest: { name: 'Ada Guest', email: 'guest@example.test', phone: '+355 69 123 4567' },
        stay: { startsOn: '2027-09-01', endsOn: '2027-09-03' },
        roomName: 'Ocean Suite',
        amount: { amount: '180.00', currency: 'EUR' },
        brand: {
          name: 'Ocean Hotel',
          logoUrl: 'https://ocean.example.test/logo.png',
          supportEmail: 'stay@ocean.example.test',
          phone: '+355 69 123 4567',
          websiteUrl: 'https://ocean.example.test',
          address: '1 Ocean Road',
        },
        guestCount: 2,
        paymentMethod: 'stripe',
        nightlyRates: undefined,
        specialRequests: 'Late arrival',
      },
      context,
    );
  });

  it('does not send a staff email when the property has no staff assignments', async () => {
    const { service, notifications } = createService([]);

    await service.sendAfterConfirmation(context, bookingId, 'payment-1');

    expect(notifications.sendPaymentConfirmationEmailSafely).toHaveBeenCalledTimes(1);
    expect(notifications.sendNewBookingStaffNotificationSafely).not.toHaveBeenCalled();
  });

  it('sends one guest and one staff email per multi-room order, listing every room', async () => {
    const { service, notifications } = createService(
      [{ staffUserId: 'staff-1', email: 'front-desk@example.test' }],
      {
        orderReference: 'MUST-ORDER-001',
        rooms: [
          { roomName: 'Ocean Suite', guestCount: 2, amount: '180.00', orderTotal: '300.00' },
          { roomName: 'Garden Room', guestCount: 1, amount: '120.00', orderTotal: '300.00' },
        ],
      },
    );

    await service.sendAfterConfirmation(context, bookingId, 'payment-1');

    const rooms = [
      { roomName: 'Ocean Suite', guestCount: 2, amount: { amount: '180.00', currency: 'EUR' } },
      { roomName: 'Garden Room', guestCount: 1, amount: { amount: '120.00', currency: 'EUR' } },
    ];
    expect(notifications.sendPaymentConfirmationEmailSafely).toHaveBeenCalledTimes(1);
    expect(notifications.sendPaymentConfirmationEmailSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingReference: 'MUST-ORDER-001',
        amount: { amount: '300.00', currency: 'EUR' },
        roomName: '2 rooms',
        guestCount: 3,
        nightlyRates: undefined,
        rooms,
      }),
      context,
    );
    expect(notifications.sendNewBookingStaffNotificationSafely).toHaveBeenCalledTimes(1);
    expect(notifications.sendNewBookingStaffNotificationSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingReference: 'MUST-ORDER-001',
        amount: { amount: '300.00', currency: 'EUR' },
        rooms,
      }),
      context,
    );
  });
});
