import { afterEach, describe, expect, it, vi } from 'vitest';

import { ResendMailProvider } from '../src/mail/resend-mail.provider';

describe('ResendMailProvider', () => {
  const provider = new ResendMailProvider();
  const originalApiKey = process.env.RESEND_API_KEY;
  const originalFromEmail = process.env.MAIL_FROM_EMAIL;

  afterEach(() => {
    process.env.RESEND_API_KEY = originalApiKey;
    process.env.MAIL_FROM_EMAIL = originalFromEmail;
    vi.unstubAllGlobals();
  });

  it('sends verification messages through Resend with the required request metadata', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.MAIL_FROM_EMAIL = 'MUST Booking <noreply@example.test>';
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await provider.sendVerificationEmail({
      userId: '8beaf323-2f86-46fd-999a-78a0cf52bb5f',
      to: 'owner@example.test',
      organizationName: 'MUST <Hotel>',
      verificationUrl: 'https://app.example.test/email-verification?token=token-value',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer re_test_key',
          'Content-Type': 'application/json',
          'Idempotency-Key': 'email-verification/8beaf323-2f86-46fd-999a-78a0cf52bb5f/token-value',
          'User-Agent': 'must-booking-platform/0.0.0',
        }),
      }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      from: 'MUST Booking <noreply@example.test>',
      to: ['owner@example.test'],
      subject: 'Verify your MUST Booking email address',
      html: expect.stringContaining('MUST &lt;Hotel&gt;'),
      text: expect.stringContaining('token-value'),
    });
  });

  it('sends payment and refund confirmations with event-specific idempotency keys', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.MAIL_FROM_EMAIL = 'MUST Booking <noreply@example.test>';
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await provider.sendPaymentConfirmationEmail({
      bookingId: 'booking-1',
      bookingReference: 'MLDH-260814-2216-K7',
      paymentId: 'cs_test_1',
      to: 'guest@example.test',
      amount: { amount: '180.00', currency: 'EUR' },
      cancellationUrl:
        'https://hotel.example.test/booking-confirmation?booking_id=booking-1&cancellationToken=token',
    });
    await provider.sendRefundConfirmationEmail({
      bookingId: 'booking-1',
      bookingReference: 'MLDH-260814-2216-K7',
      refundId: 're_test_1',
      to: 'guest@example.test',
      amount: { amount: '50.00', currency: 'EUR' },
    });

    expect(
      fetchMock.mock.calls.map(
        ([, options]) => (options?.headers as Record<string, string>)['Idempotency-Key'],
      ),
    ).toEqual(['payment-confirmation/cs_test_1', 'refund-confirmation/re_test_1']);
    expect(
      fetchMock.mock.calls.map(([, options]) => JSON.parse(String(options?.body)).subject),
    ).toEqual(['Booking confirmed', 'Refund processed for your booking']);
    const payment = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(payment.html).toContain('Review or cancel booking');
    expect(payment.html).toContain('cancellationToken=token');
    expect(payment.html).toContain('MLDH-260814-2216-K7');
    expect(payment.html).not.toContain('>booking-1<');
  });

  it('sends password reset links with escaped content and a token-scoped idempotency key', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.MAIL_FROM_EMAIL = 'MUST Booking <noreply@example.test>';
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await provider.sendPasswordResetEmail({
      userId: '8beaf323-2f86-46fd-999a-78a0cf52bb5f',
      to: 'owner@example.test',
      resetUrl: 'https://app.example.test/reset-password?token=reset-value&redirect=<script>',
    });

    const [, options] = fetchMock.mock.calls[0];
    expect((options?.headers as Record<string, string>)['Idempotency-Key']).toBe(
      'password-reset/8beaf323-2f86-46fd-999a-78a0cf52bb5f/reset-value',
    );
    const body = JSON.parse(String(options?.body));
    expect(body.subject).toBe('Reset your MUST Booking password');
    expect(body.html).toContain('reset-password?token=reset-value&amp;redirect=&lt;script&gt;');
    expect(body.text).toContain('reset-password?token=reset-value&redirect=<script>');
  });

  it('omits the cancellation link when no guest return URL exists', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.MAIL_FROM_EMAIL = 'MUST Booking <noreply@example.test>';
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await provider.sendPaymentConfirmationEmail({
      bookingId: 'booking-1',
      bookingReference: 'MLDH-260814-2216-K7',
      paymentId: 'cs_test_1',
      to: 'guest@example.test',
      amount: { amount: '180.00', currency: 'EUR' },
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).html).not.toContain(
      'Review or cancel booking',
    );
  });
});
