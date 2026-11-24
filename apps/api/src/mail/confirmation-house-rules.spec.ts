import { describe, expect, it, vi } from 'vitest';

import { ResendMailProvider } from './resend-mail.provider';

type Sent = { html: string; text: string };

async function render(houseRules?: string[]) {
  const provider = new ResendMailProvider();
  const send = vi.fn(async (message: Sent) => message);
  (provider as unknown as { send: typeof send }).send = send;
  await provider.sendPaymentConfirmationEmail({
    bookingId: 'b1',
    bookingReference: 'MUST-1234',
    paymentId: 'pay1',
    to: 'guest@example.test',
    amount: { amount: '120.00', currency: 'EUR' },
    brand: { name: 'Hotel Test', supportEmail: 'help@hotel.test' },
    paymentMethod: 'stripe',
    guest: { name: 'Ana Test' },
    stay: { startsOn: '2030-07-10', endsOn: '2030-07-12' },
    roomName: 'Sea view',
    guestCount: 2,
    ...(houseRules ? { houseRules } : {}),
  } as never);
  return send.mock.calls[0]![0];
}

describe('confirmation email: house rules (G-55)', () => {
  it('lists the times and rules under "Good to know", escaped', async () => {
    const sent = await render(['Check-in from 14:00.', 'No <b>parties</b>.']);
    expect(sent.html).toContain('Good to know');
    expect(sent.html).toContain('Check-in from 14:00.');
    expect(sent.html).toContain('No &lt;b&gt;parties&lt;/b&gt;.');
    expect(sent.text).toContain('- Check-in from 14:00.');
  });

  it('adds nothing when the hotel set no rules', async () => {
    const sent = await render();
    expect(sent.html).not.toContain('Good to know');
    expect(sent.text).not.toContain('Good to know');
  });
});
