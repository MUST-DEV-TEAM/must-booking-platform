import { describe, expect, it, vi } from 'vitest';

const { reportOperationalFailure } = vi.hoisted(() => ({ reportOperationalFailure: vi.fn() }));
vi.mock('../observability/error-tracking', () => ({ reportOperationalFailure }));

import { ManualReviewService } from './manual-review.service';

function makeService() {
  const transaction = { $executeRawUnsafe: vi.fn().mockResolvedValue(undefined) };
  const database = { withTenantTransaction: vi.fn((_context, callback) => callback(transaction)) };
  return { service: new ManualReviewService(database as never), transaction };
}

describe('ManualReviewService', () => {
  it('alerts in real time when a review item is recorded, not just writing the row', async () => {
    const { service } = makeService();
    reportOperationalFailure.mockClear();

    await service.record({
      tenantId: 'tenant-1',
      propertyId: 'property-1',
      connectionId: 'connection-1',
      category: 'MISSING_MAPPING',
      referenceType: 'clock_booking',
      referenceId: '38149735',
      message: 'Clock booking references an unmapped room type.',
    });

    expect(reportOperationalFailure).toHaveBeenCalledTimes(1);
    const [error, context] = reportOperationalFailure.mock.calls[0]!;
    expect((error as Error).message).toContain('Clock booking references an unmapped room type.');
    expect(context).toEqual({
      component: 'clock',
      operation: 'manual-review.missing_mapping',
      tenantId: 'tenant-1',
      propertyId: 'property-1',
    });
  });

  it('alerts for every category, not just a hardcoded subset', async () => {
    const { service } = makeService();
    reportOperationalFailure.mockClear();

    for (const category of [
      'SCHEMA_MISMATCH',
      'UNKNOWN_RESULT',
      'PAYMENT_BOOKING_MISMATCH',
    ] as const) {
      await service.record({
        tenantId: 'tenant-1',
        propertyId: 'property-1',
        category,
        referenceType: 'booking',
        message: `test ${category}`,
      });
    }

    expect(reportOperationalFailure).toHaveBeenCalledTimes(3);
  });
});
