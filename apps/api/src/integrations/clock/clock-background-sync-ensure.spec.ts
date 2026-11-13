import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClockBackgroundSyncService } from './clock-background-sync.service';

// Milestone 38, task 2: the one-second loop seeds jobs at most once a minute per hotel.
const hotels = [
  { tenantId: 'tenant-1', propertyId: 'property-1', connectionId: 'connection-1' },
  { tenantId: 'tenant-1', propertyId: 'property-2', connectionId: 'connection-2' },
];

function setup() {
  const service = Object.create(ClockBackgroundSyncService.prototype) as unknown as {
    tick: () => Promise<void>;
    ensure: ReturnType<typeof vi.fn>;
    claim: ReturnType<typeof vi.fn>;
  };
  const ensure = vi.fn(async () => undefined);
  const claim = vi.fn(async () => null);
  Object.assign(service, {
    busy: false,
    timer: undefined,
    lastEnsuredAt: new Map<string, number>(),
    logger: { warn: vi.fn() },
    db: { $queryRaw: vi.fn(async () => hotels) },
    ensure,
    claim,
  });
  return { service, ensure, claim };
}

describe('Clock sync loop seeding', () => {
  const previous = process.env.CLOCK_BACKGROUND_SYNC_ENABLED;
  beforeEach(() => {
    process.env.CLOCK_BACKGROUND_SYNC_ENABLED = 'true';
    delete process.env.CLOCK_SYNC_ALLOWED_PROPERTY_IDS;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-13T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    process.env.CLOCK_BACKGROUND_SYNC_ENABLED = previous;
  });

  it('calls ensure twice per hotel in 120 idle one-second ticks, but still claims every tick', async () => {
    const { service, ensure, claim } = setup();
    for (let second = 0; second < 120; second++) {
      await service.tick();
      vi.advanceTimersByTime(1000);
    }
    for (const hotel of hotels)
      expect(ensure.mock.calls.filter(([scope]) => scope === hotel)).toHaveLength(2);
    // Two lanes per hotel per tick: claiming due work is not throttled.
    expect(claim).toHaveBeenCalledTimes(120 * hotels.length * 2);
  });

  it('tries again on the next tick when seeding failed', async () => {
    const { service, ensure } = setup();
    ensure.mockRejectedValueOnce(new Error('database busy'));
    await service.tick();
    vi.advanceTimersByTime(1000);
    await service.tick();
    // First tick: hotel 1 failed and hotel 2 seeded. Second tick: only hotel 1 is retried.
    expect(ensure).toHaveBeenCalledTimes(3);
    expect(ensure.mock.calls[2]![0]).toBe(hotels[0]);
  });
});
