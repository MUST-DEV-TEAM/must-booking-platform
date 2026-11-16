import { describe, expect, it, vi } from 'vitest';

import {
  ClockDeadLetterMonitorService,
  DEAD_LETTER_ALERTED_KEY,
  formatAge,
} from './clock-dead-letter-monitor.service';
import { defaultJobOptions } from './clock-queue.service';

function setup(options: { told?: number; sent?: boolean } = {}) {
  const store = new Map<string, string>();
  if (options.told !== undefined) store.set(DEAD_LETTER_ALERTED_KEY, String(options.told));
  const redis = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => void store.set(key, value)),
  };
  const queues = { deadLetterStats: vi.fn() };
  const alerts = {
    sendPlatformNotice: vi.fn<(event: unknown, key: string) => Promise<boolean>>(
      async () => options.sent ?? true,
    ),
  };
  const service = new ClockDeadLetterMonitorService(queues as never, alerts as never);
  (service as unknown as { redis: unknown }).redis = redis;
  const at = (count: number, oldestAgeSeconds: number | null = 7200) =>
    queues.deadLetterStats.mockResolvedValue({ count, oldestAgeSeconds });
  return { service, redis, alerts, store, at };
}

describe('Clock dead-letter monitor', () => {
  it('sends one alert for a whole jump in the count, not one per job', async () => {
    const { service, alerts, store, at } = setup();
    at(40);

    const result = await service.check();

    expect(result).toEqual({ count: 40, alerted: true });
    expect(alerts.sendPlatformNotice).toHaveBeenCalledTimes(1);
    expect(alerts.sendPlatformNotice.mock.calls[0]![0]).toMatchObject({
      kind: 'clock_dead_letter',
      detail: expect.stringContaining('40 jobs waiting, oldest 2 h old'),
    });
    expect(store.get(DEAD_LETTER_ALERTED_KEY)).toBe('40');
  });

  it('stays quiet while the count does not grow', async () => {
    const { service, alerts, at } = setup({ told: 40 });
    at(40);
    await service.check();
    at(39);
    await service.check();

    expect(alerts.sendPlatformNotice).not.toHaveBeenCalled();
  });

  it('remembers a lower count, so the next growth is reported again', async () => {
    const { service, alerts, store, at } = setup({ told: 40 });
    at(2);
    await service.check();
    expect(store.get(DEAD_LETTER_ALERTED_KEY)).toBe('2');
    at(3);
    await service.check();

    expect(alerts.sendPlatformNotice).toHaveBeenCalledTimes(1);
    expect(store.get(DEAD_LETTER_ALERTED_KEY)).toBe('3');
  });

  it('keeps trying while the alert could not be sent (no address set)', async () => {
    const { service, alerts, store, at } = setup({ sent: false });
    at(5);
    await service.check();
    await service.check();

    expect(alerts.sendPlatformNotice).toHaveBeenCalledTimes(2);
    expect(store.has(DEAD_LETTER_ALERTED_KEY)).toBe(false);
  });
});

describe('failed job retention', () => {
  it('keeps failed webhook and reconciliation jobs for 30 days, other queues as before', () => {
    expect(defaultJobOptions('clock.webhooks').removeOnFail).toEqual({ age: 30 * 24 * 60 * 60 });
    expect(defaultJobOptions('clock.reconciliation').removeOnFail).toEqual({
      age: 30 * 24 * 60 * 60,
    });
    expect(defaultJobOptions('clock.critical.commands').removeOnFail).toBe(false);
  });

  it('writes ages people can read', () => {
    expect(formatAge(30)).toBe('1 min');
    expect(formatAge(7200)).toBe('2 h');
    expect(formatAge(3 * 86_400)).toBe('3 days');
  });
});
