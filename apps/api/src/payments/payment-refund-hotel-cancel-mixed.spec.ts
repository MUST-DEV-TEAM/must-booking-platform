import { describe, expect, it, vi } from 'vitest';

import { PaymentRefundService } from './payment-refund.service';

const context = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  propertyId: '22222222-2222-4222-8222-222222222222',
};
const bookingId = '33333333-3333-4333-8333-333333333333';
const card = {
  id: 'c1',
  provider: 'pokpay',
  externalPaymentId: 'order-1',
  amount: '140.00',
  currency: 'EUR',
  status: 'PAID',
};
// Newest first, as the query returns them: the in-person charge is the latest one.
const cash = {
  id: 'c2',
  provider: 'manual',
  externalPaymentId: 'cash-1',
  amount: '100.00',
  currency: 'EUR',
  status: 'PAID',
};

/** A hotel cancellation in Clock for a booking with the given charges; answers in the order the service asks. */
async function run(options: { inPerson: unknown[]; charges: unknown[]; onlineRefunded?: string }) {
  const tx = { $queryRaw: vi.fn() };
  for (const rows of [
    [{ id: bookingId }],
    options.inPerson,
    options.charges,
    [{ amount: options.onlineRefunded ?? '0.00' }],
  ])
    tx.$queryRaw.mockResolvedValueOnce(rows);
  const service = new PaymentRefundService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const refundCharge = vi
    .spyOn(service as never as { refundCharge: (...args: unknown[]) => unknown }, 'refundCharge')
    .mockResolvedValue({
      result: { ok: true, value: { id: 'r' } },
      confirmation: null,
      clockRefund: null,
    } as never);
  const answer = await service.refundRemainingChargeForBooking(
    tx as never,
    context,
    bookingId,
    'key',
    'note',
  );
  return { answer, refundCharge };
}

describe('a hotel cancellation in Clock for a booking paid by card and in person (G-04)', () => {
  it('refunds the card part, never the in-person charge, and names the in-person part to return by hand', async () => {
    const { answer, refundCharge } = await run({
      inPerson: [{ currency: 'EUR', paid: '100.00', refunded: '0.00' }],
      charges: [cash, card],
    });
    expect(refundCharge).toHaveBeenCalledTimes(1);
    expect(refundCharge.mock.calls[0]![3]).toMatchObject({
      provider: 'pokpay',
      externalPaymentId: 'order-1',
    });
    expect(refundCharge.mock.calls[0]![4]).toMatchObject({
      amount: { amount: '140.00', currency: 'EUR' },
    });
    expect(answer.returnByHand).toEqual({ amount: '100.00', currency: 'EUR' });
  });

  it('sends nothing to the gateway when the card is already refunded, but still names the in-person money', async () => {
    const { answer, refundCharge } = await run({
      inPerson: [{ currency: 'EUR', paid: '100.00', refunded: '40.00' }],
      charges: [cash, card],
      onlineRefunded: '140.00',
    });
    expect(refundCharge).not.toHaveBeenCalled();
    expect(answer.returnByHand).toEqual({ amount: '60.00', currency: 'EUR' });
  });

  it('leaves a booking paid only online exactly as before: no return by hand', async () => {
    const { answer, refundCharge } = await run({ inPerson: [], charges: [card] });
    expect(refundCharge).toHaveBeenCalledTimes(1);
    expect(answer.returnByHand).toBeNull();
  });
});
