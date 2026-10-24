import { renderTemplate } from './email-templates';
import { it, expect } from 'vitest';
import { renderBrandedEmail } from './email-layout';
it('keeps only the introduction above the details table and uses actionable support icons', () => {
  const html = renderBrandedEmail({
    subject: 'Booking',
    heading: 'Confirmed',
    brand: { name: 'Hotel', supportEmail: 'help@example.test', phone: '+355123', address: 'Beach' },
    content:
      '<p>Hello Ana, your stay is confirmed.</p><p>Check-in: 15:00</p><p>Email: guest@example.test</p>',
    summaryRows: [{ label: 'Reference', value: 'ABC' }],
  });
  const table = html.indexOf('Booking Summary');
  expect(html.indexOf('Hello Ana')).toBeLessThan(table);
  expect(html.indexOf('Check-in: 15:00')).toBeGreaterThan(table);
  expect(html).toContain('href="mailto:help@example.test"');
  expect(html).toContain('href="tel:+355123"');
  expect(html).toContain('maps/search');
  expect(html).toContain('aria-label="Get directions"');
  expect(html).toContain('&#9993;');
});

it('puts prepared dates, check-in information and hotel contact into labeled detail cells', () => {
  const message = renderTemplate('booking_confirmed', null, {
    guest_name: 'Ana',
    hotel_name: 'Hotel',
    payment_note: 'Paid',
    booking_reference: 'ABC',
    check_in_time: '15:00',
    hotel_contact: 'stay@example.test',
    stay_range: '14 July - 17 July',
    hotel_policies: 'Agreed terms',
  });
  const html = renderBrandedEmail({
    subject: message.subject,
    heading: 'Confirmed',
    brand: { name: 'Hotel' },
    content: message.html,
    summaryRows: [{ label: 'Reference', value: 'ABC' }],
  });
  expect(html).toMatch(/>Dates<\/td><td[^>]*>14 July - 17 July/);
  expect(html).toMatch(/>Hotel contact<\/td><td[^>]*>stay@example.test/);
  expect(html).toContain('Check-in information');
  expect(html).not.toContain('data-summary-label');
});
