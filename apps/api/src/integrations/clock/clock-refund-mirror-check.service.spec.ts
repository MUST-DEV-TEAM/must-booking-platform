import { describe, expect, it, vi } from 'vitest';

import { ClockRefundMirrorCheckService } from './clock-refund-mirror-check.service';

const candidate = (n: string) => ({
  tenantId: 't',
  propertyId: 'p',
  bookingId: `b-${n}`,
  refundExternalPaymentId: `order-${n}:refund:x`,
  amount: '21560.00',
  currency: 'ALL',
});

function setup(
  rows: ReturnType<typeof candidate>[],
  statuses: Record<string, 'POSTED' | 'MISSING' | 'fails' | 'throws'>,
) {
  const database = { $queryRaw: vi.fn().mockResolvedValue(rows) };
  const clock = {
    refundMirrorStatus: vi.fn(async (_c: unknown, bookingId: string) => {
      const status = statuses[bookingId] ?? 'POSTED';
      if (status === 'throws') throw new Error('Clock down');
      if (status === 'fails')
        return { ok: false, error: { code: 'clock_network', message: 'down', retryable: true } };
      return { ok: true, value: status };
    }),
  };
  const review = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new ClockRefundMirrorCheckService(
    database as never,
    clock as never,
    review as never,
  );
  return { service, database, clock, review };
}

describe('the nightly check that refunds reached Clock', () => {
  it('can be created and run without a Redis connection', async () => {
    const { service } = setup([], {});
    await expect(service.run()).resolves.toMatchObject({ checked: 0 });
  });

  it('raises one review item, in plain words, for a refund Clock does not have', async () => {
    const { service, review } = setup([candidate('a')], { 'b-a': 'MISSING' });
    await expect(service.run()).resolves.toEqual({ checked: 1, missingInClock: 1, unreadable: 0 });
    expect(review.record).toHaveBeenCalledTimes(1);
    const item = review.record.mock.calls[0]?.[0];
    expect(item).toMatchObject({
      tenantId: 't',
      propertyId: 'p',
      category: 'PAYMENT_BOOKING_MISMATCH',
      referenceType: 'booking',
      referenceId: 'b-a',
    });
    expect(item.message).toMatch(/^A refund recorded here was not found in Clock/);
    expect(item.message).toContain('21560.00 ALL');
    expect(item.message.length).toBeLessThanOrEqual(1000);
  });

  it('raises nothing when Clock has the refund', async () => {
    const { service, review } = setup([candidate('a')], { 'b-a': 'POSTED' });
    await expect(service.run()).resolves.toMatchObject({ checked: 1, missingInClock: 0 });
    expect(review.record).not.toHaveBeenCalled();
  });

  it('counts Clock read failures as unreadable and raises nothing', async () => {
    const { service, review } = setup([candidate('a'), candidate('b')], {
      'b-a': 'fails',
      'b-b': 'throws',
    });
    await expect(service.run()).resolves.toEqual({ checked: 0, missingInClock: 0, unreadable: 2 });
    expect(review.record).not.toHaveBeenCalled();
  });

  it('asks for at most 100 refunds from the last 45 days', async () => {
    const { service, database } = setup([], {});
    await service.run();
    expect((database.$queryRaw.mock.calls[0] ?? []).slice(1)).toEqual([45, 100]);
  });
});
