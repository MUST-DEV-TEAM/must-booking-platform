import { describe, expect, it } from 'vitest';

import { checkHotelSettings, hotelInput } from './hotel-settings';

const year = new Date().getFullYear();

describe('hotel profile fields', () => {
  it('accepts a full identity and normalises it', () => {
    expect(
      hotelInput({
        chainName: '  Beach Group ',
        propertyType: 'resort',
        yearOpened: 1998,
        yearRenovated: 2020,
        starRatingOfficial: true,
        summary: 'A quiet beach resort.',
        tourismLicence: ' AL-123 ',
        vatRegistered: true,
        taxNumber: 'l12345678a',
        country: 'AL',
      }),
    ).toMatchObject({
      chainName: 'Beach Group',
      tourismLicence: 'AL-123',
      taxNumber: 'L12345678A',
      yearOpened: 1998,
    });
  });

  it('turns cleared text into null', () => {
    expect(hotelInput({ chainName: '  ', yearOpened: null })).toEqual({
      chainName: null,
      yearOpened: null,
    });
  });

  it.each([
    [{ propertyType: 'castle' }, 'property type'],
    [{ yearOpened: 1700 }, 'year'],
    [{ yearOpened: year + 1 }, 'year'],
    [{ yearOpened: 'abc' }, 'year'],
    [{ summary: 'x'.repeat(161) }, '160'],
    [{ description: 'too short' }, '50'],
    [{ chainName: 'Bad <name>' }, 'Remove'],
    [{ vatRegistered: 'yes' }, 'yes or no'],
    [{ tourismLicence: 'x'.repeat(51) }, '50'],
  ])('refuses %j', (body, hint) => {
    expect(() => hotelInput(body)).toThrow(hint);
  });

  it('checks the tax number against the country', () => {
    const albania = { taxNumber: 'L12345678A', country: 'AL' };
    expect(() => checkHotelSettings(albania, ['taxNumber'])).not.toThrow();
    expect(() => checkHotelSettings({ ...albania, taxNumber: '12345' }, ['taxNumber'])).toThrow(
      'NUIS',
    );
    expect(() =>
      checkHotelSettings({ taxNumber: 'DE123456789', country: 'DE' }, ['taxNumber']),
    ).not.toThrow();
    // An old, unedited tax number is left alone when something else changes.
    expect(() =>
      checkHotelSettings({ taxNumber: '12345', country: 'AL' }, ['phone']),
    ).not.toThrow();
  });

  it('checks fields against each other', () => {
    expect(() =>
      checkHotelSettings({ yearOpened: 2010, yearRenovated: 2005 }, ['yearRenovated']),
    ).toThrow('renovation');
    expect(() =>
      checkHotelSettings({ starRating: null, starRatingOfficial: true }, ['starRatingOfficial']),
    ).toThrow('star rating');
    expect(() =>
      checkHotelSettings({ starRating: 4, starRatingOfficial: true }, ['starRatingOfficial']),
    ).not.toThrow();
  });

  it('accepts and normalises the location fields', () => {
    expect(
      hotelInput({
        city: ' Vlorë ',
        region: 'Vlorë',
        postalCode: '9401',
        latitude: 40.466667,
        longitude: '19,489722',
        nearestAirportCode: 'tia',
        nearestAirportKm: '120.5',
        directions: 'Turn left after the pharmacy.',
      }),
    ).toMatchObject({
      city: 'Vlorë',
      latitude: 40.466667,
      longitude: 19.489722,
      nearestAirportCode: 'TIA',
      nearestAirportKm: 120.5,
    });
  });

  it.each([
    [{ latitude: 91 }, 'Enter a number'],
    [{ longitude: 0.1234567 }, 'Enter a number'],
    [{ latitude: 'abc' }, 'Enter a number'],
    [{ nearestAirportCode: 'TI' }, '3-letter'],
    [{ nearestAirportKm: 501 }, '500'],
    [{ nearestAirportKm: 1.25 }, '1 decimal'],
    [{ directions: 'x'.repeat(301) }, '300'],
  ])('refuses %j', (body, hint) => {
    expect(() => hotelInput(body)).toThrow(hint);
  });

  it('checks region and postal code against the country', () => {
    expect(() => checkHotelSettings({ country: 'AL', region: 'Tiranë' }, ['region'])).not.toThrow();
    expect(() => checkHotelSettings({ country: 'AL', region: 'Texas' }, ['region'])).toThrow(
      'counties',
    );
    expect(() => checkHotelSettings({ country: 'AL', postalCode: '94' }, ['postalCode'])).toThrow(
      '4 digits',
    );
    expect(() =>
      checkHotelSettings({ country: 'GB', postalCode: 'SW1A 1AA' }, ['postalCode']),
    ).not.toThrow();
    // Changing the country re-checks the region that was saved before.
    expect(() => checkHotelSettings({ country: 'AL', region: 'Texas' }, ['country'])).toThrow();
    expect(() => checkHotelSettings({ latitude: 40.1, longitude: null }, ['latitude'])).toThrow(
      'both',
    );
  });

  it('accepts any ISO language and the display formats, and needs one language', () => {
    expect(hotelInput({ languages: ['sq', 'ja', 'sq'] })).toEqual({ languages: ['ja', 'sq'] });
    expect(() => hotelInput({ languages: [] })).toThrow('at least one');
    expect(() => hotelInput({ languages: ['xx'] })).toThrow('from the list');
    expect(
      hotelInput({ timeFormat: '12h', weekStart: 'sunday', numberFormat: 'dot_comma' }),
    ).toEqual({
      timeFormat: '12h',
      weekStart: 'sunday',
      numberFormat: 'dot_comma',
    });
    expect(() => hotelInput({ timeFormat: '13h' })).toThrow('from the list');
    expect(() => hotelInput({ weekStart: null })).toThrow();
  });

  it('stores phones in international form and refuses numbers that are not real', () => {
    expect(hotelInput({ afterHoursPhone: '+355 69 212 3456' })).toEqual({
      afterHoursPhone: '+355692123456',
    });
    expect(hotelInput({ whatsappNumber: null })).toEqual({ whatsappNumber: null });
    for (const bad of ['0692123456', '+355 12', '+999 123456789', 'call me'])
      expect(() => hotelInput({ afterHoursPhone: bad })).toThrow('country code');
  });

  it('checks the contact emails and the website', () => {
    expect(
      hotelInput({ reservationsEmail: ' Book@Hotel.com ', website: 'https://hotel.com' }),
    ).toEqual({
      reservationsEmail: 'Book@Hotel.com',
      website: 'https://hotel.com',
    });
    expect(() => hotelInput({ reservationsEmail: 'nope' })).toThrow('email address');
    expect(() => hotelInput({ website: 'http://hotel.com' })).toThrow('https');
    expect(() => hotelInput({ website: 'https://localhost' })).toThrow('https');
    expect(() => hotelInput({ website: 'https://' + 'a'.repeat(500) + '.com' })).toThrow();
  });

  it('checks WhatsApp and reception hours as a whole', () => {
    expect(() =>
      checkHotelSettings({ whatsappSameAsPhone: false, whatsappNumber: null }, [
        'whatsappSameAsPhone',
      ]),
    ).toThrow('WhatsApp');
    expect(() =>
      checkHotelSettings({ whatsappSameAsPhone: false, whatsappNumber: '+355692123456' }, [
        'whatsappSameAsPhone',
      ]),
    ).not.toThrow();
    expect(() =>
      checkHotelSettings({ receptionOpen24h: false, receptionFrom: null }, ['receptionOpen24h']),
    ).toThrow('opening time');
    expect(() =>
      checkHotelSettings(
        { receptionOpen24h: false, receptionFrom: '08:00', receptionTo: '08:00' },
        ['receptionTo'],
      ),
    ).toThrow('differ');
    expect(() =>
      checkHotelSettings(
        { receptionOpen24h: false, receptionFrom: '18:00', receptionTo: '02:00' },
        ['receptionTo'],
      ),
    ).not.toThrow();
  });
});
