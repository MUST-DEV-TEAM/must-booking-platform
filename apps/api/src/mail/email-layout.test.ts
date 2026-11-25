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

const hotel = {
  name: 'Hotel',
  address: 'Beach Promenade, Dhermi',
  legalName: 'Hotel sh.p.k.',
  taxNumber: 'L12345678A',
  directions: 'Entrance from the beach road, next to the pier.',
};
const render = (extra: Record<string, unknown> = {}, brand: Record<string, unknown> = {}) =>
  renderBrandedEmail({
    subject: 'Booking',
    heading: 'Confirmed',
    content: '<p>Hello.</p>',
    brand: { ...hotel, ...brand },
    ...extra,
  });

it('opens directions at the hotel map pin when it has one, and searches the address otherwise', () => {
  const pinned = render({}, { latitude: 40.133774, longitude: 19.647761 });
  expect(pinned).toContain('query=40.133774%2C19.647761');
  expect(pinned).not.toContain('query=Beach');
  const unpinned = render();
  expect(unpinned).toContain('query=Beach%20Promenade');
});

it('prints the legal name and tax number only where the email asks for them', () => {
  expect(render()).not.toContain('NUIS');
  expect(render({ showLegal: true })).toContain('Hotel sh.p.k. · NUIS L12345678A');
  // A tax number that is not shaped like an Albanian NUIS is not labelled as one.
  expect(render({ showLegal: true }, { taxNumber: 'GB123456789' })).toContain(
    'Hotel sh.p.k. · Tax no. GB123456789',
  );
  expect(render({ showLegal: true }, { legalName: null, taxNumber: null })).not.toContain(
    'Tax no.',
  );
});

it("prints the hotel's own directions only in the email that asks for them, and escapes them", () => {
  expect(render()).not.toContain('How to find us');
  expect(render({ showDirections: true })).toContain(
    'How to find us:</strong> Entrance from the beach road, next to the pier.',
  );
  expect(render({ showDirections: true }, { directions: '<script>x</script>' })).not.toContain(
    '<script>x</script>',
  );
});

import { emailDateOrder } from './resend-mail.provider';

it('writes email dates day first unless the hotel chose month first', () => {
  expect(emailDateOrder({ dateFormat: 'DD/MM/YYYY' })).toBe('gb');
  expect(emailDateOrder({ dateFormat: 'YYYY-MM-DD' })).toBe('gb');
  expect(emailDateOrder({ dateFormat: 'MM/DD/YYYY' })).toBe('us');
  expect(emailDateOrder({})).toBe('gb');
  expect(emailDateOrder(undefined)).toBe('gb');
});

it('prints the contact line and the hotel pages on other sites in the footer, only safe links', () => {
  const html = render(
    {},
    {
      supportEmail: 'hello@hotel.al',
      phone: '+355 69 123 4567',
      onlineProfiles: {
        instagram: 'https://www.instagram.com/hotel',
        tripadvisor: 'javascript:alert(1)',
      },
    },
  );
  expect(html).toContain('hello@hotel.al · +355 69 123 4567');
  expect(html).toContain('Follow us:');
  expect(html).toContain('https://www.instagram.com/hotel');
  expect(html).not.toContain('javascript:');
  expect(render({}, { onlineProfiles: {} })).not.toContain('Follow us:');
});
