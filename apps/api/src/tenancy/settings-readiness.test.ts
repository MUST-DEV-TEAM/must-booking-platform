import { describe, expect, it } from 'vitest';

import { settingsReadiness, type ReadinessInput } from './settings-readiness';

const hotel: ReadinessInput = {
  name: 'Grand Hotel',
  address: 'Beach Road 1',
  timezone: 'Europe/Tirane',
  minStayNights: 2,
  maxStayNights: 7,
  checkInTime: '15:00',
  checkOutTime: '11:00',
  paymentGateways: { stripe: false, pokpay: false, payAtHotel: true },
  connectedProviders: [],
  wordpressConnectedAt: null,
  publicWebsiteOrigin: null,
};
const status = (input: ReadinessInput, key: string) =>
  settingsReadiness(input).steps.find((step) => step.key === key)!.status;

describe('settingsReadiness', () => {
  it('reports each step from the saved settings only', () => {
    const result = settingsReadiness(hotel);
    expect(result.ready).toBe(false);
    expect(result.steps.map((step) => [step.key, step.status])).toEqual([
      ['profile', 'done'],
      ['booking-rules', 'done'],
      ['policies', 'done'],
      ['payment-methods', 'done'],
      ['website', 'todo'],
    ]);
    expect(result.steps.find((step) => step.key === 'policies')?.note).toBe('From 15:00 to 11:00.');
  });

  it('needs the website to be paired and have an address before it is done', () => {
    const origin = { ...hotel, publicWebsiteOrigin: 'https://hotel.test' };
    expect(status(origin, 'website')).toBe('todo');
    const paired = { ...origin, wordpressConnectedAt: '2026-10-01' };
    expect(status(paired, 'website')).toBe('done');
    expect(settingsReadiness(paired).ready).toBe(true);
  });

  it('asks for guest contact details when a reader loads them, and leaves the step out otherwise', () => {
    const ready = {
      ...hotel,
      publicWebsiteOrigin: 'https://hotel.test',
      wordpressConnectedAt: '2026-10-01',
    };
    const noContact = { ...ready, supportEmail: null, phone: '+355691234567' };
    expect(status(noContact, 'contact')).toBe('todo');
    expect(settingsReadiness(noContact).ready).toBe(false);
    const contact = { ...noContact, supportEmail: 'stay@hotel.test' };
    expect(status(contact, 'contact')).toBe('done');
    expect(settingsReadiness(contact).ready).toBe(true);
    expect(settingsReadiness(ready).steps.some((step) => step.key === 'contact')).toBe(false);
  });

  it('recommends an own email provider without making it decide "ready"', () => {
    const ready = {
      ...hotel,
      publicWebsiteOrigin: 'https://hotel.test',
      wordpressConnectedAt: '2026-10-01',
    };
    const onMust = settingsReadiness({ ...ready, emailProviderActive: false });
    expect(onMust.steps.find((step) => step.key === 'email')).toMatchObject({
      status: 'todo',
      optional: true,
      tab: 'emails',
    });
    expect(onMust.ready).toBe(true);
    expect(status({ ...ready, emailProviderActive: true }, 'email')).toBe('done');
    expect(settingsReadiness(ready).steps.some((step) => step.key === 'email')).toBe(false);
  });

  it('counts an online method only when its provider is connected and enabled', () => {
    const online = {
      ...hotel,
      paymentGateways: { payAtHotel: false, stripe: true, pokpay: false },
    };
    expect(status(online, 'payment-methods')).toBe('attention');
    expect(status({ ...online, connectedProviders: ['STRIPE'] }, 'payment-methods')).toBe('done');
    expect(status({ ...online, connectedProviders: ['POKPAY'] }, 'payment-methods')).toBe(
      'attention',
    );
  });

  it('flags missing and inconsistent settings', () => {
    expect(status({ ...hotel, address: ' ' }, 'profile')).toBe('attention');
    expect(status({ ...hotel, minStayNights: 9 }, 'booking-rules')).toBe('attention');
    expect(status({ ...hotel, sameDayCutoffTime: '25:00' }, 'booking-rules')).toBe('attention');
    expect(status({ ...hotel, maxGuestsPerBooking: 0 }, 'booking-rules')).toBe('attention');
    expect(status({ ...hotel, checkOutTime: null }, 'policies')).toBe('todo');
    expect(status({ ...hotel, quietHoursFrom: '22:00' }, 'policies')).toBe('attention');
    expect(
      status({ ...hotel, earlyCheckInPolicy: 'free_until', earlyCheckInUntil: null }, 'policies'),
    ).toBe('attention');
  });
});
