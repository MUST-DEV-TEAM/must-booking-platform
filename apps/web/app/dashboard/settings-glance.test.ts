import { expect, it } from 'vitest';

import type { Property, ReadinessStep } from './settings-areas';
import { settingsGlance } from './settings-overview';

const property = {
  id: 'p',
  name: 'Grand Hotel',
  address: '1 Main Street',
  timezone: 'Europe/Tirane',
  city: 'Durrës',
  country: 'AL',
  starRating: 4,
  propertyType: 'hotel',
  defaultCurrency: 'EUR',
  supportEmail: 'info@grand.test',
  phone: '+355690000000',
  logoUrl: 'https://x.test/logo.png',
  brandColour: '#0F3D5E',
  minStayNights: 1,
  maxStayNights: 30,
  advanceBookingDays: 365,
  allowSameDayBooking: true,
  sameDayCutoffTime: '20:00',
  bookingMode: 'ROOM_TYPE_ONLY',
  checkInTime: '14:00',
  checkOutTime: '11:00',
  freeCancellationDaysBeforeArrival: 7,
  autoRefundOnFreeCancellation: true,
  noShowRule: 'charge_first_night',
  onlinePaymentHoldMinutes: 30,
  paymentGateways: { stripe: true, pokpay: false, payAtHotel: true },
  connectedProviders: ['STRIPE'],
  pmsSource: 'CLOCK_PMS',
  wordpressConnectedAt: '2026-11-01',
  staffCount: 8,
  roomCount: 42,
} as unknown as Property;
const step = (key: ReadinessStep['key'], status: ReadinessStep['status']) =>
  ({ key, tab: 'profile', label: key, status, note: '' }) as ReadinessStep;

it('draws eleven cards with real values, a status pill each, and a dash where nothing is known yet', () => {
  const cards = settingsGlance(property, [
    step('profile', 'done'),
    step('contact', 'done'),
    step('booking-rules', 'done'),
    step('policies', 'done'),
    step('payment-methods', 'done'),
    step('website', 'done'),
    step('email', 'todo'),
  ]);
  expect(cards.map((card) => card.tab)).toEqual([
    'profile',
    'contact-brand',
    'booking-rules',
    'policies',
    'taxes-fees',
    'payment-methods',
    'integrations',
    'emails',
    'team',
    'plan-usage',
    'audit-log',
  ]);
  const value = (tab: string, label: string) =>
    cards.find((card) => card.tab === tab)!.items.find((item) => item.label === label)?.value;
  expect(value('profile', 'Hotel')).toBe('Grand Hotel · 4★');
  expect(value('profile', 'Type')).toBe('Hotel');
  expect(value('profile', 'Location')).toBe('Durrës, Albania');
  expect(value('contact-brand', 'Brand')).toBe('Logo and #0F3D5E');
  expect(value('policies', 'Check-in / out')).toBe('14:00 / 11:00');
  expect(value('policies', 'No-show')).toBe('First night charged');
  expect(value('team', 'Staff')).toBe('8 active');
  expect(value('plan-usage', 'Rooms')).toBe('42');
  // Not built yet: the card is there, the value is empty (drawn as a dash).
  expect(value('taxes-fees', 'City tax')).toBeNull();
  expect(value('audit-log', 'Last change')).toBeNull();
  expect(cards.find((card) => card.tab === 'profile')!.badge).toEqual({
    label: 'Complete',
    tone: 'success',
  });
  expect(cards.find((card) => card.tab === 'integrations')!.badge.label).toBe('2 active');
});

it('flags payments in test mode and emails that failed, from the live problems', () => {
  const cards = settingsGlance(
    property,
    [step('payment-methods', 'done'), step('email', 'todo')],
    [
      { key: 'payments-test:STRIPE', label: '', note: '', link: { tab: 'payment-methods' } },
      { key: 'email-failed', label: '4 emails not delivered', note: '', link: { tab: 'emails' } },
    ],
  );
  expect(cards.find((card) => card.tab === 'payment-methods')!.badge).toEqual({
    label: 'Test mode',
    tone: 'warning',
  });
  expect(cards.find((card) => card.tab === 'emails')!.badge.tone).toBe('warning');
});
