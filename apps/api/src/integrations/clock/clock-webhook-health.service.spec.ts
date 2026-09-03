import { afterEach, describe, expect, it, vi } from 'vitest';

const { reportOperationalFailure } = vi.hoisted(() => ({ reportOperationalFailure: vi.fn() }));
vi.mock('../../observability/error-tracking', () => ({ reportOperationalFailure }));

process.env.REDIS_URL ??= 'redis://localhost:6379';

import { ClockWebhookHealthService } from './clock-webhook-health.service';

function makeService(rows: unknown[]) {
  const database = {
    withPlatformAdminTransaction: vi.fn((_context, callback) =>
      callback({ $queryRawUnsafe: vi.fn().mockResolvedValue(rows) }),
    ),
  };
  return { service: new ClockWebhookHealthService(database as never), database };
}

const HOUR = 60 * 60_000;

describe('ClockWebhookHealthService.checkWebhookFreshness', () => {
  afterEach(() => {
    reportOperationalFailure.mockClear();
  });

  it('does not alert on a connection that received a webhook recently', async () => {
    const { service } = makeService([
      {
        id: 'conn-1',
        tenantId: 'tenant-1',
        lastWebhookReceivedAt: new Date(Date.now() - 1 * HOUR),
        createdAt: new Date(Date.now() - 100 * HOUR),
      },
    ]);
    const result = await service.checkWebhookFreshness();
    expect(result).toEqual({ checked: 1, stale: 0 });
    expect(reportOperationalFailure).not.toHaveBeenCalled();
    await service.onModuleDestroy();
  });

  it('alerts on a connection whose last webhook is older than the threshold', async () => {
    const { service } = makeService([
      {
        id: 'conn-2',
        tenantId: 'tenant-2',
        lastWebhookReceivedAt: new Date(Date.now() - 49 * HOUR),
        createdAt: new Date(Date.now() - 200 * HOUR),
      },
    ]);
    const result = await service.checkWebhookFreshness();
    expect(result).toEqual({ checked: 1, stale: 1 });
    expect(reportOperationalFailure).toHaveBeenCalledTimes(1);
    const [, context] = reportOperationalFailure.mock.calls[0]!;
    expect(context).toEqual({
      component: 'clock',
      operation: 'webhook-health-check',
      tenantId: 'tenant-2',
    });
    await service.onModuleDestroy();
  });

  it('does not alert on a brand-new connection that has never received a webhook yet', async () => {
    const { service } = makeService([
      { id: 'conn-3', tenantId: 'tenant-3', lastWebhookReceivedAt: null, createdAt: new Date() },
    ]);
    const result = await service.checkWebhookFreshness();
    expect(result).toEqual({ checked: 1, stale: 0 });
    expect(reportOperationalFailure).not.toHaveBeenCalled();
    await service.onModuleDestroy();
  });

  it('alerts on a connection that has never received a webhook and is well past its own creation grace period', async () => {
    const { service } = makeService([
      {
        id: 'conn-4',
        tenantId: 'tenant-4',
        lastWebhookReceivedAt: null,
        createdAt: new Date(Date.now() - 200 * HOUR),
      },
    ]);
    const result = await service.checkWebhookFreshness();
    expect(result).toEqual({ checked: 1, stale: 1 });
    expect(reportOperationalFailure).toHaveBeenCalledTimes(1);
    await service.onModuleDestroy();
  });
});

describe('ClockWebhookHealthService.checkStuckBookings', () => {
  afterEach(() => {
    reportOperationalFailure.mockClear();
  });

  it('alerts once per booking genuinely stuck in a Clock in-flight status', async () => {
    const { service } = makeService([
      {
        id: 'booking-1',
        tenantId: 'tenant-1',
        propertyId: 'property-1',
        status: 'PMS_CREATION_PENDING',
        updatedAt: new Date(Date.now() - 2 * HOUR),
      },
    ]);
    const count = await service.checkStuckBookings();
    expect(count).toBe(1);
    expect(reportOperationalFailure).toHaveBeenCalledTimes(1);
    const [error, context] = reportOperationalFailure.mock.calls[0]!;
    expect((error as Error).message).toContain('PMS_CREATION_PENDING');
    expect(context).toEqual({
      component: 'clock',
      operation: 'pending-booking-timeout-check',
      tenantId: 'tenant-1',
      propertyId: 'property-1',
    });
    await service.onModuleDestroy();
  });

  it('does not alert when the query returns nothing (no bookings past the cutoff)', async () => {
    const { service } = makeService([]);
    const count = await service.checkStuckBookings();
    expect(count).toBe(0);
    expect(reportOperationalFailure).not.toHaveBeenCalled();
    await service.onModuleDestroy();
  });
});
