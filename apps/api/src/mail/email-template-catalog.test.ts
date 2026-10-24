import { describe, it, expect } from 'vitest';
import {
  EMAIL_TEMPLATES,
  defaultTemplate,
  renderTemplate,
  stayTemplateValues,
  unknownPlaceholders,
  type EmailTemplateKey,
} from './email-templates';
import { templateCatalog } from './email-template-catalog';
describe('safe complete situation catalog and local civil stay dates', () => {
  it('provides editable wording and explicit availability without inventing a send trigger', () => {
    for (const key of Object.keys(EMAIL_TEMPLATES) as EmailTemplateKey[]) {
      const defaults = defaultTemplate(key);
      expect(unknownPlaceholders(key, defaults.subject, defaults.body)).toEqual([]);
      expect(defaults.body.length).toBeGreaterThan(20);
      const metadata = templateCatalog(key);
      expect(metadata.triggerAvailable).toBe(!!metadata.trigger);
      if (!metadata.triggerAvailable)
        expect(metadata.unavailableReason).toContain('No sending trigger');
    }
    expect(templateCatalog('booking_confirmed_pay_at_hotel').triggerAvailable).toBe(true);
    expect(templateCatalog('payment_link_expiring').triggerAvailable).toBe(false);
  });
  it('keeps per-night rates exact and dates civil across DST, leap days and year boundaries', () => {
    const base = {
      guestName: 'Guest',
      hotelName: 'Hotel',
      reference: 'R1',
      roomName: 'King',
      guestCount: 2,
    };
    const values = stayTemplateValues({
      ...base,
      startsOn: '2026-03-28',
      endsOn: '2026-03-30',
      nightlyRates: [{ date: '2026-03-28', amount: '9007199254740993.99' }],
      currency: 'EUR',
    });
    expect(values.stay_range).toBe('28 March - 30 March');
    expect(values.stay_nights).toBe(
      '28 March - 9007199254740993.99 EUR\n29 March - Not recorded EUR',
    );
    expect(
      stayTemplateValues({ ...base, startsOn: '2024-02-28', endsOn: '2024-03-01' }).stay_nights,
    ).toContain('29 February');
    expect(
      stayTemplateValues({ ...base, startsOn: '2026-12-31', endsOn: '2027-01-02' }).stay_range,
    ).toBe('31 December 2026 - 2 January 2027');
    expect(
      stayTemplateValues({ ...base, startsOn: '2026-10-24', endsOn: '2026-10-28', language: 'sq' })
        .stay_range,
    ).toContain('tetor');
  });
  it('renders occupied dates without rates or the checkout day', () => {
    const values = stayTemplateValues({
      guestName: 'G',
      hotelName: 'H',
      reference: 'R',
      roomName: 'King',
      guestCount: 2,
      startsOn: '2026-04-11',
      endsOn: '2026-04-14',
    });
    expect(values.stay_dates).toBe('11 April 2026\n12 April 2026\n13 April 2026');
    const result = renderTemplate(
      'booking_confirmed',
      { subject: 'Stay', body: '{stay_dates}' },
      values,
    );
    expect(result.hasStayBlock).toBe(true);
    expect(result.html).toContain('data-summary-label="Dates"');
    expect(result.html).toContain('11 April 2026<br>12 April 2026<br>13 April 2026');
    expect(result.html).not.toContain('Nightly rate');
    expect(result.html).not.toContain('14 April');
  });
  it('lists the recorded amount for every room without averaging or inventing missing nights', () => {
    const result = stayTemplateValues({
      guestName: 'G',
      hotelName: 'H',
      reference: 'R',
      roomName: 'Two rooms',
      guestCount: 4,
      startsOn: '2026-10-24',
      endsOn: '2026-10-25',
      roomNightlyRates: [
        {
          roomName: 'King',
          currency: 'EUR',
          nightlyRates: [{ date: '2026-10-24', amount: '111.01' }],
        },
        { roomName: 'Twin', currency: 'EUR', nightlyRates: null },
      ],
    });
    expect(result.stay_nights).toBe(
      '24 October - King - 111.01 EUR\n24 October - Twin - Not recorded EUR',
    );
  });
  it('escapes values, carries a safe preheader and never interpolates arbitrary variables', () => {
    const result = renderTemplate(
      'pre_arrival',
      {
        subject: '{hotel_name}',
        body: '{guest_name}\n\n{stay_nights}',
        previewText: 'Stay at {hotel_name}',
      },
      {
        hotel_name: 'Hotel',
        guest_name: '<script>bad()</script>',
        stay_nights: '24 October - 100.00 EUR\n25 October - 101.00 EUR',
      },
    );
    expect(result.html).toContain('&lt;script&gt;');
    expect(result.html).not.toContain('<script>');
    expect(result.html).toContain('<table');
    expect(result.hasStayBlock).toBe(true);
    expect(result.previewText).toBe('Stay at Hotel');
    expect(unknownPlaceholders('pre_arrival', '{secret_key}')).toEqual(['secret_key']);
  });
});
