import { describe, it, expect } from 'vitest';
import { reportDisplayEvidence, reportMissingReason } from './report-display';
describe('Report missing-evidence presentation', () => {
  it('keeps actual zero/false and exact money, hides null aggregates and definitions', () => {
    expect(
      reportDisplayEvidence({
        zero: 0,
        flag: false,
        price: '9007199254740993.99',
        missing: null,
        basis: 'definition',
        nested: [{ value: null, known: 2 }],
      }),
    ).toEqual({ zero: 0, flag: false, price: '9007199254740993.99', nested: [{ known: 2 }] });
  });
  it('collapses absent history without hiding any actual observed comparison', () => {
    expect(
      reportDisplayEvidence({
        pickup: [{ days: 1, status: 'No history yet' }],
        pace: { status: 'No history yet' },
      }),
    ).toEqual({
      status: 'Daily history is still accumulating; no earlier snapshot for these dates',
    });
    expect(
      reportDisplayEvidence({ pickup: [{ days: 1, sold: 0 }], pace: { status: 'No history yet' } }),
    ).toEqual({
      pickup: [{ days: 1, sold: 0 }],
      pace: { status: 'No earlier daily snapshot for these dates' },
    });
  });
  it('distinguishes Clock ownership, absent historical capacity, prices and cancellation evidence', () => {
    expect(reportMissingReason('occupancy', 'CLOCK')).toBe('Managed in Clock');
    expect(reportMissingReason('occupancy')).toBe('Historical capacity not recorded');
    expect(reportMissingReason('adr')).toBe('Nightly price not recorded');
    expect(reportMissingReason('cancelledAt')).toBe('Cancellation details not recorded');
    expect(reportMissingReason('room')).toBe('No individual room assigned');
  });
});
