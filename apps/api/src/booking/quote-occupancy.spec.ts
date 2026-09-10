import { describe, expect, it } from 'vitest';

import { QuoteService } from './quote.service';

type QuotePayloadForTest = {
  version: 1;
  tenantId: string;
  propertyId: string;
  roomTypeId: string;
  ratePlanId: string;
  startsOn: string;
  endsOn: string;
  adults: number;
  children: number;
  guestCount: number;
  total: { amount: string; currency: string };
  expiresAt: string;
  sessionBinding: string;
  nightlyRates: Array<{ date: string; amount: string }>;
};

type QuoteSigningService = {
  sign(payload: QuotePayloadForTest): string;
  sessionBinding(sessionId: string): string;
};

const service = Object.create(QuoteService.prototype) as QuoteService;
const signer = service as unknown as QuoteSigningService;
const sessionId = 'guest-session-occupancy';
const expectedBooking = {
  tenantId: 'tenant-1',
  propertyId: 'property-1',
  roomTypeId: 'room-type-1',
  roomId: undefined,
  ratePlanId: 'rate-plan-1',
  startsOn: '2027-09-01',
  endsOn: '2027-09-03',
  total: { amount: '190.00', currency: 'EUR' },
};

function tokenFor(adults: number, children: number): string {
  return signer.sign({
    version: 1,
    ...expectedBooking,
    adults,
    children,
    guestCount: adults + children,
    expiresAt: '2999-01-01T00:00:00.000Z',
    sessionBinding: signer.sessionBinding(sessionId),
    nightlyRates: [
      { date: '2027-09-01', amount: '95.00' },
      { date: '2027-09-02', amount: '95.00' },
    ],
  });
}

describe('QuoteService occupancy binding', () => {
  it('rejects omitted create occupancy when the quote used a different breakdown', () => {
    expect(service.validate(tokenFor(2, 1), sessionId, expectedBooking)).toEqual({
      code: 'QUOTE_MISMATCH',
      message: 'The booking does not match the quoted stay or price.',
    });
  });

  it('accepts omitted create occupancy when the quote uses the legacy default', () => {
    expect(service.validate(tokenFor(1, 0), sessionId, expectedBooking)).toBeNull();
  });
});
