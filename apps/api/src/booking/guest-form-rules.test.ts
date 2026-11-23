import { describe, expect, it } from 'vitest';

import {
  ARRIVAL_TIME_RE,
  missingRequiredGuestField,
  type GuestFormPolicy,
} from './guest-form-rules';

const defaults: GuestFormPolicy = {
  formAddress: 'hidden',
  formArrivalTime: 'hidden',
  formSpecialRequests: 'optional',
  formCompany: 'hidden',
};
const guest = {
  email: 'a@example.com',
  firstName: 'Ana',
  lastName: 'Test',
  phone: '+355691234567',
  countryCode: 'AL',
};

describe('missingRequiredGuestField', () => {
  it('accepts a complete guest under the default form', () => {
    expect(missingRequiredGuestField(defaults, guest)).toBeNull();
  });

  it('does not enforce phone or country: every website asks for them and the API has always accepted a booking without', () => {
    expect(
      missingRequiredGuestField(defaults, { ...guest, phone: null, countryCode: null }),
    ).toBeNull();
  });

  it('never blocks an Optional or Hidden field, and a Hidden field may still carry a value', () => {
    const relaxed = { ...defaults, formArrivalTime: 'optional', formCompany: 'hidden' };
    expect(missingRequiredGuestField(relaxed, { ...guest })).toBeNull();
    expect(
      missingRequiredGuestField(relaxed, { ...guest, streetAddress: '1 Rruga', companyName: 'X' }),
    ).toBeNull();
  });

  it('requires street, city and postcode together when the address is Required', () => {
    const policy = { ...defaults, formAddress: 'required' };
    const message = 'Please complete your address (street, city and postcode).';
    expect(missingRequiredGuestField(policy, guest)).toBe(message);
    expect(
      missingRequiredGuestField(policy, { ...guest, streetAddress: '1 Rruga', city: 'Durres' }),
    ).toBe(message);
    expect(
      missingRequiredGuestField(policy, {
        ...guest,
        streetAddress: '1 Rruga',
        city: 'Durres',
        postcode: '2001',
      }),
    ).toBeNull();
  });

  it('requires an arrival time, special requests and a company name when each is Required', () => {
    expect(missingRequiredGuestField({ ...defaults, formArrivalTime: 'required' }, guest)).toBe(
      'Please tell us your expected arrival time.',
    );
    expect(missingRequiredGuestField({ ...defaults, formSpecialRequests: 'required' }, guest)).toBe(
      'Please fill in your special requests.',
    );
    expect(missingRequiredGuestField({ ...defaults, formCompany: 'required' }, guest)).toBe(
      'Please enter your company name.',
    );
    expect(
      missingRequiredGuestField(
        {
          ...defaults,
          formArrivalTime: 'required',
          formSpecialRequests: 'required',
          formCompany: 'required',
        },
        { ...guest, arrivalTime: '15:30', specialRequests: 'Late', companyName: 'Acme' },
      ),
    ).toBeNull();
  });

  it('falls back to the old behaviour for a missing or unknown value', () => {
    const broken = { ...defaults, formAddress: null, formArrivalTime: 'bogus', formCompany: null };
    expect(missingRequiredGuestField(broken, guest)).toBeNull();
  });
});

describe('ARRIVAL_TIME_RE', () => {
  it('accepts 24-hour times and refuses anything else', () => {
    for (const ok of ['00:00', '09:05', '15:30', '23:59'])
      expect(ARRIVAL_TIME_RE.test(ok)).toBe(true);
    for (const bad of ['24:00', '9:05', '15:60', '15.30', '', '15:30:00', 'noon'])
      expect(ARRIVAL_TIME_RE.test(bad)).toBe(false);
  });
});
