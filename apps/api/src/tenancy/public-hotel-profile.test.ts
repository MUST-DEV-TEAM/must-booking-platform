import { describe, expect, it } from 'vitest';

import { publicHotelProfile, type PublicProfileRow } from './public-hotel-profile';

const row: PublicProfileRow = {
  chainName: 'Beach Group',
  propertyType: 'resort',
  starRating: 4,
  starRatingOfficial: true,
  yearOpened: 2001,
  yearRenovated: null,
  summary: 'Quiet beach resort.',
  description: null,
  languages: ['sq', 'en', 'xx'],
  tourismLicence: 'AL-123',
  addressLine2: null,
  city: 'Dhermi',
  region: 'Vlorë',
  postalCode: '9401',
  country: 'AL',
  latitude: 40.133774,
  longitude: 19.647761,
  directions: 'Entrance from the beach road.',
  nearestAirportCode: 'TIA',
  nearestAirportKm: 120.5,
  roomCount: 81,
  logoUrl: 'https://cdn.example/logo.png',
  logoDarkUrl: null,
  iconUrl: 'https://cdn.example/icon.png',
  faviconUrl: null,
  coverUrl: 'https://cdn.example/cover.jpg',
  brandColour: '#215448',
  onlineProfiles: { instagram: 'https://www.instagram.com/hotel' },
  phone: '+355 69 123 4567',
  supportEmail: 'hello@hotel.al',
  minStayNights: 2,
  maxStayNights: null,
  advanceBookingDays: 365,
  minNoticeHours: 24,
  seasonOpenFrom: '04-15',
  seasonOpenTo: '10-31',
  arrivalDays: [5, 6],
  departureDays: null,
  sameDayBookingAllowed: true,
  sameDayCutoffTime: null,
  maxGuestsPerBooking: 8,
  maxRoomsPerBooking: 4,
  groupRequestForm: true,
  minBookingAge: null,
  childrenUpToAge: 10,
  infantsUpToAge: null,
  askChildrenAges: true,
  confirmationMode: 'on_request',
  onRequestHours: null,
  fillGapNights: false,
  formPhone: 'optional',
  formCountry: 'required',
  formAddress: 'hidden',
  formArrivalTime: 'hidden',
  formSpecialRequests: 'optional',
  formGuestNamePerRoom: 'hidden',
  formCompany: 'hidden',
  formMarketing: 'optional',
};

describe('publicHotelProfile booking rules', () => {
  it('publishes the rules with the usual defaults and never the group request address', () => {
    const { booking } = publicHotelProfile(row);
    expect(booking.stay).toEqual({
      minNights: 2,
      maxNights: null,
      bookUpToDays: 365,
      minNoticeHours: 24,
    });
    expect(booking.season).toEqual({ from: '04-15', to: '10-31' });
    expect(booking.arrivalDays).toEqual([5, 6]);
    expect(booking.departureDays).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(booking.group).toEqual({ maxGuests: 8, maxRooms: 4, requestForm: true });
    expect(booking.ages).toEqual({
      minimumToBook: 18,
      childrenUpTo: 10,
      infantsUpTo: 2,
      askChildrenAges: true,
    });
    expect(booking.confirmation).toEqual({ mode: 'on_request', answerWithinHours: 24 });
    expect(booking.form.phone).toBe('optional');
    expect(JSON.stringify(booking)).not.toMatch(/@/);
  });
});

describe('publicHotelProfile', () => {
  it('turns codes into names and groups the location', () => {
    const profile = publicHotelProfile(row);
    expect(profile.propertyType).toEqual({ code: 'resort', label: 'Resort' });
    expect(profile.languages).toEqual([
      { code: 'sq', name: 'Albanian' },
      { code: 'en', name: 'English' },
      { code: 'xx', name: 'xx' },
    ]);
    expect(profile.location.country).toEqual({ code: 'AL', name: 'Albania' });
    expect(profile.location.nearestAirport).toEqual({ code: 'TIA', distanceKm: 120.5 });
    expect(profile.starRatingOfficial).toBe(true);
    expect(profile.roomCount).toBe(81);
    // Brand for the website: the favicon falls back to the square icon; nothing internal is included.
    expect(profile.brand).toMatchObject({
      logoUrl: 'https://cdn.example/logo.png',
      faviconUrl: 'https://cdn.example/icon.png',
      coverUrl: 'https://cdn.example/cover.jpg',
      colour: '#215448',
      email: 'hello@hotel.al',
      onlineProfiles: { instagram: 'https://www.instagram.com/hotel' },
    });
    expect(JSON.stringify(profile)).not.toMatch(/accounting|mainContact|legalName|taxNumber/);
  });

  it('leaves out what is not set, and never shows a half pin', () => {
    const profile = publicHotelProfile({
      ...row,
      propertyType: null,
      starRating: null,
      latitude: 40.1,
      longitude: null,
      nearestAirportCode: null,
      languages: null,
      country: null,
    });
    expect(profile.propertyType).toBeNull();
    expect(profile.starRatingOfficial).toBeNull();
    expect(profile.location.latitude).toBeNull();
    expect(profile.location.longitude).toBeNull();
    expect(profile.location.nearestAirport).toBeNull();
    expect(profile.languages).toEqual([]);
    expect(profile.location.country).toBeNull();
  });

  it('never carries the legal name, the tax number or other internal data', () => {
    const text = JSON.stringify(
      publicHotelProfile({ ...row, ...{ legalName: 'X', taxNumber: 'Y' } }),
    );
    expect(text).not.toContain('"legalName"');
    expect(text).not.toContain('taxNumber');
  });
});
