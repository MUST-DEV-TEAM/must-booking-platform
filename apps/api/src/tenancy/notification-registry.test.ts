import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_PRIORITIES,
  NOTIFICATION_REGISTRY,
  registeredNotificationTypes,
} from './notification-registry';
describe('registered in-app alert routing', () => {
  it('fails closed for empty or unknown permissions', () => {
    expect(registeredNotificationTypes([])).toEqual([]);
    expect(registeredNotificationTypes(['invented.view'])).toEqual([]);
  });
  it('separates booking, payment and staff audiences', () => {
    expect(registeredNotificationTypes(['bookings.view'])).toEqual([
      'BOOKING_CREATED',
      'BOOKING_NEEDS_ATTENTION',
    ]);
    expect(registeredNotificationTypes(['payments.view'])).toEqual(['PAYMENT_REFUNDED']);
    expect(registeredNotificationTypes(['staff.view'])).toEqual(['STAFF_SEAT_CAP_REACHED']);
  });
  it('owner/admin breadth includes only registered real producers', () => {
    expect(registeredNotificationTypes([], true)).toEqual(Object.keys(NOTIFICATION_REGISTRY));
    expect(registeredNotificationTypes([], true)).toHaveLength(7);
  });
  it('keeps all design categories/priorities without fabricating producers', () => {
    expect(NOTIFICATION_CATEGORIES).toHaveLength(5);
    expect(NOTIFICATION_PRIORITIES).toHaveLength(4);
    expect(
      Object.values(NOTIFICATION_REGISTRY).every(
        (r) =>
          NOTIFICATION_CATEGORIES.includes(r.category) &&
          NOTIFICATION_PRIORITIES.includes(r.priority),
      ),
    ).toBe(true);
  });
});
