import { describe, expect, it, vi } from 'vitest';

import { houseRuleLines } from './house-rules';

const scope = { tenantId: 't1', propertyId: 'p1' };
const txWith = (rows: unknown[]) => ({ $queryRaw: vi.fn(async () => rows) }) as never;

describe('houseRuleLines (G-55)', () => {
  it('gives sentences for the times and rules the hotel filled in', async () => {
    const lines = await houseRuleLines(
      txWith([
        {
          checkInTime: '14:00',
          checkOutTime: '11:00',
          currency: 'EUR',
          petsPolicy: 'not_allowed',
          quietHoursFrom: '23:00',
          quietHoursTo: '07:00',
        },
      ]),
      scope,
    );
    expect(lines).toContain('Check-in from 14:00.');
    expect(lines).toContain('Check-out by 11:00.');
    expect(lines).toContain('Pets are not allowed.');
    expect(lines).toContain('Quiet hours: 23:00 to 07:00.');
  });

  it('gives nothing when the hotel set nothing, or the hotel is unknown', async () => {
    expect(await houseRuleLines(txWith([{ currency: 'EUR' }]), scope)).toEqual([]);
    expect(await houseRuleLines(txWith([]), scope)).toEqual([]);
  });
});
