import { describe, expect, it, vi } from 'vitest';

import { PaymentRefundService } from './payment-refund.service';

const context = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  propertyId: '22222222-2222-4222-8222-222222222222',
};
const bookingId = '33333333-3333-4333-8333-333333333333';
const charge = {
  id: 'charge-row',
  provider: 'stripe',
  externalPaymentId: 'cs_test_1',
  amount: '400.00',
  currency: 'EUR',
  status: 'PAID',
};

/** The hotel setting, the paid charge, and the fee already saved for it (if any), in the order they are read. */
function build({
  setting = true,
  cachedFee,
  providerFee,
}: {
  setting?: boolean;
  cachedFee?: string;
  providerFee?: { ok: boolean; value?: { amount: string; currency: string } | null };
}) {
  const tx = {
    $queryRaw: vi
      .fn()
      .mockResolvedValueOnce([{ on: setting }])
      .mockResolvedValueOnce([charge])
      .mockResolvedValueOnce(cachedFee ? [{ amount: cachedFee, currency: 'EUR' }] : []),
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  const getPaymentFee = vi.fn(
    async () => providerFee ?? { ok: true, value: { amount: '12.85', currency: 'EUR' } },
  );
  const audit = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
  const service = new PaymentRefundService(
    {} as never,
    audit as never,
    { forProvider: vi.fn().mockReturnValue({ getPaymentFee }) } as never,
    {} as never,
    {} as never,
    { postRefund: vi.fn() } as never,
    {} as never,
  );
  return { service, tx, getPaymentFee, audit };
}
const eur = (amount: string) => ({ amount, currency: 'EUR' });

describe('the payment fee a refund the guest decided on keeps back', () => {
  it('keeps nothing when the hotel has not turned it on, and never asks the provider', async () => {
    const { service, tx, getPaymentFee } = build({ setting: false });
    await expect(
      service.keptProviderFee(tx as never, context, bookingId, eur('400.00')),
    ).resolves.toBeNull();
    expect(getPaymentFee).not.toHaveBeenCalled();
  });

  it('keeps the fee for a refund staff ticked "keep the fee" on, even when the hotel setting is off', async () => {
    const { service, tx, getPaymentFee } = build({ setting: false, cachedFee: '12.85' });
    // Staff's tickbox does not read the hotel setting, so the charge is the first thing read.
    tx.$queryRaw.mockReset();
    tx.$queryRaw
      .mockResolvedValueOnce([charge])
      .mockResolvedValueOnce([{ amount: '12.85', currency: 'EUR' }]);
    await expect(
      service.keptProviderFee(tx as never, context, bookingId, eur('100.00'), {
        ignoreHotelSetting: true,
      }),
    ).resolves.toEqual(eur('3.21'));
    expect(getPaymentFee).not.toHaveBeenCalled();
  });

  it('keeps the whole fee when everything is refunded, and saves the fee for next time', async () => {
    const { service, tx, getPaymentFee } = build({});
    await expect(
      service.keptProviderFee(tx as never, context, bookingId, eur('400.00')),
    ).resolves.toEqual(eur('12.85'));
    expect(getPaymentFee).toHaveBeenCalledWith(context, 'cs_test_1');
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('uses the saved fee without asking the provider again', async () => {
    const { service, tx, getPaymentFee } = build({ cachedFee: '12.85' });
    await expect(
      service.keptProviderFee(tx as never, context, bookingId, eur('400.00')),
    ).resolves.toEqual(eur('12.85'));
    expect(getPaymentFee).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('shares the fee by the part of the payment that is refunded (100.00 of 400.00 keeps 3.21)', async () => {
    const { service, tx } = build({ cachedFee: '12.85' });
    await expect(
      service.keptProviderFee(tx as never, context, bookingId, eur('100.00')),
    ).resolves.toEqual(eur('3.21'));
  });

  it('refunds in full when the fee cannot be read', async () => {
    const failed = build({ providerFee: { ok: false } });
    await expect(
      failed.service.keptProviderFee(failed.tx as never, context, bookingId, eur('400.00')),
    ).resolves.toBeNull();
    const unknown = build({ providerFee: { ok: true, value: null } });
    await expect(
      unknown.service.keptProviderFee(unknown.tx as never, context, bookingId, eur('400.00')),
    ).resolves.toBeNull();
  });

  it('keeps nothing when the refund is in another currency than the payment', async () => {
    const { service, tx } = build({ cachedFee: '12.85' });
    await expect(
      service.keptProviderFee(tx as never, context, bookingId, {
        amount: '400.00',
        currency: 'USD',
      }),
    ).resolves.toBeNull();
  });
});

describe('a cancellation the guest decided on refunds the payment minus the fee', () => {
  function cancelling(options: { guestDecision: boolean; fee: string }) {
    const { service, tx, audit, getPaymentFee } = build({ cachedFee: options.fee });
    const refundCharge = vi
      .spyOn(
        service as unknown as { refundCharge: (...args: unknown[]) => Promise<unknown> },
        'refundCharge',
      )
      .mockResolvedValue({ result: { ok: true, value: { id: 're_1' } }, confirmation: null });
    vi.spyOn(
      service as unknown as {
        mirrorCancellationRefundToClock: (...args: unknown[]) => Promise<void>;
      },
      'mirrorCancellationRefundToClock',
    ).mockResolvedValue(undefined);
    // The charge is read once by the cancel step and once by the fee step.
    tx.$queryRaw.mockReset();
    tx.$queryRaw
      .mockResolvedValueOnce([charge])
      .mockResolvedValueOnce([{ on: true }])
      .mockResolvedValueOnce([charge])
      .mockResolvedValueOnce([{ amount: options.fee, currency: 'EUR' }]);
    return {
      run: () =>
        service.refundPaidChargeForBooking(tx as never, context, bookingId, 'key', {
          guestDecision: options.guestDecision,
        }),
      refundCharge,
      audit,
      getPaymentFee,
    };
  }

  it('refunds 387.15 of a 400.00 payment with a 12.85 fee, and records what was kept', async () => {
    const c = cancelling({ guestDecision: true, fee: '12.85' });
    await expect(c.run()).resolves.toMatchObject({ result: { ok: true } });
    expect(c.refundCharge.mock.calls[0]![4]).toMatchObject({ amount: eur('387.15') });
    expect(c.audit.recordInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'payment.refund_fee_kept',
        details: { fee: '12.85', currency: 'EUR', refunded: '387.15' },
      }),
    );
  });

  it('refunds the full 400.00 when the hotel (not the guest) decided to cancel', async () => {
    const { service, tx } = build({});
    const refundCharge = vi
      .spyOn(
        service as unknown as { refundCharge: (...args: unknown[]) => Promise<unknown> },
        'refundCharge',
      )
      .mockResolvedValue({ result: { ok: true, value: { id: 're_1' } }, confirmation: null });
    vi.spyOn(
      service as unknown as {
        mirrorCancellationRefundToClock: (...args: unknown[]) => Promise<void>;
      },
      'mirrorCancellationRefundToClock',
    ).mockResolvedValue(undefined);
    tx.$queryRaw.mockReset();
    tx.$queryRaw.mockResolvedValueOnce([charge]);
    await service.refundPaidChargeForBooking(tx as never, context, bookingId, 'key');
    expect(refundCharge.mock.calls[0]![4]).toMatchObject({ amount: eur('400.00') });
  });

  it('refunds nothing, and says so, when the fee is as large as the payment', async () => {
    const c = cancelling({ guestDecision: true, fee: '400.00' });
    await expect(c.run()).resolves.toEqual({
      result: { ok: true, value: null },
      confirmation: null,
    });
    expect(c.refundCharge).not.toHaveBeenCalled();
  });
});
