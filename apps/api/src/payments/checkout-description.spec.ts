import { describe, expect, it } from 'vitest';
import { formatCheckoutDescription, loadCheckoutDescription } from './checkout-description';

describe('formatCheckoutDescription', () => {
  it('names the hotel, the booking reference and the stay', () => {
    expect(
      formatCheckoutDescription({
        hotelName: 'Empire Beach Resort',
        reference: 'MUST-ABC123',
        startsOn: '2026-12-01',
        endsOn: '2026-12-04',
      }),
    ).toBe('Empire Beach Resort - Booking MUST-ABC123 - 2026-12-01 to 2026-12-04');
  });

  it('leaves out a missing reference', () => {
    expect(
      formatCheckoutDescription({
        hotelName: 'Luxury',
        reference: null,
        startsOn: '2026-12-01',
        endsOn: '2026-12-02',
      }),
    ).toBe('Luxury - 2026-12-01 to 2026-12-02');
  });
});

describe('loadCheckoutDescription', () => {
  const scope = { tenantId: 't', propertyId: 'p' };

  it('builds the text from the booking row', async () => {
    const tx = {
      $queryRaw: async () => [
        { hotelName: 'Must Hotel', reference: 'R1', startsOn: '2026-12-01', endsOn: '2026-12-03' },
      ],
    };
    await expect(loadCheckoutDescription(tx as never, scope, 'b')).resolves.toBe(
      'Must Hotel - Booking R1 - 2026-12-01 to 2026-12-03',
    );
  });

  it('returns undefined when there is no booking, so the provider default stays', async () => {
    const tx = { $queryRaw: async () => [] };
    await expect(loadCheckoutDescription(tx as never, scope, 'b')).resolves.toBeUndefined();
  });
});
