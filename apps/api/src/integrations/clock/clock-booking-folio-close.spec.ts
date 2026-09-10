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

function serviceWithClockResponses(...responses: ClockOutcome<unknown>[]) {
  const service = Object.create(ClockBookingService.prototype) as ClockBookingService;
  const fetch = vi.fn<ClockFetch>();
  fetch.mockImplementation(async () => responses.shift()!);
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
  return { service, fetch, logger: internals.logger as { warn: ReturnType<typeof vi.fn> } };
}

const context = { tenantId: 'tenant-1', propertyId: 'property-1' };
const amount = { amount: '100.00', currency: 'EUR' };

describe('ClockBookingService folio close document type selection', () => {
  it('fetches document types once and sends the sole id on close', async () => {
    const { service, fetch } = serviceWithClockResponses(
      { ok: true, value: [{ id: 13181, text_positive_doc: 'Invoice' }] },
      { ok: true, value: {} },
    );

    await expect(
      postDeposit.call(service, {}, context, 'booking-1', amount, 'PokPay', 'MUST-1'),
    ).resolves.toMatchObject({ ok: true });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[1]).toEqual({
      method: 'GET',
      path: '/document_types',
      api: 'base_api',
    });
    expect(fetch.mock.calls[1]?.[1]).toEqual({
      method: 'POST',
      path: '/folios/77/close',
      api: 'base_api',
      body: { document_type_id: 13181 },
    });
  });

  it('leaves close blank and warns when multiple document types are configured', async () => {
    const { service, fetch, logger } = serviceWithClockResponses(
      {
        ok: true,
        value: [
          { id: 13181, text_positive_doc: 'Invoice' },
          { id: 13182, text_positive_doc: 'Receipt' },
        ],
      },
      { ok: true, value: {} },
    );

    await expect(
      postDeposit.call(service, {}, context, 'booking-2', amount, 'Stripe', 'MUST-2'),
    ).resolves.toMatchObject({ ok: true });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[1]).toEqual({
      method: 'POST',
      path: '/folios/77/close',
      api: 'base_api',
    });
    expect(logger.warn).toHaveBeenCalledWith(
      'Clock has 2 configured fiscal document types for property property-1 (13181, 13182); closing deposit folio 77 without document_type_id rather than guessing.',
    );
  });

  it('still closes without a document type when the lookup fails', async () => {
    const { service, fetch, logger } = serviceWithClockResponses(
      {
        ok: false,
        error: { code: 'clock_rate_limited', message: 'Rate limited', retryable: true },
      },
      { ok: true, value: {} },
    );

    await expect(
      postDeposit.call(service, {}, context, 'booking-3', amount, 'Stripe', 'MUST-3'),
    ).resolves.toMatchObject({ ok: true });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[1]).toEqual({
      method: 'POST',
      path: '/folios/77/close',
      api: 'base_api',
    });
    expect(logger.warn).toHaveBeenCalledWith(
      'Clock document type lookup failed for property property-1; closing deposit folio 77 without document_type_id: Rate limited',
    );
  });
});
