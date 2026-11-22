import { describe, expect, it } from 'vitest';

import { checkHotelSettings, hotelInput } from './hotel-settings';

describe('booking window fields', () => {
  it('accepts and normalises the window, season and weekdays', () => {
    expect(
      hotelInput({
        minNoticeHours: 24,
        seasonOpenFrom: '05-01',
        seasonOpenTo: '10-31',
        arrivalDays: [6, 1, 6],
        departureDays: [7],
        maxGuestsPerBooking: 12,
        maxRoomsPerBooking: 4,
      }),
    ).toEqual({
      minNoticeHours: 24,
      seasonOpenFrom: '05-01',
      seasonOpenTo: '10-31',
      arrivalDays: [1, 6],
      departureDays: [7],
      maxGuestsPerBooking: 12,
      maxRoomsPerBooking: 4,
    });
    expect(hotelInput({ minNoticeHours: 0, seasonOpenFrom: '', seasonOpenTo: null })).toEqual({
      minNoticeHours: 0,
      seasonOpenFrom: null,
      seasonOpenTo: null,
    });
  });

  it.each([
    [{ minNoticeHours: 721 }, '0 to 720'],
    [{ minNoticeHours: 1.5 }, 'whole number'],
    [{ maxGuestsPerBooking: 51 }, '1 to 50'],
    [{ maxRoomsPerBooking: 0 }, '1 to 20'],
    [{ arrivalDays: [] }, 'at least one day'],
    [{ arrivalDays: [0, 8] }, 'at least one day'],
    [{ departureDays: 'mon' }, 'at least one day'],
  ])('refuses %j', (body, hint) => {
    expect(() => hotelInput(body)).toThrow(hint);
  });

  it('needs both season dates, real dates and different ones', () => {
    const check = (from: string | null, to: string | null) =>
      checkHotelSettings({ seasonOpenFrom: from, seasonOpenTo: to }, ['seasonOpenFrom']);
    expect(() => check('05-01', '10-31')).not.toThrow();
    expect(() => check('11-15', '03-15')).not.toThrow();
    expect(() => check(null, null)).not.toThrow();
    expect(() => check('05-01', null)).toThrow('both');
    expect(() => check('02-30', '10-31')).toThrow('real dates');
    expect(() => check('05-01', '05-01')).toThrow('differ');
  });
});
