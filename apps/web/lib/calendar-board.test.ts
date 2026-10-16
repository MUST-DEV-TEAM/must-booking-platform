import { describe, expect, it } from 'vitest';

import { addDays, barGeometry, diffDays, occupiesNight, packLanes, windowDays } from './calendar-board';

describe('calendar board dates', () => {
  it('adds and measures days across month ends', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(diffDays('2026-10-30', '2026-11-02')).toBe(3);
    expect(windowDays('2026-10-30', 3)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
  });
});

describe('barGeometry', () => {
  it('starts and ends in the middle of the check-in and check-out days', () => {
    const bar = barGeometry('2026-10-12', '2026-10-15', '2026-10-10', 10)!;
    expect(bar.left).toBeCloseTo(2.5 / 10);
    expect(bar.width).toBeCloseTo(3 / 10);
    expect(bar.cutAtStart).toBe(false);
    expect(bar.cutAtEnd).toBe(false);
  });

  it('is cut at both edges of the window', () => {
    const bar = barGeometry('2026-10-01', '2026-10-30', '2026-10-10', 7)!;
    expect(bar.left).toBe(0);
    expect(bar.width).toBe(1);
    expect(bar.cutAtStart).toBe(true);
    expect(bar.cutAtEnd).toBe(true);
  });

  it('is null when the stay is outside the window', () => {
    expect(barGeometry('2026-09-01', '2026-09-05', '2026-10-10', 7)).toBeNull();
    expect(barGeometry('2026-11-01', '2026-11-05', '2026-10-10', 7)).toBeNull();
  });

  it('does not draw a stay that ends on the first day of the window before its checkout time', () => {
    const bar = barGeometry('2026-10-08', '2026-10-10', '2026-10-10', 7)!;
    expect(bar.left).toBe(0);
    expect(bar.width).toBeCloseTo(0.5 / 7);
  });
});

describe('packLanes', () => {
  it('keeps back-to-back stays on one line and splits overlapping ones', () => {
    const packed = packLanes([
      { id: 'a', startsOn: '2026-10-10', endsOn: '2026-10-12' },
      { id: 'b', startsOn: '2026-10-12', endsOn: '2026-10-14' },
      { id: 'c', startsOn: '2026-10-11', endsOn: '2026-10-13' },
    ]);
    const lane = (id: string) => packed.find((entry) => entry.item.id === id)!.lane;
    expect(lane('a')).toBe(0);
    expect(lane('b')).toBe(0);
    expect(lane('c')).toBe(1);
  });
});

describe('occupiesNight', () => {
  it('counts the check-in night and not the check-out day', () => {
    expect(occupiesNight('2026-10-10', '2026-10-12', '2026-10-10')).toBe(true);
    expect(occupiesNight('2026-10-10', '2026-10-12', '2026-10-11')).toBe(true);
    expect(occupiesNight('2026-10-10', '2026-10-12', '2026-10-12')).toBe(false);
  });
});
