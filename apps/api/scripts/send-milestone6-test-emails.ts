// Manual verification script for Milestone 6 Tasks 47/48 — sends one real
// email for each of the 6 rewritten booking-lifecycle templates through the
// actual ResendMailProvider code path (not a reimplementation), so the
// rendered output can be reviewed in a real inbox before the tasks are
// marked Done. Not part of the application; run and delete/ignore.
//
// Usage: node --env-file-if-exists=.env --import=tsx scripts/send-milestone6-test-emails.ts <recipient-email>

import { ResendMailProvider } from '../src/mail/resend-mail.provider';

const to = process.argv[2];
if (!to) {
  console.error('Usage: send-milestone6-test-emails.ts <recipient-email>');
  process.exit(1);
}

const provider = new ResendMailProvider();

const brand = {
  name: 'Riviera Grand Hotel',
  logoUrl: undefined,
  supportEmail: 'stay@rivieragrand.example',
  phone: '+355 69 555 1234',
  websiteUrl: 'https://rivieragrand.example',
  address: 'Rruga Skanderbeg 12, Sarandë, Albania',
};

const common = {
  bookingId: 'test-booking-milestone6',
  bookingReference: 'RVG-260813-TEST',
  brand,
  stay: { startsOn: '2026-09-12', endsOn: '2026-09-15' },
  roomName: 'Deluxe Sea View Suite',
  guestCount: 2,
  nightlyRates: [
    { date: '2026-09-12', amount: '145.00' },
    { date: '2026-09-13', amount: '145.00' },
    { date: '2026-09-14', amount: '160.00' },
  ],
};

async function main() {
  console.log(`Sending 6 Milestone 6 test emails to ${to} ...`);

  await provider.sendPaymentConfirmationEmail({
    ...common,
    paymentId: 'test-payment-paid',
    to,
    amount: { amount: '450.00', currency: 'EUR' },
    paymentMethod: 'stripe',
    guest: { name: 'Alex Morgan' },
    cancellationUrl:
      'https://rivieragrand.example/booking-confirmation?booking_id=test&cancellationToken=demo',
    specialRequests: 'Late arrival after 22:00, please. No feathers in pillows.',
  });
  console.log('1/6 sent: guest confirmation (paid, Stripe)');

  await provider.sendPaymentConfirmationEmail({
    ...common,
    paymentId: 'test-payment-pay-at-hotel',
    to,
    amount: { amount: '450.00', currency: 'EUR' },
    paymentMethod: 'pay_at_hotel',
    guest: { name: 'Alex Morgan' },
    cancellationUrl:
      'https://rivieragrand.example/booking-confirmation?booking_id=test&cancellationToken=demo',
  });
  console.log('2/6 sent: guest confirmation (pay at hotel)');

  await provider.sendNewBookingStaffNotification({
    ...common,
    paymentId: 'test-payment-paid',
    staffUserId: 'test-staff-user',
    to,
    guest: { name: 'Alex Morgan', email: 'alex.morgan@example.com', phone: '+1 555 987 6543' },
    amount: { amount: '450.00', currency: 'EUR' },
    paymentMethod: 'stripe',
    specialRequests: 'Late arrival after 22:00, please.',
  });
  console.log('3/6 sent: staff new-booking notification');

  await provider.sendRefundConfirmationEmail({
    ...common,
    refundId: 'test-refund',
    to,
    amount: { amount: '150.00', currency: 'EUR' },
    guest: { name: 'Alex Morgan' },
  });
  console.log('4/6 sent: guest refund confirmation');

  await provider.sendBookingCancelledEmail({
    ...common,
    to,
    guest: { name: 'Alex Morgan' },
  });
  console.log('5/6 sent: guest cancellation notice');

  await provider.sendBookingCancelledStaffNotification({
    ...common,
    staffUserId: 'test-staff-user',
    to,
    guest: { name: 'Alex Morgan', email: 'alex.morgan@example.com', phone: null },
  });
  console.log('6/6 sent: staff cancellation notice');

  console.log('Done — check the inbox.');
}

main().catch((error) => {
  console.error('Failed to send test emails:', error);
  process.exit(1);
});
