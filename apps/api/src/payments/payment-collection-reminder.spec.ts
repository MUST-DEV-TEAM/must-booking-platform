import { describe, expect, it, vi } from 'vitest';

import { PaymentCollectionService } from './payment-collection.service';

function setup(rows: unknown[], requestRows: unknown[] = [], secondRows: unknown[] = []) {
  const guest = vi.fn().mockResolvedValue(undefined);
  // The queries run in order: request reminders, first reminders, second reminders, expired links.
  const db = {
    $queryRaw: vi
      .fn()
      .mockResolvedValueOnce(requestRows)
      .mockResolvedValueOnce(rows)
      .mockResolvedValueOnce(secondRows)
      .mockResolvedValue([]),
  };
  const service = new PaymentCollectionService(
    db as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { guest } as never,
  );
  return { service, guest };
}

describe('payment link reminders', () => {
  it('reminds once per link, with the link already sent and the amount owed', async () => {
    const { service, guest } = setup([
      {
        bookingId: 'b1',
        tenantId: 't1',
        propertyId: 'p1',
        operationId: 'op1',
        checkoutUrl: 'https://pay.test/o/1',
        amount: '120.00',
        currency: 'EUR',
      },
    ]);
    await service.sendDueReminders();
    expect(guest).toHaveBeenCalledTimes(1);
    const [scope, email] = guest.mock.calls[0]!;
    expect(scope).toEqual({ tenantId: 't1', propertyId: 'p1' });
    expect(email).toMatchObject({
      topic: 'payment_reminder',
      key: 'payment_reminder',
      idempotencyKey: 'payment-reminder/op1',
      bookingId: 'b1',
      values: { payment_link: 'https://pay.test/o/1', payment_due: '120.00 EUR' },
      cta: { url: 'https://pay.test/o/1' },
    });
    expect(email.force).toBeUndefined();
  });

  it('sends nothing when no link is due', async () => {
    const { service, guest } = setup([]);
    await service.sendDueReminders();
    expect(guest).not.toHaveBeenCalled();
  });

  it('uses the durable request link for each due reminder', async () => {
    const { service, guest } = setup(
      [],
      [
        {
          bookingId: 'b1',
          tenantId: 't1',
          propertyId: 'p1',
          checkoutUrl: 'https://hotel.test/request',
          amount: '120.00',
          currency: 'EUR',
          reminder: 2,
        },
      ],
    );
    await service.sendDueReminders();
    expect(guest).toHaveBeenCalledWith(
      { tenantId: 't1', propertyId: 'p1' },
      expect.objectContaining({
        idempotencyKey: 'request-payment-reminder/b1/2',
        cta: { label: 'Pay securely', url: 'https://hotel.test/request' },
      }),
    );
  });
});

describe('second payment link reminder (G-100)', () => {
  it('sends it once per link under its own key', async () => {
    const { service, guest } = setup(
      [],
      [],
      [
        {
          bookingId: 'b1',
          tenantId: 't1',
          propertyId: 'p1',
          operationId: 'op1',
          checkoutUrl: 'https://pay.test/o/1',
          amount: '120.00',
          currency: 'EUR',
        },
      ],
    );
    await service.sendDueReminders();
    expect(guest).toHaveBeenCalledTimes(1);
    expect(guest.mock.calls[0]![1]).toMatchObject({ idempotencyKey: 'payment-reminder-2/op1' });
  });
});
