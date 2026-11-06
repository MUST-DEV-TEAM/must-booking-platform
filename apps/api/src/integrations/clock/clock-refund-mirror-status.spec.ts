import { describe, expect, it, vi } from 'vitest';

import { ClockBookingService } from './clock-booking.service';

const context = { tenantId: 'tenant-1', propertyId: 'property-1' };
const credentials = { host: 'h', accountId: 'a', subscriptionId: 's', apiUser: 'u', apiKey: 'k' };

function setup(overrides: Partial<Record<string, unknown>> = {}) {
  const service = Object.create(ClockBookingService.prototype) as ClockBookingService;
  const internals = service as unknown as Record<string, unknown>;
  internals.database = {
    withTenantTransaction: vi.fn(async (_c: unknown, op: (tx: unknown) => Promise<unknown>) =>
      op({}),
    ),
  };
  internals.bookingById = vi.fn().mockResolvedValue({
    externalBookingId: '1234',
    externalReference: 'MUST-ORIGINAL-1',
  });
  internals.credentials = vi.fn().mockResolvedValue({ ok: true, value: credentials });
  internals.withRetry = vi.fn(async (attempt: () => Promise<unknown>) => attempt());
  internals.depositFolioWithPaymentReference = vi.fn().mockResolvedValue({
    ok: true,
    value: { folio: { id: 77 }, creditItem: { id: 11 } },
  });
  internals.creditItemByReference = vi.fn().mockResolvedValue({ ok: true, value: { id: 88 } });
  internals.postCreditItem = vi.fn();
  Object.assign(internals, overrides);
  return {
    service,
    creditItemByReference: internals.creditItemByReference as ReturnType<typeof vi.fn>,
    postCreditItem: internals.postCreditItem as ReturnType<typeof vi.fn>,
  };
}

describe('ClockBookingService.refundMirrorStatus (read-only)', () => {
  it('says POSTED when Clock holds the negative payment with the must-refund reference', async () => {
    const { service, creditItemByReference } = setup();
    await expect(service.refundMirrorStatus(context, 'b1', 'order-1:refund:x')).resolves.toEqual({
      ok: true,
      value: 'POSTED',
    });
    expect(creditItemByReference).toHaveBeenCalledWith(
      credentials,
      77,
      'must-refund:order-1:refund:x',
    );
  });

  it('says MISSING when the deposit folio has no such payment', async () => {
    const { service } = setup({
      creditItemByReference: vi.fn().mockResolvedValue({ ok: true, value: null }),
    });
    await expect(service.refundMirrorStatus(context, 'b1', 'r')).resolves.toEqual({
      ok: true,
      value: 'MISSING',
    });
  });

  it('says POSTED (nothing to mirror) for a booking that has no Clock booking', async () => {
    const { service } = setup({
      bookingById: vi.fn().mockResolvedValue({ externalBookingId: null }),
    });
    await expect(service.refundMirrorStatus(context, 'b1', 'r')).resolves.toEqual({
      ok: true,
      value: 'POSTED',
    });
  });

  it('reports a failure, not MISSING, when Clock cannot be read', async () => {
    const { service } = setup({
      depositFolioWithPaymentReference: vi.fn().mockResolvedValue({
        ok: false,
        error: { category: 'network', code: 'clock_network', message: 'down', retryable: true },
      }),
    });
    const result = await service.refundMirrorStatus(context, 'b1', 'r');
    expect(result).toMatchObject({ ok: false, error: { code: 'clock_network' } });
  });

  it('never writes to Clock', async () => {
    const { service, postCreditItem } = setup({
      creditItemByReference: vi.fn().mockResolvedValue({ ok: true, value: null }),
    });
    await service.refundMirrorStatus(context, 'b1', 'r');
    expect(postCreditItem).not.toHaveBeenCalled();
  });
});
