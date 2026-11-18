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
});
