import { describe, expect, it } from 'vitest';

import { BOOKINGS_IMPORT_VERSION, buildSyncSummary, type SyncJobRow } from './clock-sync-progress';

const now = new Date('2026-10-26T16:00:00Z');
const job = (over: Partial<SyncJobRow> & { resource: string }): SyncJobRow => ({
  status: 'READY',
  processed: 0,
  total: null,
  lastSyncedAt: null,
  lastError: null,
  createdAt: '2026-10-26T14:00:00Z',
  startedAt: null,
  progressTotal: null,
  initialComplete: false,
  snapshotTotal: null,
  ...over,
});

describe('buildSyncSummary', () => {
  it('measures the pace and the time left for the reservation import', () => {
    const summary = buildSyncSummary(
      [
        job({
          resource: 'bookings',
          processed: 1000,
          total: 15926,
          startedAt: '2026-10-26T14:00:00Z',
        }),
      ],
      now,
    );
    const bookings = summary.groups.find((g) => g.key === 'bookings')!;
    expect(bookings.total).toBe(15926);
    expect(bookings.done).toBe(1000);
    expect(bookings.remaining).toBe(14926);
    // 1000 in 120 minutes is 8.3 a minute, so about 29 hours are left.
    expect(bookings.ratePerMinute).toBeCloseTo(8.3, 1);
    expect(bookings.etaSeconds).toBeGreaterThan(29 * 3600 * 0.95);
    expect(bookings.etaSeconds).toBeLessThan(31 * 3600);
    expect(bookings.state).toBe('running');
  });

  it('gives no estimate before anything has been measured', () => {
    const bookings = buildSyncSummary(
      [job({ resource: 'bookings', total: 500, processed: 0 })],
      now,
    ).groups.find((g) => g.key === 'bookings')!;
    expect(bookings.etaSeconds).toBeNull();
    expect(bookings.ratePerMinute).toBeNull();
    expect(bookings.state).toBe('waiting');
  });

  it('shows the finished pass once the first full import is complete', () => {
    const bookings = buildSyncSummary(
      [
        job({
          resource: 'bookings',
          status: 'SYNCED',
          initialComplete: true,
          importVersion: BOOKINGS_IMPORT_VERSION,
          snapshotTotal: 15926,
          processed: 3,
          total: 3,
          lastSyncedAt: '2026-10-26T15:59:00Z',
        }),
      ],
      now,
    ).groups.find((g) => g.key === 'bookings')!;
    expect(bookings.state).toBe('done');
    expect(bookings.total).toBe(15926);
    expect(bookings.done).toBe(15926);
    expect(bookings.remaining).toBe(0);
  });

  it('counts guest profiles from the size kept in the job progress', () => {
    const guests = buildSyncSummary(
      [
        job({
          resource: 'guests',
          processed: 50,
          progressTotal: 1000,
          startedAt: '2026-10-26T15:00:00Z',
        }),
      ],
      now,
    ).groups.find((g) => g.key === 'guests')!;
    expect(guests.total).toBe(1000);
    expect(guests.remaining).toBe(950);
    expect(guests.ratePerMinute).toBeCloseTo(0.8, 1);
  });

  it('counts bills and availability months by what has been synchronized', () => {
    const summary = buildSyncSummary(
      [
        job({ resource: 'financial:a', status: 'SYNCED', lastSyncedAt: '2026-10-26T15:00:00Z' }),
        job({ resource: 'financial:b' }),
        job({
          resource: 'availability:2026-10',
          status: 'SYNCED',
          lastSyncedAt: '2026-10-26T15:30:00Z',
        }),
        job({ resource: 'availability:2026-11' }),
      ],
      now,
    );
    const money = summary.groups.find((g) => g.key === 'money')!;
    const availability = summary.groups.find((g) => g.key === 'availability')!;
    expect(money).toMatchObject({ total: 2, done: 1, remaining: 1 });
    expect(availability).toMatchObject({ total: 2, done: 1, remaining: 1 });
  });

  it('reports an error and the longest estimate overall', () => {
    const summary = buildSyncSummary(
      [
        job({ resource: 'catalog', status: 'FAILED', lastError: 'Needs review' }),
        job({
          resource: 'bookings',
          processed: 100,
          total: 1000,
          startedAt: '2026-10-26T15:00:00Z',
        }),
      ],
      now,
    );
    expect(summary.overall.state).toBe('error');
    expect(summary.groups.find((g) => g.key === 'catalog')!.lastError).toBe('Needs review');
    expect(summary.overall.etaSeconds).toBeGreaterThan(0);
  });

  it('is done when every part is done', () => {
    const summary = buildSyncSummary(
      [
        job({ resource: 'catalog', status: 'SYNCED', lastSyncedAt: '2026-10-26T15:00:00Z' }),
        job({ resource: 'rooms', status: 'SYNCED', lastSyncedAt: '2026-10-26T15:00:00Z' }),
        job({ resource: 'rates', status: 'SYNCED', lastSyncedAt: '2026-10-26T15:00:00Z' }),
        job({
          resource: 'availability:2026-10',
          status: 'SYNCED',
          lastSyncedAt: '2026-10-26T15:00:00Z',
        }),
        job({
          resource: 'bookings',
          status: 'SYNCED',
          initialComplete: true,
          importVersion: BOOKINGS_IMPORT_VERSION,
          snapshotTotal: 10,
          lastSyncedAt: '2026-10-26T15:00:00Z',
        }),
        job({
          resource: 'guests',
          status: 'SYNCED',
          initialComplete: true,
          snapshotTotal: 5,
          lastSyncedAt: '2026-10-26T15:00:00Z',
        }),
        job({ resource: 'financial:a', status: 'SYNCED', lastSyncedAt: '2026-10-26T15:00:00Z' }),
      ],
      now,
    );
    expect(summary.overall).toMatchObject({ state: 'done', percent: 100, etaSeconds: null });
  });

  it('shows the guest profiles really held, not the size of the last small catch-up pass', () => {
    const guests = buildSyncSummary(
      [
        job({
          resource: 'guests',
          status: 'SYNCED',
          initialComplete: true,
          snapshotTotal: 0,
          lastSyncedAt: '2026-10-26T15:59:00Z',
        }),
      ],
      now,
      { guestProfiles: 13750 },
    ).groups.find((g) => g.key === 'guests')!;
    expect(guests.total).toBe(13750);
    expect(guests.done).toBe(13750);
    expect(guests.state).toBe('done');
  });

  it('says in one sentence what each part holds', () => {
    const summary = buildSyncSummary(
      [
        job({ resource: 'catalog', status: 'SYNCED', lastSyncedAt: '2026-10-26T15:00:00Z' }),
        job({ resource: 'availability:2026-10' }),
        job({ resource: 'availability:2026-11' }),
        job({ resource: 'bookings', processed: 10, total: 100, startedAt: '2026-10-26T15:00:00Z' }),
        job({ resource: 'financial:a', status: 'SYNCED', lastSyncedAt: '2026-10-26T15:00:00Z' }),
      ],
      now,
      {
        guestProfiles: 13750,
        roomTypes: 13,
        rooms: 150,
        rates: 26,
        bookingsByStatus: { CONFIRMED: 302, CANCELLED: 100 },
        earliestStay: '2024-05-01',
      },
    );
    const detail = (key: string) => summary.groups.find((g) => g.key === key)!.detail;
    expect(detail('catalog')).toBe('13 room types, 150 rooms and 26 rates.');
    expect(detail('availability')).toBe('2 months of free rooms for 13 room types.');
    expect(detail('bookings')).toBe(
      '402 reservations held: 302 confirmed, 100 cancelled; the earliest stay is 2024-05-01.',
    );
    expect(detail('guests')).toBe('13,750 guest profiles held.');
    expect(detail('money')).toBe('1 bill checked of 1 current and recent reservations.');
  });

  it('counts a pass made by an older version of the import as not finished, so everything is read again', () => {
    const bookings = buildSyncSummary(
      [
        job({
          resource: 'bookings',
          status: 'READY',
          initialComplete: true,
          importVersion: BOOKINGS_IMPORT_VERSION - 1,
          snapshotTotal: 15926,
          processed: 100,
          total: 15926,
          startedAt: '2026-10-26T15:00:00Z',
        }),
      ],
      now,
    ).groups.find((g) => g.key === 'bookings')!;
    expect(bookings.state).toBe('running');
    expect(bookings.total).toBe(15926);
    expect(bookings.done).toBe(100);
  });
});
