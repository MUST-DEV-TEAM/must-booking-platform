import { HOTEL_LANGUAGES, PROPERTY_TYPES } from '@must/domain-contracts';
import { Prisma } from '@prisma/client';

/** The hotel facts a public website may show, as columns. Never the legal name, tax number or anything internal. */
export const publicProfileColumns = Prisma.raw(`
  p.chain_name AS "chainName", p.property_type AS "propertyType", p.star_rating AS "starRating",
  p.star_rating_official AS "starRatingOfficial", p.year_opened AS "yearOpened",
  p.year_renovated AS "yearRenovated", p.summary, p.description, p.languages,
  p.tourism_licence AS "tourismLicence", p.address_line_2 AS "addressLine2", p.city, p.region,
  p.postal_code AS "postalCode", p.country, p.latitude, p.longitude, p.directions,
  p.nearest_airport_code AS "nearestAirportCode", p.nearest_airport_km AS "nearestAirportKm",
  (SELECT count(*)::int FROM rooms r WHERE r.tenant_id=p.tenant_id AND r.property_id=p.id AND r.is_active) AS "roomCount",
  p.logo_url AS "logoUrl", p.logo_dark_url AS "logoDarkUrl", p.icon_url AS "iconUrl",
  p.favicon_url AS "faviconUrl", p.cover_url AS "coverUrl", p.brand_colour AS "brandColour",
  p.online_profiles AS "onlineProfiles", p.phone, p.support_email AS "supportEmail",
  p.min_stay_nights AS "minStayNights", p.max_stay_nights AS "maxStayNights",
  p.advance_booking_days AS "advanceBookingDays", p.min_notice_hours AS "minNoticeHours",
  p.season_open_from AS "seasonOpenFrom", p.season_open_to AS "seasonOpenTo",
  p.arrival_days AS "arrivalDays", p.departure_days AS "departureDays",
  p.same_day_booking_allowed AS "sameDayBookingAllowed", p.same_day_cutoff_time AS "sameDayCutoffTime",
  p.max_guests_per_booking AS "maxGuestsPerBooking", p.max_rooms_per_booking AS "maxRoomsPerBooking",
  p.group_request_form AS "groupRequestForm", p.min_booking_age AS "minBookingAge",
  p.children_up_to_age AS "childrenUpToAge", p.infants_up_to_age AS "infantsUpToAge",
  p.ask_children_ages AS "askChildrenAges", p.confirmation_mode AS "confirmationMode",
  p.on_request_hours AS "onRequestHours", p.fill_gap_nights AS "fillGapNights",
  p.form_phone AS "formPhone", p.form_country AS "formCountry", p.form_address AS "formAddress",
  p.form_arrival_time AS "formArrivalTime", p.form_special_requests AS "formSpecialRequests",
  p.form_guest_name_per_room AS "formGuestNamePerRoom", p.form_company AS "formCompany",
  p.form_marketing AS "formMarketing"`);

export type PublicProfileRow = {
  chainName: string | null;
  propertyType: string | null;
  starRating: number | null;
  starRatingOfficial: boolean | null;
  yearOpened: number | null;
  yearRenovated: number | null;
  summary: string | null;
  description: string | null;
  languages: string[] | null;
  tourismLicence: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  directions: string | null;
  nearestAirportCode: string | null;
  nearestAirportKm: number | null;
  roomCount: number | null;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  iconUrl: string | null;
  faviconUrl: string | null;
  coverUrl: string | null;
  brandColour: string | null;
  onlineProfiles: Record<string, string> | null;
  phone: string | null;
  supportEmail: string | null;
  minStayNights: number | null;
  maxStayNights: number | null;
  advanceBookingDays: number | null;
  minNoticeHours: number | null;
  seasonOpenFrom: string | null;
  seasonOpenTo: string | null;
  arrivalDays: number[] | null;
  departureDays: number[] | null;
  sameDayBookingAllowed: boolean | null;
  sameDayCutoffTime: string | null;
  maxGuestsPerBooking: number | null;
  maxRoomsPerBooking: number | null;
  groupRequestForm: boolean | null;
  minBookingAge: number | null;
  childrenUpToAge: number | null;
  infantsUpToAge: number | null;
  askChildrenAges: boolean | null;
  confirmationMode: string | null;
  onRequestHours: number | null;
  fillGapNights: boolean | null;
  formPhone: string | null;
  formCountry: string | null;
  formAddress: string | null;
  formArrivalTime: string | null;
  formSpecialRequests: string | null;
  formGuestNamePerRoom: string | null;
  formCompany: string | null;
  formMarketing: string | null;
};

const regionName = (code: string) => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
};

/** What a website reads under `profile`: grouped, with codes turned into names, empty values left out as null. */
export function publicHotelProfile(row: PublicProfileRow) {
  const type = PROPERTY_TYPES.find((entry) => entry.value === row.propertyType);
  const pinned =
    typeof row.latitude === 'number' &&
    typeof row.longitude === 'number' &&
    Number.isFinite(row.latitude) &&
    Number.isFinite(row.longitude);
  return {
    chainName: row.chainName,
    propertyType: row.propertyType
      ? { code: row.propertyType, label: type?.label ?? row.propertyType }
      : null,
    starRating: row.starRating,
    /** True when the rating was issued by the national tourism authority. */
    starRatingOfficial: row.starRating ? row.starRatingOfficial === true : null,
    yearOpened: row.yearOpened,
    yearRenovated: row.yearRenovated,
    summary: row.summary,
    description: row.description,
    languages: (row.languages ?? []).map((code) => ({
      code,
      name: HOTEL_LANGUAGES.find((language) => language.code === code)?.name ?? code,
    })),
    roomCount: row.roomCount,
    tourismLicence: row.tourismLicence,
    /** What a website needs to look like the hotel: images, colour, contact and its pages on other sites. */
    brand: {
      logoUrl: row.logoUrl,
      logoDarkUrl: row.logoDarkUrl,
      iconUrl: row.iconUrl,
      /** The favicon, or the square icon when no separate favicon was uploaded. */
      faviconUrl: row.faviconUrl ?? row.iconUrl,
      coverUrl: row.coverUrl,
      colour: row.brandColour,
      phone: row.phone,
      email: row.supportEmail,
      onlineProfiles: row.onlineProfiles ?? {},
    },
    /**
     * The hotel's booking rules, so a website can show them and build its booking form. The group request
     * address stays private: a request goes through MUST, never straight to an address shown here.
     */
    booking: {
      stay: {
        minNights: row.minStayNights,
        maxNights: row.maxStayNights,
        bookUpToDays: row.advanceBookingDays,
        minNoticeHours: row.minNoticeHours,
      },
      season: { from: row.seasonOpenFrom, to: row.seasonOpenTo },
      arrivalDays: row.arrivalDays ?? [1, 2, 3, 4, 5, 6, 7],
      departureDays: row.departureDays ?? [1, 2, 3, 4, 5, 6, 7],
      sameDay: { allowed: row.sameDayBookingAllowed !== false, cutoffTime: row.sameDayCutoffTime },
      group: {
        maxGuests: row.maxGuestsPerBooking,
        maxRooms: row.maxRoomsPerBooking,
        requestForm: row.groupRequestForm === true,
      },
      ages: {
        minimumToBook: row.minBookingAge ?? 18,
        childrenUpTo: row.childrenUpToAge ?? 12,
        infantsUpTo: row.infantsUpToAge ?? 2,
        askChildrenAges: row.askChildrenAges === true,
      },
      confirmation: {
        mode: row.confirmationMode === 'on_request' ? 'on_request' : 'instant',
        answerWithinHours:
          row.confirmationMode === 'on_request' ? (row.onRequestHours ?? 24) : null,
      },
      /** Each field is `required`, `optional` or `hidden`; email and the main guest name are always asked. */
      form: {
        phone: row.formPhone ?? 'required',
        country: row.formCountry ?? 'required',
        address: row.formAddress ?? 'hidden',
        arrivalTime: row.formArrivalTime ?? 'hidden',
        specialRequests: row.formSpecialRequests ?? 'optional',
        guestNamePerRoom: row.formGuestNamePerRoom ?? 'hidden',
        company: row.formCompany ?? 'hidden',
        marketing: row.formMarketing ?? 'optional',
      },
      fillGapNights: row.fillGapNights === true,
    },
    location: {
      addressLine2: row.addressLine2,
      city: row.city,
      region: row.region,
      postalCode: row.postalCode,
      country: row.country ? { code: row.country, name: regionName(row.country) } : null,
      latitude: pinned ? row.latitude : null,
      longitude: pinned ? row.longitude : null,
      directions: row.directions,
      nearestAirport: row.nearestAirportCode
        ? { code: row.nearestAirportCode, distanceKm: row.nearestAirportKm }
        : null,
    },
  };
}
