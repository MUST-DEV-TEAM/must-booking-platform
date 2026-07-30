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
});
