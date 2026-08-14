import { afterEach, describe, expect, it, vi } from 'vitest';

import { ResendMailProvider } from '../src/mail/resend-mail.provider';

describe('ResendMailProvider', () => {
  const provider = new ResendMailProvider();
  const originalApiKey = process.env.RESEND_API_KEY;
  const originalFromEmail = process.env.MAIL_FROM_EMAIL;
  const originalWebAppUrl = process.env.WEB_APP_URL;

  afterEach(() => {
    process.env.RESEND_API_KEY = originalApiKey;
    process.env.MAIL_FROM_EMAIL = originalFromEmail;
    process.env.WEB_APP_URL = originalWebAppUrl;
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
      paymentMethod: 'stripe',
      guest: { name: 'Ada Guest' },
      stay: { startsOn: '2027-09-01', endsOn: '2027-09-03' },
      roomName: 'Ocean Suite',
      guestCount: 2,
      nightlyRates: [
        { date: '2027-09-01', amount: '90.00' },
        { date: '2027-09-02', amount: '90.00' },
      ],
      brand: {
        name: 'MUST <Hotel>',
        logoUrl: 'https://hotel.example.test/logo.png',
        supportEmail: 'stay@hotel.example.test',
        phone: '+355 69 123 4567',
        websiteUrl: 'https://hotel.example.test',
        address: '1 Main Street',
      },
      cancellationUrl:
        'https://hotel.example.test/booking-confirmation?booking_id=booking-1&cancellationToken=token',
      specialRequests: 'Late arrival after 22:00.\nNo feathers, please.',
    });
    await provider.sendRefundConfirmationEmail({
      bookingId: 'booking-1',
      bookingReference: 'MLDH-260814-2216-K7',
      refundId: 're_test_1',
      to: 'guest@example.test',
      amount: { amount: '50.00', currency: 'EUR' },
      brand: { name: 'MUST <Hotel>' },
      guest: { name: 'Ada Guest' },
      stay: { startsOn: '2027-09-01', endsOn: '2027-09-03' },
      roomName: 'Ocean Suite',
      guestCount: 2,
    });

    expect(
      fetchMock.mock.calls.map(
        ([, options]) => (options?.headers as Record<string, string>)['Idempotency-Key'],
      ),
    ).toEqual(['payment-confirmation/cs_test_1', 'refund-confirmation/re_test_1']);
    expect(
      fetchMock.mock.calls.map(([, options]) => JSON.parse(String(options?.body)).subject),
    ).toEqual([
      'MUST <Hotel> booking confirmed — MLDH-260814-2216-K7',
      'MUST <Hotel> refund processed — MLDH-260814-2216-K7',
    ]);
    const payment = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(payment.html).toContain('Review or cancel booking');
    expect(payment.html).toContain('cancellationToken=token');
    expect(payment.html).toContain('MLDH-260814-2216-K7');
    expect(payment.html).toContain('Special requests');
    expect(payment.html).toContain('Late arrival after 22:00.<br>No feathers, please.');
    expect(payment.html).toContain('https://hotel.example.test/logo.png');
    expect(payment.html).toContain('stay@hotel.example.test');
    expect(payment.html).toContain('tel:+355691234567');
    expect(payment.html).toContain('google.com/maps/search/?api=1&amp;query=1%20Main%20Street');
    expect(payment.html).toContain('border:1px solid #e2dccf');
    expect(payment.text).toContain(
      'Special requests: Late arrival after 22:00.\nNo feathers, please.',
    );
    expect(payment.html).not.toContain('>booking-1<');
  });

  it('uses accurate pay-at-hotel copy and sends guest and staff cancellation messages', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.MAIL_FROM_EMAIL = 'MUST Booking <noreply@example.test>';
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const common = {
      bookingId: 'booking-2',
      bookingReference: 'MUST-TEST-002',
      brand: { name: 'Ocean Hotel' },
      stay: { startsOn: '2027-09-01', endsOn: '2027-09-03' },
      roomName: 'Ocean Suite',
      guestCount: 2,
      nightlyRates: [
        { date: '2027-09-01', amount: '90.00' },
        { date: '2027-09-02', amount: '90.00' },
      ],
    };
    await provider.sendPaymentConfirmationEmail({
      ...common,
      paymentId: 'pay-at-hotel-2',
      to: 'guest@example.test',
      amount: { amount: '180.00', currency: 'EUR' },
      paymentMethod: 'pay_at_hotel',
      guest: { name: 'Ada Guest' },
    });
    await provider.sendBookingCancelledEmail({
      ...common,
      to: 'guest@example.test',
      guest: { name: 'Ada Guest' },
    });
    await provider.sendBookingCancelledStaffNotification({
      ...common,
      staffUserId: 'staff-2',
      to: 'staff@example.test',
      guest: { name: 'Ada Guest', email: 'guest@example.test', phone: null },
    });
    const messages = fetchMock.mock.calls.map(([, options]) => JSON.parse(String(options?.body)));
    expect(messages[0].html).toContain('Payment will be collected at the hotel on arrival.');
    expect(messages[0].html).not.toContain('We received your payment');
    expect(messages[1].html).toContain('Your booking was cancelled');
    expect(messages[2].html).toContain('Ada Guest');
    expect(messages.every((message) => message.html.includes('Ocean Suite'))).toBe(true);
  });

  it('sends staff booking notifications with guest and stay details', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.MAIL_FROM_EMAIL = 'MUST Booking <noreply@example.test>';
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await provider.sendNewBookingStaffNotification({
      bookingId: 'booking-1',
      bookingReference: 'MLDH-260814-2216-K7',
      paymentId: 'cs_test_1',
      staffUserId: 'staff-1',
      to: 'front-desk@example.test',
      guest: { name: 'Ada <Guest>', email: 'ada@example.test', phone: '+355 69 123 4567' },
      stay: { startsOn: '2027-09-01', endsOn: '2027-09-03' },
      roomName: 'Ocean Suite',
      amount: { amount: '180.00', currency: 'EUR' },
      guestCount: 2,
      paymentMethod: 'stripe',
      nightlyRates: [
        { date: '2027-09-01', amount: '90.00' },
        { date: '2027-09-02', amount: '90.00' },
      ],
      brand: {
        name: 'Ocean Hotel',
        supportEmail: 'stay@ocean.example.test',
        websiteUrl: 'https://ocean.example.test',
        address: '1 Ocean Road',
      },
      specialRequests: 'Late arrival after 22:00.\nNo feathers, please.',
    });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(requestBody).toMatchObject({
      to: ['front-desk@example.test'],
      subject: 'Ada <Guest> — new booking MLDH-260814-2216-K7',
      html: expect.stringContaining('Ada &lt;Guest&gt;'),
      text: expect.stringContaining('Dates: 2027-09-01 to 2027-09-03'),
    });
    expect(requestBody.html).toContain('Ocean Suite');
    expect(requestBody.html).toContain('Special requests');
    expect((fetchMock.mock.calls[0][1]?.headers as Record<string, string>)['Idempotency-Key']).toBe(
      'new-booking-staff/cs_test_1/staff-1',
    );
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
    expect(body.html).toContain('reset-password?token=reset-value&amp;redirect=%3Cscript%3E');
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
      brand: { name: 'Ocean Hotel' },
      paymentMethod: 'pay_at_hotel',
      guest: { name: 'Ada Guest' },
      stay: { startsOn: '2027-09-01', endsOn: '2027-09-03' },
      roomName: 'Ocean Suite',
      guestCount: 1,
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).html).not.toContain(
      'Review or cancel booking',
    );
  });

  it('renders each in-scope design-reference email with its audience-specific structure', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.MAIL_FROM_EMAIL = 'MUST Booking <noreply@example.test>';
    process.env.WEB_APP_URL = 'https://app.mustbooking.com';
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const brand = {
      name: 'Ocean Bay Resort',
      logoUrl: 'https://oceanbayresort.com/logo.png',
      supportEmail: 'reservations@oceanbayresort.com',
      phone: '+62 361 555 0142',
      websiteUrl: 'https://oceanbayresort.com',
      address: '24 Marina Boulevard, Sanur, Bali 80228, Indonesia',
    };
    const booking = {
      bookingId: 'booking-reference',
      bookingReference: 'MLDH-260814-2216',
      to: 'guest@example.test',
      brand,
      guest: { name: 'Alex Morgan' },
      stay: { startsOn: '2026-08-28', endsOn: '2026-09-01' },
      roomName: 'Ocean Suite',
      guestCount: 2,
      nightlyRates: [
        { date: '2026-08-28', amount: '120.00' },
        { date: '2026-08-29', amount: '120.00' },
      ],
    };

    await provider.sendVerificationEmail({
      userId: 'user-1',
      to: 'admin@example.test',
      organizationName: 'Coastal Hospitality Group',
      verificationUrl: 'https://app.mustbooking.com/email-verification?token=verify-1',
    });
    await provider.sendWelcomeEmail({
      userId: 'user-1',
      to: 'admin@example.test',
      organizationName: 'Coastal Hospitality Group',
    });
    await provider.sendPasswordResetEmail({
      userId: 'user-1',
      to: 'admin@example.test',
      resetUrl: 'https://app.mustbooking.com/reset-password?token=reset-1',
    });
    await provider.sendPaymentConfirmationEmail({
      ...booking,
      paymentId: 'paid-1',
      amount: { amount: '240.00', currency: 'USD' },
      paymentMethod: 'stripe',
      cancellationUrl: 'https://oceanbayresort.com/booking/confirmation?booking=MLDH-260814-2216',
    });
    await provider.sendPaymentConfirmationEmail({
      ...booking,
      paymentId: 'hotel-1',
      amount: { amount: '240.00', currency: 'USD' },
      paymentMethod: 'pay_at_hotel',
    });
    await provider.sendBookingCancelledEmail(booking);
    await provider.sendNewBookingStaffNotification({
      ...booking,
      paymentId: 'staff-1',
      staffUserId: 'staff-1',
      to: 'staff@example.test',
      guest: { name: 'Alex Morgan', email: 'alex.morgan@example.com', phone: '+1 415 555 0198' },
      amount: { amount: '240.00', currency: 'USD' },
      paymentMethod: 'stripe',
      specialRequests: 'Late check-in after 10 PM, if possible.',
    });
    await provider.sendBookingCancelledStaffNotification({
      ...booking,
      staffUserId: 'staff-1',
      to: 'staff@example.test',
      guest: { name: 'Alex Morgan', email: 'alex.morgan@example.com', phone: null },
    });
    await provider.sendRefundConfirmationEmail({
      ...booking,
      refundId: 'refund-1',
      amount: { amount: '240.00', currency: 'USD' },
    });
    await provider.sendStaffInvitationEmail({
      to: 'invitee@example.test',
      organizationName: 'Coastal Hospitality Group',
      invitedByEmail: 'riley.chen@example.test',
      assignments: [{ propertyName: 'Ocean Bay Resort', roleTemplateName: 'Property Staff' }],
      invitationUrl: 'https://app.mustbooking.com/staff-invitation?token=invite-1',
    });

    const messages = fetchMock.mock.calls.map(([, options]) => JSON.parse(String(options?.body)));
    expect(messages).toHaveLength(10);
    expect(messages.map((message) => message.subject)).toEqual([
      'Verify your MUST Booking email address',
      'Welcome to MUST Booking',
      'Reset your MUST Booking password',
      'Ocean Bay Resort booking confirmed — MLDH-260814-2216',
      'Ocean Bay Resort booking confirmed — MLDH-260814-2216',
      'Booking MLDH-260814-2216 cancelled',
      'Alex Morgan — new booking MLDH-260814-2216',
      'Alex Morgan — booking cancelled MLDH-260814-2216',
      'Ocean Bay Resort refund processed — MLDH-260814-2216',
      "You're invited to join Coastal Hospitality Group on MUST Booking",
    ]);
    for (const message of messages) {
      expect(message.html).toContain('meta name="color-scheme" content="light dark"');
      expect(message.html).toContain('<!--[if mso]>');
      expect(message.html).toContain('max-width:600px');
    }
    for (const message of [
      messages[0],
      messages[1],
      messages[2],
      messages[3],
      messages[5],
      messages[6],
      messages[7],
    ])
      expect(message.html).toContain('border-radius:2px');
    expect(messages[0].html).toContain(
      'Confirm this email address to activate your account and start setting up your property.',
    );
    expect(messages[1].html).toContain('Go to dashboard');
    expect(messages[2].html).toContain('This link can only be used once.');
    expect(messages[3].html).toContain(
      "We've received your payment and your reservation is confirmed.",
    );
    expect(messages[4].html).toContain('Payment will be collected at the hotel on arrival.');
    expect(messages[5].html).toContain('Your booking was cancelled');
    expect(messages[6].html).toContain('New booking received');
    expect(messages[7].html).toContain('Booking cancelled');
    expect(messages[8].html).toContain(
      'It may take a few business days to appear on your original payment method.',
    );
    expect(messages[9].html).toContain('You&#39;ve been invited to join the team');
    expect(messages[9].html).toContain('Invitation details');
    expect(messages[9].html).toContain('Accept invitation');
    for (const message of [
      messages[3],
      messages[4],
      messages[5],
      messages[6],
      messages[7],
      messages[8],
    ]) {
      expect(message.html).toContain('Dates');
    }
    for (const message of [messages[3], messages[4], messages[6], messages[8]])
      expect(message.html).toContain('— 120.00 USD');
    for (const message of [messages[5], messages[7]]) expect(message.html).toContain('— 120.00');
    for (const message of [messages[0], messages[1], messages[2], messages[6], messages[7]])
      expect(message.html).toContain('padding:16px 18px;');
    for (const message of [messages[3], messages[4], messages[5], messages[8]])
      expect(message.html).toContain('border-radius:24px');
  });
});
