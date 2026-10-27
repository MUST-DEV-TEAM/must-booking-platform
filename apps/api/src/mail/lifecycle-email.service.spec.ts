import { describe, expect, it, vi } from 'vitest';

const settings = vi.hoisted(() => ({
  guestEnabled: true,
  recipients: [] as Array<{ staffUserId: string; email: string; envelope?: unknown }>,
}));

vi.mock('./notification-recipients', () => ({
  guestNotificationEnabled: async () => settings.guestEnabled,
  staffRecipients: async () => settings.recipients,
  staffDeliveryGroups: (rows: unknown) => rows,
}));

import { LifecycleEmailService, type LifecycleEmail } from './lifecycle-email.service';

const context = { tenantId: 't', propertyId: 'p' };

function setup(options: { email?: string | null; fail?: boolean } = {}) {
  const dispatch = vi.fn().mockResolvedValue(undefined);
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (options.fail) throw new Error('database down');
      if (sql.includes('FROM email_templates')) return [];
      if (sql.includes('FROM bookings b'))
        return [
          {
            id: 'b1',
            reference: 'EBR-1',
            email: options.email === undefined ? 'ada@guest.test' : options.email,
            firstName: 'Ada',
            lastName: 'Lovelace',
            startsOn: '2027-07-12',
            endsOn: '2027-07-15',
            roomName: 'Deluxe Suite',
            guestCount: 2,
            currency: 'EUR',
            nightlyRates: null,
          },
        ];
      if (sql.includes('FROM properties'))
        return [
          {
            name: 'Empire Beach Resort',
            brandColour: '#224858',
            supportEmail: 'hello@hotel.test',
            phone: '+355 69 606 0930',
            address: 'Dhermi',
            checkInTime: '14:00',
          },
        ];
      return [];
    },
  };
  const database = {
    withTenantTransaction: async (_c: unknown, fn: (t: typeof tx) => unknown) => fn(tx),
  };
  const service = new LifecycleEmailService(database as never, { dispatch } as never);
  return { service, dispatch };
}

const receipt: LifecycleEmail = {
  topic: 'payment_received',
  key: 'payment_received',
  eventType: 'payment.received',
  idempotencyKey: 'receipt/o1',
  bookingId: 'b1',
  heading: 'Payment received',
  values: { payment_amount: '120.00 EUR' },
  rows: [{ label: 'Amount received', value: '120.00 EUR' }],
};

describe('LifecycleEmailService', () => {
  it('sends the guest the hotel’s wording, filled in, with the amount in the summary', async () => {
    settings.guestEnabled = true;
    const { service, dispatch } = setup();
    await service.guest(context, receipt);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const [kind, command, scope] = dispatch.mock.calls[0]!;
    expect(kind).toBe('rendered');
    expect(scope).toEqual(context);
    expect(command).toMatchObject({
      to: 'ada@guest.test',
      subject: 'Payment received - EBR-1',
      idempotencyKey: 'receipt/o1',
      eventType: 'payment.received',
      bookingId: 'b1',
    });
    expect(command.text).toContain('120.00 EUR');
    expect(command.html).toContain('Amount received');
    expect(command.html).toContain('EBR-1');
  });

  it('sends nothing when the hotel switched the guest email off', async () => {
    settings.guestEnabled = false;
    const { service, dispatch } = setup();
    await service.guest(context, receipt);
    expect(dispatch).not.toHaveBeenCalled();
    settings.guestEnabled = true;
  });

  it('sends nothing when the booking has no guest email address', async () => {
    const { service, dispatch } = setup({ email: null });
    await service.guest(context, receipt);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('sends each staff recipient their own copy, once, with a link to open the reservation', async () => {
    process.env.WEB_APP_URL = 'https://booking.test';
    settings.recipients = [
      { staffUserId: 'u1', email: 'owner@hotel.test' },
      { staffUserId: 'email:desk@hotel.test', email: 'desk@hotel.test' },
    ];
    const { service, dispatch } = setup();
    await service.staff(context, {
      ...receipt,
      key: 'staff_payment_received',
      idempotencyKey: 'receipt/staff/o1',
    });
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls.map(([, command]) => command.to)).toEqual([
      'owner@hotel.test',
      'desk@hotel.test',
    ]);
    expect(dispatch.mock.calls.map(([, command]) => command.idempotencyKey)).toEqual([
      'receipt/staff/o1/u1',
      'receipt/staff/o1/email:desk@hotel.test',
    ]);
    expect(dispatch.mock.calls[0]![1].html).toContain('Open in MUST');
    expect(dispatch.mock.calls[0]![1].subject).toBe('Payment received - EBR-1');
  });

  it('sends no staff email when nobody is routed the topic', async () => {
    settings.recipients = [];
    const { service, dispatch } = setup();
    await service.staff(context, { ...receipt, key: 'staff_payment_received' });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('never throws: a database problem must not fail the payment', async () => {
    const { service, dispatch } = setup({ fail: true });
    await expect(service.guest(context, receipt)).resolves.toBeUndefined();
    await expect(
      service.staff(context, { ...receipt, key: 'staff_payment_received' }),
    ).resolves.toBeUndefined();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
