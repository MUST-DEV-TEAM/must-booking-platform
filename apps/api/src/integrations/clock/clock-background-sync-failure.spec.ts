import { describe, expect, it, vi } from 'vitest';

import { ClockBackgroundSyncService } from './clock-background-sync.service';
import { ClockFinancialCurrencyError } from './clock-financial.service';

const scope = { tenantId: 'tenant-1', propertyId: 'property-1', connectionId: 'connection-1' };
const bookingId = '11111111-1111-4111-8111-111111111111';

type Call = { sql: string; values: unknown[] };

/** A service whose database is a recorder: every tagged-template query is captured, nothing is real. */
function setup(options: { updated?: number; openNote?: boolean } = {}) {
  const calls: Call[] = [];
  const tx = {
    $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ sql: strings.join('?'), values });
      return options.updated ?? 1;
    }),
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ sql: strings.join('?'), values });
      return options.openNote ? [{ id: 'note-1' }] : [];
    }),
  };
  const manualReview = { recordInTransaction: vi.fn() };
  const service = Object.create(ClockBackgroundSyncService.prototype) as unknown as {
    recordFailure: (s: typeof scope, job: unknown, error: unknown) => Promise<void>;
    closeBlockedBillNote: (s: typeof scope, id: string) => Promise<void>;
  };
  Object.assign(service, {
    logger: { warn: vi.fn() },
    manualReview,
    db: {
      withTenantTransaction: vi.fn(async (_scope: unknown, work: (t: unknown) => unknown) =>
        work(tx),
      ),
    },
  });
  const job = (consecutiveFailures: number) => ({
    id: 'job-1',
    resource: `financial:${bookingId}`,
    leaseToken: 'lease-1',
    consecutiveFailures,
  });
  /** The failure write is the UPDATE that sets consecutive_failures. */
  const failureWrite = () => calls.find((c) => c.sql.includes('consecutive_failures='))!;
  return { service, job, manualReview, failureWrite, calls };
}

describe('recordFailure for a bill with inconsistent currencies', () => {
  it('retries after 1, 5 and 30 minutes, then every 6 hours, counting the streak', async () => {
    const seen: Array<{ failures: unknown; delay: unknown }> = [];
    for (const before of [0, 1, 2, 3, 7]) {
      const { service, job, failureWrite } = setup();
      await service.recordFailure(scope, job(before), new ClockFinancialCurrencyError());
      const values = failureWrite().values;
      seen.push({ failures: values[1], delay: values[2] });
    }
    expect(seen).toEqual([
      { failures: 1, delay: 60 },
      { failures: 2, delay: 300 },
      { failures: 3, delay: 1800 },
      { failures: 4, delay: 21_600 },
      { failures: 8, delay: 21_600 },
    ]);
  });

  it('raises one review note on the third failure in a row, and not before or after', async () => {
    const raised: number[] = [];
    for (const before of [0, 1, 2, 3, 4]) {
      const { service, job, manualReview } = setup();
      await service.recordFailure(scope, job(before), new ClockFinancialCurrencyError());
      raised.push(manualReview.recordInTransaction.mock.calls.length);
    }
    expect(raised).toEqual([0, 0, 1, 0, 0]);
  });

  it('does not duplicate the note while one is still open for the booking', async () => {
    const { service, job, manualReview } = setup({ openNote: true });
    await service.recordFailure(scope, job(2), new ClockFinancialCurrencyError());
    expect(manualReview.recordInTransaction).not.toHaveBeenCalled();
  });

  it('writes the note about the right booking, in plain words, with a kind that lets it close itself', async () => {
    const { service, job, manualReview } = setup();
    await service.recordFailure(scope, job(2), new ClockFinancialCurrencyError());
    expect(manualReview.recordInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: 'tenant-1',
        propertyId: 'property-1',
        referenceType: 'booking',
        referenceId: bookingId,
        context: expect.objectContaining({ kind: 'FINANCIAL_SYNC_BLOCKED' }),
        message: expect.stringContaining('inconsistent currencies'),
      }),
    );
  });

  it('raises no note when another worker already took over the job (lease lost)', async () => {
    const { service, job, manualReview } = setup({ updated: 0 });
    await service.recordFailure(scope, job(2), new ClockFinancialCurrencyError());
    expect(manualReview.recordInTransaction).not.toHaveBeenCalled();
  });
});

describe('recordFailure for any other failure', () => {
  it('keeps the 1 minute retry, resets the streak and raises nothing', async () => {
    const { service, job, manualReview, failureWrite } = setup();
    await service.recordFailure(
      scope,
      job(5),
      new Error('Clock read did not finish within its time budget'),
    );
    const values = failureWrite().values;
    expect(values[1]).toBe(0);
    expect(values[2]).toBe(60);
    expect(manualReview.recordInTransaction).not.toHaveBeenCalled();
  });
});

describe('closeBlockedBillNote', () => {
  it('closes only the open "bill cannot be checked" note of that booking', async () => {
    const { service, calls } = setup();
    await service.closeBlockedBillNote(scope, bookingId);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toContain("status='RESOLVED'");
    expect(calls[0]!.sql).toContain("context->>'kind'='FINANCIAL_SYNC_BLOCKED'");
    expect(calls[0]!.values).toContain(bookingId);
  });
});
