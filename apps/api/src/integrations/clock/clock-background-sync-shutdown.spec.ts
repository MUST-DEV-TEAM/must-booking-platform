import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClockBackgroundSyncService } from './clock-background-sync.service';

describe('ClockBackgroundSyncService shutdown', () => {
  beforeEach(() => {
    process.env.CLOCK_BACKGROUND_SYNC_ENABLED = 'true';
  });
  afterEach(() => {
    delete process.env.CLOCK_BACKGROUND_SYNC_ENABLED;
    vi.useRealTimers();
  });

  function setup() {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const queryRaw = vi.fn(async () => {
      await gate;
      return [];
    });
    const service = Object.create(
      ClockBackgroundSyncService.prototype,
    ) as ClockBackgroundSyncService;
    Object.assign(service, {
      busy: false,
      stopping: false,
      logger: { warn: vi.fn() },
      db: { $queryRaw: queryRaw },
    });
    return { service, queryRaw, release };
  }

  it('waits for the running tick and starts no new one', async () => {
    const { service, queryRaw, release } = setup();
    void service.tick();
    expect(queryRaw).toHaveBeenCalledTimes(1);

    let destroyed = false;
    const destroying = service.onModuleDestroy().then(() => (destroyed = true));
    await new Promise((resolve) => setImmediate(resolve));
    expect(destroyed).toBe(false);

    release();
    await destroying;
    expect(destroyed).toBe(true);

    await service.tick();
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('gives up waiting after 20 seconds', async () => {
    vi.useFakeTimers();
    const { service } = setup();
    void service.tick();
    let destroyed = false;
    const destroying = service.onModuleDestroy().then(() => (destroyed = true));
    await vi.advanceTimersByTimeAsync(19_000);
    expect(destroyed).toBe(false);
    await vi.advanceTimersByTimeAsync(1_500);
    await destroying;
    expect(destroyed).toBe(true);
  });
});
