import { describe, expect, it } from 'vitest';

import { policyPreviewLines } from './policy-preview';

const times = { checkInTime: '15:00', checkOutTime: '11:00' };

describe('policyPreviewLines', () => {
  it('shows only the times when nothing else is set', () => {
    expect(policyPreviewLines({}, times, 'EUR', 'en')).toEqual([
      'Check-in from 15:00.',
      'Check-out by 11:00.',
    ]);
    expect(policyPreviewLines({}, {}, 'EUR', 'en')).toEqual([]);
  });

  it('includes the windows and the late-arrival instructions', () => {
    const lines = policyPreviewLines(
      { checkInUntil: '22:00', checkOutFrom: '07:00', lateArrivalInstructions: 'Ring the bell.' },
      times,
      'EUR',
      'en',
    );
    expect(lines).toEqual([
      'Check-in from 15:00 until 22:00.',
      'Check-out from 07:00 until 11:00.',
      'Ring the bell.',
    ]);
  });

  it('writes prices in the hotel currency and leaves out a price that is not typed yet', () => {
    const paid = policyPreviewLines(
      { cotsPolicy: 'paid', cotsFee: '10', cotsMax: '2' },
      {},
      'EUR',
      'en',
    );
    expect(paid[0]).toMatch(/^Cots cost .*10\.00.* per night \(up to 2 per room\)\.$/);
    expect(policyPreviewLines({ cotsPolicy: 'paid' }, {}, 'EUR', 'en')).toEqual([]);
    expect(
      policyPreviewLines({ extraBedsPolicy: 'free', extraBedsMax: '1' }, {}, 'EUR', 'en'),
    ).toEqual(['Extra beds are free (up to 1 per room).']);
  });

  it('says assistance animals are welcome whenever pets are, and not when pets are refused', () => {
    expect(policyPreviewLines({ petsPolicy: 'not_allowed' }, {}, 'EUR', 'en')).toEqual([
      'Pets are not allowed.',
    ]);
    const lines = policyPreviewLines(
      { petsPolicy: 'allowed', petsFeeType: 'per_stay', petsFee: '20', petsMax: '2' },
      {},
      'EUR',
      'en',
    );
    expect(lines[0]).toMatch(/^Pets are allowed for .*20\.00.* per stay \(up to 2 per room\)\.$/);
    expect(lines.at(-1)).toBe('Assistance animals are always welcome.');
  });

  it('lists accepted documents only when ID is asked for', () => {
    expect(
      policyPreviewLines(
        { idAtArrival: 'all_adults', idDocuments: ['passport', 'national_id'] },
        {},
        'EUR',
        'en',
      ),
    ).toEqual(['All adults must show one of these at arrival: passport, national ID card.']);
    expect(
      policyPreviewLines(
        { idAtArrival: 'not_required', idDocuments: ['passport'] },
        {},
        'EUR',
        'en',
      ),
    ).toEqual([]);
  });

  it('describes the damage deposit only when it is complete', () => {
    expect(policyPreviewLines({ damageDepositAmount: '100' }, {}, 'EUR', 'en')).toEqual([]);
    const lines = policyPreviewLines(
      { damageDepositAmount: '100', damageDepositMethod: 'card', damageDepositRefundDays: '7' },
      {},
      'EUR',
      'en',
    );
    expect(lines[0]).toMatch(/damage deposit of .*100\.00.* by card .* within 7 days/);
  });

  it('has the same lines in Albanian', () => {
    const lines = policyPreviewLines(
      { smokingPolicy: 'not_allowed', partiesPolicy: 'on_request' },
      times,
      'EUR',
      'sq',
    );
    expect(lines).toEqual([
      'Hyrja nga ora 15:00.',
      'Dalja deri në orën 11:00.',
      'Duhani nuk lejohet.',
      'Festat dhe ngjarjet lejohen me kërkesë.',
    ]);
  });
});
