import { describe, expect, it, vi } from 'vitest';

import { PaymentRefundController } from './payment-refund.controller';

const context = { tenantId: 't', propertyId: 'p', userId: 'u' };
const body = (extra: Record<string, unknown> = {}) => ({
  bookingId: 'b1',
  reasonCode: 'hotel_cancellation',
  note: 'Guest asked for it',
  ...extra,
});

function setup(options: { late: boolean; capabilities: string[] }) {
  const manualRefund = vi.fn().mockResolvedValue({ ok: true, value: { status: 'REFUNDED' } });
  const refunds = {
    refundWindowClosed: vi.fn().mockResolvedValue(options.late),
    manualRefund,
  };
  const capabilities = { effective: vi.fn().mockResolvedValue(options.capabilities) };
  const controller = new PaymentRefundController(refunds as never, capabilities as never);
  const call = (value: Record<string, unknown>) =>
    controller.refund(value, 'key-1', { tenantContext: context });
  return { manualRefund, call };
}

describe('refunds after the 24-hour window', () => {
  it('refunds inside the window as before', async () => {
    const { call, manualRefund } = setup({ late: false, capabilities: ['payments.refund'] });
    const result = await call(body());
    expect(result).toMatchObject({ ok: true });
    expect(manualRefund).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ note: 'Guest asked for it' }),
    );
  });

  it('refuses someone without the late-refund permission and says who can do it', async () => {
    const { call, manualRefund } = setup({ late: true, capabilities: ['payments.refund'] });
    const result = (await call(body({ lateRefund: true }))) as {
      ok: boolean;
      error: { code: string; message: string; lateAllowed: boolean };
    };
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('REFUND_WINDOW_CLOSED');
    expect(result.error.lateAllowed).toBe(false);
    expect(result.error.message).toContain('owner, admin or manager');
    expect(manualRefund).not.toHaveBeenCalled();
  });

  it('asks an allowed person to confirm before refunding late', async () => {
    const { call, manualRefund } = setup({
      late: true,
      capabilities: ['payments.refund', 'payments.refund_late'],
    });
    const result = (await call(body())) as { ok: boolean; error: { lateAllowed: boolean } };
    expect(result.ok).toBe(false);
    expect(result.error.lateAllowed).toBe(true);
    expect(manualRefund).not.toHaveBeenCalled();
  });

  it('refunds late when an allowed person confirms, and records that it was late', async () => {
    const { call, manualRefund } = setup({
      late: true,
      capabilities: ['payments.refund', 'payments.refund_late'],
    });
    const result = await call(body({ lateRefund: true }));
    expect(result).toMatchObject({ ok: true });
    expect(manualRefund).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        note: 'Refund after the 24-hour window. Guest asked for it',
      }),
    );
  });
});
