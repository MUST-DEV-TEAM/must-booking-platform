import { describe, expect, it, vi } from 'vitest';

import { ResendMailProvider } from './resend-mail.provider';

type Sent = { html: string; text: string };

const base = {
  bookingId: 'b1',
  bookingReference: 'MUST-1234',
  to: 'guest@example.test',
  brand: { name: 'Hotel Test', supportEmail: 'help@hotel.test' },
  guest: { name: 'Ana Test' },
  stay: { startsOn: '2030-07-10', endsOn: '2030-07-12' },
  roomName: 'Sea view',
  guestCount: 2,
};

async function render(refund?: {
  status: 'processed' | 'manual_action';
  amount: { amount: string; currency: string };
}) {
  const provider = new ResendMailProvider();
  const send = vi.fn(async (message: Sent) => message);
  (provider as unknown as { send: typeof send }).send = send;
  await provider.sendBookingCancelledEmail({ ...base, ...(refund ? { refund } : {}) } as never);
  return send.mock.calls[0]![0];
}

describe('guest cancellation email: what happened to the money (G-02)', () => {
  it('says nothing about money when no online payment was involved', async () => {
    const sent = await render();
    expect(sent.html).not.toContain('Your payment');
    expect(sent.text).not.toContain('refund');
  });

  it('tells the guest a refund was sent', async () => {
    const sent = await render({
      status: 'processed',
      amount: { amount: '120.00', currency: 'EUR' },
    });
    expect(sent.html).toContain('Your payment');
    expect(sent.html).toContain('has been sent back');
    expect(sent.text).toContain('120');
  });

  it('tells the guest the hotel will arrange a refund that could not be sent', async () => {
    const sent = await render({
      status: 'manual_action',
      amount: { amount: '120.00', currency: 'EUR' },
    });
    expect(sent.html).toContain('will arrange it with you directly');
    expect(sent.text).toContain('will arrange it with you directly');
  });
});
