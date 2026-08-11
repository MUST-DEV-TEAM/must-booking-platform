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
};

function createService(staff: Array<{ staffUserId: string; email: string }>) {
  const queryRaw = vi.fn().mockResolvedValueOnce([bookingRow]).mockResolvedValueOnce(staff);
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
        cancellationUrl: expect.stringContaining('cancellationToken=cancellation-token'),
      }),
    );
    expect(notifications.sendNewBookingStaffNotificationSafely).toHaveBeenCalledTimes(2);
    expect(notifications.sendNewBookingStaffNotificationSafely).toHaveBeenCalledWith({
      bookingId,
      bookingReference: 'MUST-TEST-001',
      paymentId: 'payment-1',
      staffUserId: 'staff-1',
      to: 'front-desk@example.test',
      guest: { name: 'Ada Guest', email: 'guest@example.test', phone: '+355 69 123 4567' },
      stay: { startsOn: '2027-09-01', endsOn: '2027-09-03' },
      roomName: 'Ocean Suite',
      amount: { amount: '180.00', currency: 'EUR' },
      specialRequests: 'Late arrival',
    });
  });

  it('does not send a staff email when the property has no staff assignments', async () => {
    const { service, notifications } = createService([]);

    await service.sendAfterConfirmation(context, bookingId, 'payment-1');

    expect(notifications.sendPaymentConfirmationEmailSafely).toHaveBeenCalledTimes(1);
    expect(notifications.sendNewBookingStaffNotificationSafely).not.toHaveBeenCalled();
  });
});
