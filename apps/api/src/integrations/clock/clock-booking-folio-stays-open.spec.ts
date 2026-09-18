import { describe, expect, it, vi } from 'vitest';

import { ClockBookingService } from './clock-booking.service';
import type { ClockConnectionCredentials } from './clock-http-client';

type ClockOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

type ClockFetch = (
  credentials: ClockConnectionCredentials,
  options: {
    method: 'GET' | 'POST';
    path: string;
    api?: 'pms_api' | 'base_api';
    body?: unknown;
  },
) => Promise<ClockOutcome<unknown>>;

type PostDeposit = (
  tx: unknown,
  context: { tenantId: string; propertyId: string },
  bookingId: string,
  amount: { amount: string; currency: string },
  paymentSubType: string,
  reference: string,
) => Promise<unknown>;

const postDeposit = (ClockBookingService.prototype as unknown as { postDeposit: PostDeposit })
  .postDeposit;

const credentials: ClockConnectionCredentials = {
  host: 'clock.example.test',
  accountId: 'account-1',
  subscriptionId: 'subscription-1',
  apiUser: 'api-user',
  apiKey: 'api-key',
};

function serviceForPostDeposit() {
  const service = Object.create(ClockBookingService.prototype) as ClockBookingService;
  const fetch = vi.fn<ClockFetch>();
  const internals = service as unknown as Record<string, unknown>;
  internals.fetch = fetch;
  internals.credentials = vi.fn().mockResolvedValue({ ok: true, value: credentials });
  internals.bookingById = vi.fn().mockResolvedValue({ externalBookingId: '1234' });
  internals.depositFolio = vi.fn().mockResolvedValue({
    ok: true,
    value: { status: 'ready', folio: { id: 77 } },
  });
  internals.postCreditItem = vi.fn().mockResolvedValue({ ok: true, value: { id: 88 } });
  internals.withRetry = vi.fn(async (attempt: () => Promise<unknown>) => attempt());
  internals.manualReview = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
  internals.notifications = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
  internals.audit = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
  internals.logger = { warn: vi.fn() };
  return {
    service,
    fetch,
    audit: internals.audit as { recordInTransaction: ReturnType<typeof vi.fn> },
  };
}

const context = { tenantId: 'tenant-1', propertyId: 'property-1' };
const amount = { amount: '100.00', currency: 'EUR' };

describe('ClockBookingService postDeposit folio handling', () => {
  // Clock's own guidance (2026-09-18 email, superseding the 2026-09-10 call):
  // the deposit folio must stay open for their back-office processing to
  // work correctly, so postDeposit must never send a folio_close request.
  it('never closes the deposit folio or looks up fiscal document types', async () => {
    const { service, fetch, audit } = serviceForPostDeposit();

    await expect(
      postDeposit.call(service, {}, context, 'booking-1', amount, 'PokPay', 'MUST-1'),
    ).resolves.toMatchObject({ ok: true });

    expect(fetch).not.toHaveBeenCalled();
    expect(fetch.mock.calls.some((call) => String(call[1]?.path).includes('/close'))).toBe(false);
    expect(
      fetch.mock.calls.some((call) => call[1]?.path === '/document_types'),
    ).toBe(false);

    expect(audit.recordInTransaction).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        action: 'booking.clock_deposit_posted',
        details: expect.objectContaining({
          folioId: 77,
          creditItemId: 88,
        }),
      }),
    );
    const details = audit.recordInTransaction.mock.calls[0]?.[1]?.details as Record<
      string,
      unknown
    >;
    expect(details).not.toHaveProperty('folioClosed');
    expect(details).not.toHaveProperty('documentTypeId');
  });

  it('is a full no-op when a matching credit item is already on a closed deposit folio', async () => {
    const { service, fetch, audit } = serviceForPostDeposit();
    const internals = service as unknown as Record<string, unknown>;
    internals.depositFolio = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        status: 'already_completed',
        folio: { id: 77, closed_at: '2026-09-04T00:00:00Z' },
        creditItem: { id: 88 },
      },
    });

    await expect(
      postDeposit.call(service, {}, context, 'booking-2', amount, 'Stripe', 'MUST-2'),
    ).resolves.toMatchObject({ ok: true });

    expect(fetch).not.toHaveBeenCalled();
    expect(audit.recordInTransaction).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        details: expect.objectContaining({ idempotentReplay: true }),
      }),
    );
  });
});
