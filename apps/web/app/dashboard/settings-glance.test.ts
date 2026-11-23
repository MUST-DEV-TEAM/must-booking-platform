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
  // Nothing read from the other pages yet: the card is there, the value is empty (drawn as a dash).
  expect(value('taxes-fees', 'Taxes and fees')).toBeNull();
  expect(value('plan-usage', 'Plan')).toBeNull();
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

it('fills the taxes, team, plan and audit cards from what the other pages know', () => {
  const cards = settingsGlance(property, [], [], {
    taxes: { names: ['VAT', 'City tax', 'Service', 'Resort fee'], clock: false },
    team: { active: 5, suspended: 1 },
    plan: {
      plan: {
        name: 'Basic',
        maxProperties: 2,
        maxStaffSeats: 8,
        pmsEnabled: true,
        maxPmsConnectionsPerProperty: 1,
        readOnly: false,
        diningEnabled: false,
        maxVenues: null,
      },
      usage: { properties: 1, staffSeats: 5, venues: 0 },
    },
    audit: { title: 'Policies saved', actor: 'Ana Hotel', at: '2026-11-23T10:00:00Z' },
  });
  const card = (tab: string) => cards.find((c) => c.tab === tab)!;
  const value = (tab: string, label: string) =>
    card(tab).items.find((item) => item.label === label)?.value;
  expect(card('taxes-fees').badge).toEqual({ label: '4 active', tone: 'success' });
  expect(value('taxes-fees', 'Taxes and fees')).toBe('VAT, City tax, Service and 1 more');
  expect(value('team', 'Staff')).toBe('5 active');
  expect(value('team', 'Suspended')).toBe('1');
  expect(card('plan-usage').badge).toEqual({ label: 'Active', tone: 'success' });
  expect(value('plan-usage', 'Plan')).toBe('Basic');
  expect(value('plan-usage', 'Staff accounts')).toBe('5 of 8');
  expect(value('audit-log', 'Last change')).toBe('Policies saved');
  expect(value('audit-log', 'By')).toBe('Ana Hotel');
});

it('says taxes are calculated in Clock for a Clock hotel', () => {
  const cards = settingsGlance(property, [], [], { taxes: { names: [], clock: true } });
  const tax = cards.find((c) => c.tab === 'taxes-fees')!;
  expect(tax.badge.label).toBe('In Clock');
  expect(tax.items.find((i) => i.label === 'Taxes and fees')?.value).toBe('Calculated in Clock');
});
